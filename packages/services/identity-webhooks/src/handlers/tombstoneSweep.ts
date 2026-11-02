import type { Context, ScheduledEvent } from 'aws-lambda';
import { and, eq, lte } from 'drizzle-orm';

import { eraseIdentityRow, users, type UserId } from '@kitchensink/identity-db';

import { getConfig } from '../config/env.js';
import { withDb, type DbContext } from '../common/handlerPipeline.js';

import { enqueueErasure } from '../common/erasureEnqueue.js';
import { emitMetric, logger, withObservability } from '../common/observability.js';

/**
 * The tombstone → auto-erasure retention window (CR-002 KTD-3): a closed (tombstoned) account is auto-erased
 * 12 months after closure. Named so the policy lives in exactly one place.
 */
export const TOMBSTONE_ERASURE_MONTHS = 12;

/**
 * The instant a tombstone becomes eligible for auto-erasure: `now` minus the retention window. Pure.
 *
 * @param now - the reference instant (the sweep's start time).
 * @returns the cutoff — tombstones with `deletedAt <= cutoff` are erased.
 */
export function erasureCutoff(now: Date): Date {
    const cutoff = new Date(now);
    cutoff.setMonth(cutoff.getMonth() - TOMBSTONE_ERASURE_MONTHS);

    return cutoff;
}

/** An expired tombstone to erase — the durable ULID + the Clerk `sub` the erasure deletes. */
interface ExpiredTombstone {
    id: UserId;
    identityId: string;
}

/** The sweep result — how many tombstones were scanned and how many were fully erased this run. */
interface SweepResult {
    scanned: number;
    erased: number;
}

/**
 * The scheduled 12-month tombstone → erasure sweep (KTD-3). Idempotent: it only selects `tombstoned` rows past
 * the retention cutoff; once erased (`status='erased'`) a row is never re-selected. Per user, ordered for
 * convergence: the status-guarded DB scrub + audit FIRST (a row no longer tombstoned is skipped), THEN the
 * `erasure` message, whose worker deletes the Clerk account, confirms it, and fans out the recipe/food legs. A
 * failed enqueue is logged and left to erasure reconciliation; it never aborts the batch.
 *
 * @implements CR-002 KTD-3 R3 R8
 */
const innerHandler = async (_event: ScheduledEvent, _context: Context, { db }: DbContext): Promise<SweepResult> => {
    const now = new Date();
    const cutoff = erasureCutoff(now);
    const { DELETION_QUEUE_URL } = getConfig();

    const expired = (await db
        .select({ id: users.id, identityId: users.identityId })
        .from(users)
        .where(and(eq(users.status, 'tombstoned'), lte(users.deletedAt, cutoff)))) satisfies ExpiredTombstone[];

    let erased = 0;

    for (const tombstone of expired) {
        // CLAIM THE ROW FIRST, with the status-guarded write. The Clerk delete is irreversible, so it may only follow
        // a claim: a tombstone an admin reactivated since the select is skipped below, with its Clerk account intact.
        // The deletion worker (`erasure` event) owns the Clerk delete and writes `provider_deleted_at`, and erasure
        // reconciliation re-enqueues until that is written, so the provider leg stays at-least-once.
        const wasErased = await eraseIdentityRow(
            db,
            {
                userId: tombstone.id,
                triggerSource: 'sweep',
                actor: null,
                providerDeletedAt: null,
                expectedStatus: 'tombstoned',
            },
            now,
        );

        // Reactivated (or erased by another path) since the select above: nothing was scrubbed, so there is no
        // audit row to match and no downstream erasure to enqueue.
        if (!wasErased) {
            logger.warn('tombstone-sweep: row is no longer tombstoned; skipped', { userId: tombstone.id });
            continue;
        }

        // Enqueue the recipe/food erasure legs via the existing deletion path (U3/U4 seam). Best-effort: a
        // failed enqueue leaves the identity erased but the downstream legs unqueued — a gap the nightly
        // erasure reconciliation (R7) detects and repairs; it must not undo the completed identity erasure.
        if (DELETION_QUEUE_URL !== undefined) {
            try {
                await enqueueErasure(DELETION_QUEUE_URL, { identityId: tombstone.identityId, userId: tombstone.id });
            } catch (err) {
                logger.error('tombstone-sweep: failed to enqueue recipe/food erasure legs (identity erased)', {
                    userId: tombstone.id,
                    error: err instanceof Error ? err.message : String(err),
                });
            }
        } else {
            logger.error('tombstone-sweep: DELETION_QUEUE_URL unset; Clerk delete and erasure legs NOT enqueued', {
                userId: tombstone.id,
            });
        }

        erased += 1;
        logger.info('tombstone-sweep: identity erased', { userId: tombstone.id, identityId: tombstone.identityId });
    }

    emitMetric('TombstoneErasureSwept', erased);
    logger.info('tombstone-sweep complete', { scanned: expired.length, erased });

    return { scanned: expired.length, erased };
};

/** @implements CR-002 KTD-3 R3 R8 */
export const handler = withObservability(withDb(innerHandler));
