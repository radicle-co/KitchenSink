import { S3Client } from '@aws-sdk/client-s3';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { cdnOwnerPrefixInvalidationPath } from '@kitchensink/recipe-core';
import { sql } from 'drizzle-orm';

import { requireEnv } from '../common/config.js';
import { createCloudFrontInvalidation } from '../common/cdn-invalidation.js';
import { getRecipeDb } from '../common/db.js';
import { logger } from '../common/logger.js';
import { emitMetric } from '../common/metrics.js';
import { eraseRecipeObjects } from './account-erasure-worker.js';

/**
 * Scheduled erasure-orphan sweeper — the reconciliation backstop that CLOSES the archive-resurrection
 * race the {@link ownerErasureRequested} guard could only narrow. VPC-attached DB consumer.
 *
 * **The residual it closes.** `version-archive-worker` reads an owner's erasure state and then PUTs the
 * snapshot as two separate steps against two systems (RDS, then S3). Its own header says so: "The window
 * is now sub-millisecond … but non-zero. The true backstop is a periodic orphan-sweep that reconciles
 * archive objects against erased owners." An account-erasure that begins after that read and finishes its
 * archive-bucket sweep before the ensuing PUT leaves a snapshot object under an erased owner's
 * `recipes/{ownerId}/` prefix — user data surviving a right-to-erasure request. This sweeper finds and
 * deletes exactly those objects.
 *
 * **Why `completed`-only, per REMOVED recipe, and why BOTH buckets.** Once an owner's erasure job is
 * `completed`, the erasure worker has already deleted every REMOVED recipe's DB rows and swept both
 * buckets under each removed recipe's prefix — so each `recipes/{ownerId}/{removedRecipeId}/` subtree MUST
 * be empty forever after. Anything under one is therefore an orphan and is safe to delete. **Scoped erasure
 * (CR-002 / U3a) makes the per-recipe scoping load-bearing here, not a nicety:** an erased owner now KEEPS
 * their truly-public + donated recipes, whose media legitimately lives under
 * `recipes/{ownerId}/{keptRecipeId}/`. Sweeping the whole OWNER prefix — as this sweeper used to — would
 * delete that kept media on the next tick, destroying the very content U3a preserved. So this reconciles
 * exactly the removed-recipe id set the erasure captured on the job row (`removed_recipe_ids`), never the
 * owner prefix. An owner still `queued`/`running`/`failed` has NOT had a successful sweep, so it is skipped
 * entirely. **Both** object buckets can be dirtied after a completed sweep of a removed recipe: the ARCHIVE
 * bucket by a late version-archive PUT (the read→PUT window above), and the MEDIA bucket by a **photo-upload
 * presigned PUT**. A presigned URL is minted for the CLIENT and stays valid for its TTL (default 900s); one
 * minted for a REMOVED recipe just before erasure can be redeemed AFTER the worker's synchronous media
 * sweep, landing an object under that removed recipe's media prefix. (The prior assumption that "nothing
 * writes fresh media for a completed owner" was false — the presigned URL is exactly such a writer.) So
 * this sweeper reconciles both buckets, per removed recipe.
 *
 * **CDN invalidation of reconciled media (Finding 2 / HAZ-051/067).** Deleting a media orphan from S3 is
 * not enough on its own: recipe media is served UNSIGNED/public via CloudFront, so a late-redeemed
 * presigned PUT that got cached at an edge location before this sweeper deleted its origin copy would
 * otherwise keep being served from that edge until the object's TTL expires — the exact residual the main
 * erasure worker's invalidation closes for the synchronous path (`account-erasure-worker.ts`). So whenever
 * this sweeper actually deletes something from the MEDIA bucket for an owner, it also issues ONE CDN
 * invalidation for that owner's whole media prefix via the same `CdnInvalidationPort` / owner-prefix
 * helper (`cdnOwnerPrefixInvalidationPath`) the main worker uses — never for the archive bucket, which is
 * never served via CDN, and never unconditionally (see the inline note on the call site for why this
 * sweeper's repeated-tick shape makes the main worker's "always invalidate" posture the wrong default
 * here). A CDN failure here is logged and swallowed, not rethrown: this is a scheduled reconciliation tick
 * with no job row to keep non-terminal, so one owner's CDN hiccup must never abort another owner's sweep.
 *
 * **Why a bounded recent look-back, not "all completed owners".** A racing PUT can only land within one
 * archive-worker invocation of the erasure's sweep — the worker loads the row, checks erasure, and PUTs
 * inside a single ≤60s invocation, and a redelivery cannot re-create the orphan because
 * `loadVersionSnapshot` throws once the row is gone. So an orphan appears within ~minutes of completion
 * and never later. {@link COMPLETED_LOOKBACK} is set far above that (24h) so every freshly-`completed`
 * owner is re-swept across many ticks, while still bounding the scan to recent completions — the
 * all-time `completed` set grows without limit, and re-listing an owner whose prefix was cleaned on the
 * first tick forever would be pure waste. Owners are ordered oldest-completion-first so the ones nearest
 * to ageing out of the window are reconciled before the batch cap bites.
 *
 * **Idempotent and cheap by design.** A clean tick — the overwhelming common case, because the guard
 * makes an actual orphan exceedingly rare — costs one small indexed-by-status read plus one empty
 * `ListObjectsV2` per recently-`completed` owner (typically a handful; erasure is rare). It emits
 * {@link ORPHAN_METRIC_NAME} every tick (0 when clean) so the alarm always has data; a NONZERO value is
 * the signal that a real resurrection was caught and the race actually fired — alarm-worthy on its own.
 */

