import type { SQSHandler, SQSRecord } from 'aws-lambda';

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { recipeVersionArchiveKey } from '@kitchensink/recipe-core';
import type { RecipeVersion } from '@kitchensink/recipe-core';
import { sql } from 'drizzle-orm';

import { requireEnv } from '../common/config.js';
import { getRecipeDb } from '../common/db.js';
import { logger } from '../common/logger.js';

/**
 * SQS-triggered version-archive worker (FR-007b-i). Reads a recipe version from the shared RDS
 * `kitchensink_recipes` database and archives an immutable snapshot to S3. VPC-attached DB consumer.
 */

export interface RecipeVersionArchiveMessage {
    readonly recipeId: string;
    /** The internal `recipe_versions.id` — how the worker LOADS the row and clears its pending record. */
    readonly versionId: string;
    /**
     * The 1-based client-facing version number — how the archive object is KEYED (ARCH-BE-3).
     *
     * Carried on the message rather than derived, so the key can be built before the row is loaded and
     * stays identical to what `recipe-service` would have written inline.
     */
    readonly versionNumber: number;
    /** App-user ULID of the recipe owner (no users table; owner identity is a string reference). */
    readonly ownerId: string;
    /** ISO 8601 timestamp of when the archive was requested. */
    readonly requestedAt: string;
}

/**
 * The archived object's body: the `RecipeVersion` wire contract from `@kitchensink/recipe-core`.
 *
 * Deliberately the SAME shape `recipe-service` used to PUT inline before T130 moved archiving here, so
 * the async path is a relocation of the write, not a change to what an archive IS. Anything already in
 * the bucket stays readable by the same reader.
 */
export type RecipeVersionSnapshot = RecipeVersion;

/** The `recipe_versions` columns the archive body is built from (raw — this Lambda has no Drizzle schema). */
type RecipeVersionArchiveRow = {
    readonly id: string;
    readonly recipe_id: string;
    readonly version_number: number;
    readonly snapshot: unknown;
    readonly base_version: number | null;
    readonly s3_key: string | null;
    readonly created_by: string;
    readonly change_summary: string | null;
    readonly created_at: Date | string;
};

const s3 = new S3Client({});

/** Parse and shape an SQS record body into a typed archive message. */
export const parseArchiveMessage = (record: SQSRecord): RecipeVersionArchiveMessage =>
    JSON.parse(record.body) as RecipeVersionArchiveMessage;

/**
 * Deterministic S3 object key for a recipe version snapshot — the shared `recipeObjectKeys` scheme
 * (ARCH-BE-3), which this worker previously disagreed with.
 *
 * It keyed on the internal `versionId` UUID while `recipe-service`'s `versionArchiveKey` keyed on the
 * client-facing `versionNumber`, so the two would archive the same snapshot to two different objects.
 * The service's scheme won: `versionNumber` is how the API addresses a version and is unique within a
 * recipe via the `(recipe_id, version_number)` index. Hence the message must now carry the number.
 */
export const snapshotObjectKey = (message: RecipeVersionArchiveMessage): string =>
    recipeVersionArchiveKey({
        ownerId: message.ownerId,
        recipeId: message.recipeId,
        versionNumber: message.versionNumber,
    });

/**
 * Load the version row from `kitchensink_recipes` and serialize the archive body.
 *
 * The snapshot itself already lives on `recipe_versions.snapshot` — the whole point of the outbox
 * carrying no snapshot column — so this is a single read, not a re-assembly from recipes/steps/
 * ingredients. Raw SQL because this Lambda's Drizzle handle is schema-less (see `common/db.ts`).
 *
 * @throws When the version row is gone. That is NOT a retryable condition and must not be swallowed:
 *   the row is the payload, so if it has vanished (an erasure ran, a manual delete) there is nothing
 *   left to archive and silently PUTting an empty body would fabricate a bogus archive — exactly the
 *   failure the previous stub had, which returned an envelope with no snapshot and reported success.
 * @sideEffect Reads `recipe_versions` from RDS.
 */
export const loadVersionSnapshot = async (
    db: NodePgDatabase<Record<string, never>>,
    message: RecipeVersionArchiveMessage,
): Promise<RecipeVersionSnapshot> => {
    const result = await db.execute<RecipeVersionArchiveRow>(sql`
        SELECT id, recipe_id, version_number, snapshot, base_version, s3_key, created_by,
               change_summary, created_at
        FROM recipe_versions
        WHERE id = ${message.versionId}
        LIMIT 1
    `);

    const row = result.rows[0];

    if (!row) {
        throw new Error(`version-archive-worker: recipe_versions row ${message.versionId} not found`);
    }

    return {
        id: row.id,
        recipeId: row.recipe_id,
        versionNumber: row.version_number,
        snapshot: row.snapshot as RecipeVersion['snapshot'],
        ...(row.base_version !== null ? { baseVersion: row.base_version } : {}),
        ...(row.s3_key !== null ? { s3Key: row.s3_key } : {}),
        createdBy: row.created_by,
        ...(row.change_summary !== null ? { changeSummary: row.change_summary } : {}),
        createdAt: new Date(row.created_at).toISOString(),
    };
};

