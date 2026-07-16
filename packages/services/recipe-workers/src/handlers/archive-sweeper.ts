import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';

import { requireEnv } from '../common/config.js';
import { getRecipeDb } from '../common/db.js';
import { logger } from '../common/logger.js';
import type { RecipeVersionArchiveMessage } from './version-archive-worker.js';

/**
 * Scheduled version-archive sweeper (T132 / FR-007b-i) — the only thing that turns outbox rows into
 * SQS messages. VPC-attached DB consumer.
 *
 * `recipe-service` deliberately does NOT enqueue on save. It writes the
 * `recipe_version_pending_archives` row and nothing else, because FR-007b-i requires a save to succeed
 * *"independently of the S3 version-archive write"* — and a save that enqueues is a save that fails when
 * SQS is unreachable. So the ROW is the source of truth and the message is a derived artifact.
 *
 * That inversion is what makes the path durable end to end: a dropped message, a throttled send, or an
 * SQS outage loses nothing, because the row survives and the next tick re-dispatches it. It is also why
 * this sweeper does not mark rows `in_flight` — a row is cleared exactly one way, by the worker
 * deleting the version after S3 confirms (which cascades the outbox row away). Anything else risks a
 * row that is "claimed" forever because the claimer died.
 *
 * Duplicate dispatch is therefore expected and harmless: two messages for one version make the worker
 * archive the same immutable object twice at the same deterministic key, and the second prune is a
 * no-op DELETE. At-least-once is the right trade here — at-most-once would risk losing a snapshot.
 */

/** The outbox columns the sweeper needs to build a message (raw — this Lambda has no Drizzle schema). */
export type PendingArchiveRow = {
    readonly id: string;
    readonly recipe_version_id: string;
    readonly recipe_id: string;
    readonly version_number: number;
    /** The version's `created_by` — the app-user ULID that owns the archive's key prefix. */
    readonly created_by: string;
};

const sqs = new SQSClient({});

/** How many rows one tick dispatches. Bounds the Lambda's runtime; the next tick takes the rest. */
const SWEEP_BATCH_SIZE = 100;

/**
 * Shape an outbox row into the worker's message contract.
 *
 * @param row - The claimable outbox row joined to its version's owner.
 * @param requestedAt - ISO 8601 dispatch time.
 * @returns The message body. Pure.
 */
export function toArchiveMessage(row: PendingArchiveRow, requestedAt: string): RecipeVersionArchiveMessage {
    return {
        recipeId: row.recipe_id,
        versionId: row.recipe_version_id,
        // Both are required: `versionNumber` keys the archive object (ARCH-BE-3) and `ownerId` scopes it
        // under the prefix GDPR erasure sweeps (verticals-8).
        versionNumber: row.version_number,
        ownerId: row.created_by,
        requestedAt,
    };
}

/**
 * Read the claimable outbox rows, newest debt last.
 *
 * Selects exactly the set `idx_pending_archives_status_next` covers (`status IN ('pending','failed')`
 * with `next_attempt_at` due), joined to `recipe_versions` for the owner. Ordering by `next_attempt_at`
 * means a row that has failed and backed off waits its turn rather than starving fresh work.
 *
 * @sideEffect Reads `recipe_version_pending_archives` + `recipe_versions`.
 */
export async function claimPendingArchives(db: NodePgDatabase<Record<string, never>>): Promise<PendingArchiveRow[]> {
    const result = await db.execute<PendingArchiveRow>(sql`
        SELECT pa.id, pa.recipe_version_id, pa.recipe_id, pa.version_number, rv.created_by
        FROM recipe_version_pending_archives pa
        JOIN recipe_versions rv ON rv.id = pa.recipe_version_id
        WHERE pa.status IN ('pending', 'failed')
          AND pa.next_attempt_at <= now()
        ORDER BY pa.next_attempt_at ASC
        LIMIT ${SWEEP_BATCH_SIZE}
    `);

    return [...result.rows];
}

/**
 * The TOTAL outstanding backlog — every un-archived row, not just this tick's batch.
 *
 * Counted separately from {@link claimPendingArchives} on purpose: that read is capped at
 * {@link SWEEP_BATCH_SIZE}, so using its length as the backlog would silently cap the metric at the
 * batch size and an alarm threshold of 100 could never fire. FR-007b-i bounds the real backlog at 100,
 * so the real backlog is what must be measured.
 *
 * @sideEffect Reads `recipe_version_pending_archives`.
 */
export async function countBacklog(db: NodePgDatabase<Record<string, never>>): Promise<number> {
    const result = await db.execute<{ count: number }>(sql`
        SELECT count(*)::int AS count FROM recipe_version_pending_archives
    `);

    return result.rows[0]?.count ?? 0;
}

/**
 * Publish the backlog as a CloudWatch metric via the embedded metric format.
 *
 * EMF (a structured log line CloudWatch parses out of the Lambda's log group) rather than
 * `PutMetricData`: it needs no extra SDK client, no `cloudwatch:PutMetricData` grant on the sweeper's
 * role, and costs one log line. The backlog is a database row count, invisible to CloudWatch otherwise
 * — without this the T138 alarm would have no data and would sit silently in INSUFFICIENT_DATA.
 *
 * @sideEffect Writes one EMF line to stdout.
 */
export function emitBacklogMetric(stage: string, backlog: number): void {
    // eslint-disable-next-line no-console
    console.log(
        JSON.stringify({
            _aws: {
                Timestamp: Date.now(),
                CloudWatchMetrics: [
                    {
                        Namespace: 'Commise/RecipeArchive',
                        Dimensions: [['Stage']],
                        Metrics: [{ Name: 'PendingArchiveBacklog', Unit: 'Count' }],
                    },
                ],
            },
            Stage: stage,
            PendingArchiveBacklog: backlog,
        }),
    );
}

/**
 * Dispatch every due outbox row to the archive queue.
 *
 * @throws When `RECIPE_ARCHIVE_QUEUE_URL` is unset — sweeping into the void would silently drain the
 *   backlog to nowhere while reporting success.
 * @sideEffect Reads the outbox and sends SQS messages.
 */
export const handler = async (): Promise<void> => {
    const queueUrl = requireEnv('RECIPE_ARCHIVE_QUEUE_URL');
    const db = getRecipeDb();

    // Emitted every tick, including when drained — a metric that only appears while broken cannot be
    // alarmed on reliably (the alarm would flap into INSUFFICIENT_DATA the moment things recover).
    const backlog = await countBacklog(db);
    emitBacklogMetric(process.env['STAGE'] ?? 'unknown', backlog);

    const rows = await claimPendingArchives(db);

    if (rows.length === 0) {
        return;
    }

    const requestedAt = new Date().toISOString();
    let dispatched = 0;

    for (const row of rows) {
        try {
            await sqs.send(
                new SendMessageCommand({
                    QueueUrl: queueUrl,
                    MessageBody: JSON.stringify(toArchiveMessage(row, requestedAt)),
                }),
            );
            dispatched += 1;
        } catch (error) {
            // Per-row, not per-batch: one throttled send must not abandon the rest of the backlog. The
            // row keeps its outbox record and the next tick re-dispatches it.
            logger.error('archive-sweeper: dispatch failed', {
                recipeVersionId: row.recipe_version_id,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    logger.info('archive-sweeper swept', { claimed: rows.length, dispatched });
};