/** How many completed owners one tick reconciles. Bounds the Lambda's runtime; the next tick takes the rest. */
export const SWEEP_BATCH_SIZE = 100;

/**
 * How far back to look for `completed` erasure owners.
 *
 * Sized off the failures it reconciles, not a feeling. The archive orphan appears within one
 * archive-worker invocation (≤60s) of an erasure's archive sweep. The MEDIA orphan appears within a
 * photo-upload presigned URL's TTL of erasure — a URL minted just before erasure can be redeemed up to
 * `PRESIGNED_URL_EXPIRY_SECONDS` (recipe-service config, default 900s = 15m) after the synchronous media
 * sweep. This 24h window is a vast margin over BOTH — and, load-bearing, it MUST stay comfortably greater
 * than the presign TTL so a URL redeemed at the end of its life is still inside a completed owner's
 * look-back and caught on the next tick. If that config ever raised the TTL toward a day, this constant
 * must rise with it. 24h buys ~24 hourly re-sweeps of every freshly-completed owner.
 */
const COMPLETED_LOOKBACK = '24 hours';

/** Shares the erasure namespace: an archive object surviving erasure is an erasure-compliance fact. */
const ORPHAN_METRIC_NAMESPACE = 'Commise/RecipeErasure';

/**
 * The metric name the resurrection-caught alarm watches. Mirrored by the infra alarm — one knowledge.
 * Bucket-neutral: it counts orphans reclaimed across BOTH the archive and media buckets, so a nonzero
 * value means a resurrection was caught in either.
 */
export const ORPHAN_METRIC_NAME = 'ErasureOrphansDeleted';

const s3 = new S3Client({});

/**
 * One recently-`completed` erasure owner and the recipe id set that erasure REMOVED — the exact prefixes
 * this sweeper is allowed to reconcile.
 */
export interface CompletedErasureOwner {
    /** The erased owner's app-user ULID. */
    readonly ownerId: string;
    /**
     * The recipe ids the erasure removed (CR-002 / U3a), captured on the job row. ONLY these prefixes are
     * reconciled — the owner's KEPT (truly-public + donated) recipes' media must survive. `null`/empty
     * (a pre-CR-002 legacy row, or an owner with nothing removed) ⇒ nothing to reconcile.
     */
    readonly removedRecipeIds: string[] | null;
}