/**
 * Whether the version's owner has an account-erasure job on record — in ANY state
 * (`queued`/`running`/`completed`/`failed`) — used to refuse minting a fresh archive object under an
 * owner who has exercised GDPR right-to-erasure (C-007 / D7).
 *
 * **Why this exists — the archive-resurrection race.** This worker and the account-erasure worker touch
 * the same owner from two different queues with no shared lock. The erasure worker deletes the DB rows
 * FIRST, then sweeps the owner's S3 prefix, then marks the job `completed` (see its header). So the
 * dangerous interleaving is: this worker {@link loadVersionSnapshot}s the row *before* erasure deletes
 * it, then PUTs the snapshot *after* erasure's prefix sweep has already run — materialising an object
 * under an erased owner's `recipes/{ownerId}/` prefix while the job row reads `completed`. That is user
 * data surviving a right-to-erasure request. Rows-first ordering in the erasure worker narrows the
 * window; it does not close it.
 *
 * **Why ANY status, not `completed` only.** By the time an erasure job is `completed`, the erasure
 * worker has ALREADY deleted the `recipe_versions` row (delete precedes the status write), so
 * {@link loadVersionSnapshot} would have thrown before this check ever ran — a `completed`-only check
 * would therefore miss the worst sub-window: the interval AFTER the erasure's archive-bucket sweep but
 * BEFORE it writes `completed`, during which the job is still `running` and a racing PUT lands an object
 * that the sweep has already passed. Testing for any job row closes that `running` sub-window, and is
 * also the correct policy on its own terms: once an owner has *requested* erasure (`queued`), is being
 * erased (`running`), has been erased (`completed`), or had an erasure abandoned (`failed`), there is no
 * state in which minting a NEW snapshot of their data is desirable. The owner ULID is per-user and does
 * not come back after erasure (identity deletes the account — D2), so this never suppresses a legitimate
 * archive for a live user.
 *
 * **This is risk-reduction, NOT a proof.** The check reads the DB and the PUT writes S3 — two systems,
 * not one atomic step. An erasure that begins after this read and completes its prefix sweep before the
 * ensuing PUT can still leave an orphan. The window is now sub-millisecond (read immediately precedes
 * the PUT) but non-zero. The true backstop is the periodic `erasure-orphan-sweeper`, which reconciles
 * recently-completed owners' prefixes in BOTH object buckets (archive here, plus media for the analogous
 * presigned-photo-PUT race) and deletes any object a late write orphaned.
 *
 * A transient failure here MUST propagate, not be swallowed: it throws, the version row is untouched,
 * and SQS redelivers — a DB blip must never be read as "no erasure" and let a suppressed PUT through, nor
 * be read as "erasure" and drop a legitimate snapshot.
 *
 * @sideEffect Reads `account_erasure_jobs`.
 */
export const ownerErasureRequested = async (
    db: NodePgDatabase<Record<string, never>>,
    ownerId: string,
): Promise<boolean> => {
    const result = await db.execute<{ erased: boolean }>(sql`
        SELECT EXISTS (
            SELECT 1 FROM account_erasure_jobs WHERE owner_id = ${ownerId}
        ) AS erased
    `);

    return result.rows[0]?.erased === true;
};

/**
 * Prune the archived version from Postgres — the FR-007b "newest 10 in the DB" retention step.
 *
 * Runs ONLY after the S3 PUT resolves. This is the archive-before-delete invariant, carried across the
 * async boundary: `recipe-service` deliberately stopped pruning at save time (T130) because the row is
 * the payload a retry replays, so it must outlive every failed attempt.
 *
 * Deleting the version row also clears its `recipe_version_pending_archives` row via `ON DELETE
 * CASCADE` — which is precisely FR-007b-i's *"pending-archive records MUST only be deleted after a
 * successful S3 confirmation"*, enforced by the schema rather than by remembering to do it.
 *
 * @sideEffect Deletes a `recipe_versions` row (cascading its pending-archive row).
 */
export const pruneArchivedVersion = async (
    db: NodePgDatabase<Record<string, never>>,
    versionId: string,
): Promise<void> => {
    await db.execute(sql`DELETE FROM recipe_versions WHERE id = ${versionId}`);
};

const processRecord = async (record: SQSRecord, archiveBucket: string): Promise<void> => {
    const message = parseArchiveMessage(record);
    const db = getRecipeDb();

    const snapshot = await loadVersionSnapshot(db, message);

    // GDPR archive-resurrection guard (C-007 / D7) — see {@link ownerErasureRequested}. Read the erasure
    // state as late as possible, immediately before the PUT, so the read→PUT window is as small as it can
    // be. If the owner has any erasure job on record, do NOT materialise a fresh object under their erased
    // prefix. Treat the version as already-gone: prune the row — idempotent with, and consistent with the
    // end state of, the erasure worker's own delete — so the outbox debt is cleared and this message is
    // not re-dispatched forever, then return without writing. (A missing row throws in loadVersionSnapshot
    // above; here the row still exists, so we prune it deliberately rather than throw.)
    if (await ownerErasureRequested(db, message.ownerId)) {
        await pruneArchivedVersion(db, message.versionId);

        logger.warn('version-archive suppressed: owner has an erasure job on record; snapshot not written', {
            recipeId: message.recipeId,
            versionId: message.versionId,
            versionNumber: message.versionNumber,
            ownerId: message.ownerId,
        });

        return;
    }

    const key = snapshotObjectKey(message);

    await s3.send(
        new PutObjectCommand({
            Bucket: archiveBucket,
            Key: key,
            ContentType: 'application/json',
            Body: JSON.stringify(snapshot),
        }),
    );

    // Only now is the snapshot safe to drop from Postgres. A throw above leaves both the version row
    // and its pending row in place, so SQS redelivery (then the DLQ) retries the exact same payload.
    await pruneArchivedVersion(db, message.versionId);

    logger.info('recipe version archived and pruned', {
        recipeId: message.recipeId,
        versionId: message.versionId,
        versionNumber: message.versionNumber,
        bucket: archiveBucket,
        key,
    });
};

export const handler: SQSHandler = async (event) => {
    const archiveBucket = requireEnv('RECIPE_ARCHIVE_BUCKET');

    logger.info('version-archive-worker invoked', { recordCount: event.Records.length });

    for (const record of event.Records) {
        await processRecord(record, archiveBucket);
    }
};