/**
 * The recently-`completed` erasure owners (within {@link COMPLETED_LOOKBACK}, oldest first) and, for each,
 * the removed-recipe id set to reconcile.
 *
 * `status = 'completed'` is the entire safety model — a non-completed owner has not had a successful
 * sweep and may legitimately still hold data, so it must never be returned. Deliberately NOT filtered
 * on `('queued','running')` (the erasure sweeper's predicate): that set is the opposite of what this
 * reconciles. Ordered oldest-completion-first so the owners closest to leaving the look-back window are
 * reconciled before the {@link SWEEP_BATCH_SIZE} cap.
 *
 * `removed_recipe_ids` (CR-002 / U3a) is read alongside the owner so the sweep can be scoped to exactly
 * the removed recipes — sweeping the owner prefix would delete a KEPT public recipe's media.
 *
 * There is no index on `status = 'completed'` (the partial `idx_erasure_jobs_status` covers only the
 * active statuses), so this is a filtered scan; that is acceptable because `account_erasure_jobs` is a
 * small, slow-growing table (one row per erasure request ever, and an erased ULID never returns — D2). If
 * erasure volume ever made this hot, the lever is a partial index on `(updated_at) WHERE status =
 * 'completed'`, owned by the recipe-service schema — not this worker.
 *
 * @param db - The recipe database handle.
 * @returns The recently-completed owners + their removed-recipe id sets, oldest completion first.
 * @sideEffect Reads `account_erasure_jobs`.
 */
export async function readRecentlyCompletedOwners(
    db: NodePgDatabase<Record<string, never>>,
): Promise<CompletedErasureOwner[]> {
    const result = await db.execute<{ owner_id: string; removed_recipe_ids: string[] | null }>(sql`
        SELECT owner_id, removed_recipe_ids
        FROM account_erasure_jobs
        WHERE status = 'completed'
          AND updated_at >= now() - interval '${sql.raw(COMPLETED_LOOKBACK)}'
        ORDER BY updated_at ASC
        LIMIT ${SWEEP_BATCH_SIZE}
    `);

    return result.rows.map((row) => ({ ownerId: row.owner_id, removedRecipeIds: row.removed_recipe_ids }));
}

/**
 * Publish the orphans-deleted count as a CloudWatch metric via the embedded metric format.
 *
 * Emitted every tick (0 when clean) so the alarm has data instead of flapping into INSUFFICIENT_DATA the
 * moment things are healthy; a NONZERO value is the signal a real resurrection was caught. The EMF
 * envelope itself lives once in {@link emitMetric}; this only supplies the orphan-specific namespace,
 * name, and unit.
 *
 * @param stage - The deploy stage (the metric's only dimension).
 * @param orphansDeleted - Objects deleted from erased owners' archive prefixes this tick.
 * @sideEffect Writes one EMF line to stdout.
 */
export function emitOrphansDeletedMetric(stage: string, orphansDeleted: number): void {
    emitMetric({
        namespace: ORPHAN_METRIC_NAMESPACE,
        name: ORPHAN_METRIC_NAME,
        unit: 'Count',
        stage,
        value: orphansDeleted,
    });
}

/**
 * Reconcile BOTH object buckets against recently-`completed` erasure owners, deleting any orphan a late
 * write left behind — a version-archive PUT in the archive bucket, or a photo-upload presigned PUT in the
 * media bucket — and, for any media orphan actually deleted, invalidating that owner's CDN prefix.
 *
 * @throws {MissingConfigError} When `RECIPE_ARCHIVE_BUCKET` or `RECIPE_MEDIA_BUCKET` is unset —
 *   reconciling "no bucket" would report a clean tick while every orphan in it survived.
 * @sideEffect Reads `account_erasure_jobs`, lists+deletes S3 objects, issues CloudFront invalidations for
 *   reconciled media orphans (non-blocking on failure), emits one EMF line.
 */
export const handler = async (): Promise<void> => {
    // Both buckets are required up front: an unset media bucket would silently leave every media orphan
    // in place while the tick reported clean — the exact false-erasure this sweeper exists to prevent.
    const archiveBucket = requireEnv('RECIPE_ARCHIVE_BUCKET');
    const mediaBucket = requireEnv('RECIPE_MEDIA_BUCKET');
    const buckets = [archiveBucket, mediaBucket];
    const db = getRecipeDb();
    // Built per invocation, mirroring `account-erasure-worker.ts`'s handler (the same reasoning applies
    // here — the distribution id is optional and stage-specific): see `common/cdn-invalidation.ts` for the
    // unset-id no-op contract.
    const cdn = createCloudFrontInvalidation({ distributionId: process.env['CLOUDFRONT_DISTRIBUTION_ID'] });

    const owners = await readRecentlyCompletedOwners(db);

    let orphansDeleted = 0;

    for (const { ownerId, removedRecipeIds } of owners) {
        // Reconcile ONLY the removed recipes' prefixes (CR-002 / U3a), never the owner prefix — a KEPT
        // public/donated recipe's media lives under the same owner prefix and must survive. A legacy /
        // nothing-removed row (null/empty) has no prefix to reconcile.
        for (const recipeId of removedRecipeIds ?? []) {
            for (const bucket of buckets) {
                // Per-(recipe, bucket), never per-batch: one removed recipe's S3 failure in one bucket must
                // not strand another recipe's — or even the same recipe's other bucket's — reconciliation.
                // The owner keeps its `completed` row and stays inside the look-back window, so the next
                // tick re-attempts it — the same row-as-truth durability the other sweepers rely on.
                try {
                    // Reuse the erasure worker's authoritative per-recipe prefix-sweep (list → batch-delete →
                    // count) rather than re-implementing it: it IS the same operation, keyed under the same
                    // `recipeMediaPrefix` (ARCH-BE-3) in both buckets, and it already surfaces per-key S3
                    // delete failures instead of papering over them.
                    const deleted = await eraseRecipeObjects(s3, bucket, ownerId, recipeId);

                    orphansDeleted += deleted;

                    // HAZ-051/067 (Finding 2). A late-landing MEDIA orphan is exactly the resurrection this
                    // sweeper exists to close, and media is served UNSIGNED/public via CDN (photos.module.ts)
                    // — so deleting the S3 origin copy alone leaves a stale edge copy reachable until its TTL
                    // expires, the SAME residual the main erasure worker's invalidation closes for the
                    // synchronous path. Gated two ways, deliberately narrower than the main worker's call:
                    //   - Bucket: ONLY the media bucket — the archive bucket is never served via CDN, so
                    //     invalidating for an archive-only orphan would be a no-op purge of nothing.
                    //   - Count: ONLY when this sweep actually deleted something (`deleted > 0`), unlike the
                    //     main worker's unconditional per-attempt call. The main worker invalidates once per
                    //     erasure attempt; THIS sweeper re-lists the SAME completed owner on every tick for
                    //     up to `COMPLETED_LOOKBACK` (24h), so an unconditional invalidation would fire one
                    //     CloudFront request per removed recipe per tick even when nothing was ever found —
                    //     the main worker's "always invalidate, retries are rare" reasoning does not carry
                    //     over to a sweep that repeats routinely. ONE owner-prefix path still covers every
                    //     removed recipe (and harmlessly over-purges kept recipes, which re-cache from origin).
                    if (bucket === mediaBucket && deleted > 0) {
                        try {
                            await cdn.invalidate([cdnOwnerPrefixInvalidationPath(ownerId)]);
                        } catch (cdnError) {
                            // Non-blocking — mirroring the S3-sweep catch this sits inside. A scheduled
                            // reconciliation tick has no job row to keep non-terminal the way the erasure
                            // worker does, so one owner's CDN failure must not strand another owner's — or
                            // even this owner's own — reconciliation. The object is already gone from S3 by
                            // this point; the residual left behind is only the bounded, TTL-limited stale edge
                            // copy, never a repeat of the underlying data-erasure failure.
                            logger.error('erasure-orphan-sweeper: could not invalidate CDN for a reconciled owner', {
                                ownerId,
                                bucket,
                                error: cdnError instanceof Error ? cdnError.message : String(cdnError),
                            });
                        }
                    }
                } catch (error) {
                    logger.error('erasure-orphan-sweeper: could not reconcile a removed recipe’s prefix', {
                        ownerId,
                        recipeId,
                        bucket,
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
            }
        }
    }

    emitOrphansDeletedMetric(process.env['STAGE'] ?? 'unknown', orphansDeleted);

    if (orphansDeleted > 0) {
        // A real resurrection fired: a late write landed under an erased owner's prefix and this backstop
        // caught it. Loud on purpose — it is both the remediation and the evidence the race is non-zero.
        logger.warn('erasure-orphan-sweeper deleted orphans under erased owners', {
            orphansDeleted,
            ownersScanned: owners.length,
            buckets,
        });
    } else {
        logger.info('erasure-orphan-sweeper swept clean', { ownersScanned: owners.length });
    }
};
