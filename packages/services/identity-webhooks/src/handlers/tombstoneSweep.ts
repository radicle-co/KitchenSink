import type { Context, ScheduledEvent } from 'aws-lambda';
import { and, eq, lte } from 'drizzle-orm';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';

import { users } from '@kitchensink/identity-db';

import { getConfig } from '../config/env.js';
import { withDb, type DbContext } from '../common/handlerPipeline.js';
import { eraseIdentityRow } from '../common/eraseIdentity.js';
import { deleteUser } from '../common/identityClient.js';
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

/** True when a Clerk delete failed only because the user was already deleted (idempotent-safe to proceed). */
function isAlreadyDeleted(err: unknown): boolean {
    return typeof err === 'object' && err !== null && (err as { status?: number }).status === 404;
}

const sqsClient = new SQSClient({});

/** An expired tombstone to erase — the durable ULID + the Clerk `sub` the erasure deletes. */
interface ExpiredTombstone {
    id: string;
    identityId: string;
}

/**
 * Enqueue the recipe/food erasure legs via the EXISTING deletion path (SEAM). The identity-side scrub +
 * Clerk delete are done in-sweep; the downstream consumers — recipe erasure (U3) and food `eraseUser`
 * (U4/R11) — are a separate follow-up unit, so the deletion-worker's `erasure` branch is currently a
 * no-op that logs. Wiring the real fan-out happens in U4b.
 *
 * @sideEffect sends an erasure message to the SQS deletion queue.
 */
async function enqueueErasureLegs(queueUrl: string, tombstone: ExpiredTombstone): Promise<void> {
    await sqsClient.send(
        new SendMessageCommand({
            QueueUrl: queueUrl,
            MessageBody: JSON.stringify({
                identityId: tombstone.identityId,
                userId: tombstone.id,
                event: 'erasure',
                enqueuedAt: new Date().toISOString(),
            }),
        }),
    );
}

/** The sweep result — how many tombstones were scanned and how many were fully erased this run. */
interface SweepResult {
    scanned: number;
    erased: number;
    failed: number;
}

/**
 * The scheduled 12-month tombstone → erasure sweep (KTD-3). Idempotent: it only selects `tombstoned` rows past
 * the retention cutoff; once erased (`status='erased'`) a row is never re-selected. Per user, ordered for
 * convergence: Clerk `deleteUser` FIRST (tolerating an already-deleted 404), THEN the DB scrub + audit, THEN
 * the recipe/food erasure legs (U3/U4 seam). A Clerk failure for one user is logged and skips only that user
 * (retried next run) — it never aborts the batch.
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
        .where(and(eq(users.status, 'tombstoned'), lte(users.deletedAt, cutoff)))) as ExpiredTombstone[];

    let erased = 0;
    let failed = 0;

    for (const tombstone of expired) {
        // Clerk delete FIRST (the irreversible external action), tolerating an already-deleted 404 so a
        // crash-after-delete retry still converges. Any other failure skips THIS user (left tombstoned,
        // retried next run) without aborting the batch — never leaving the DB erased while Clerk survives.
        try {
            await deleteUser(tombstone.identityId);
        } catch (err) {
            if (!isAlreadyDeleted(err)) {
                failed += 1;
                // Dimensionless — both ids are on the log line below (see the cardinality gate).
                emitMetric('TombstoneErasureClerkDeleteFailed', 1);
                logger.error('tombstone-sweep: Clerk deleteUser failed; leaving tombstone for next run', {
                    identityId: tombstone.identityId,
                    userId: tombstone.id,
                    error: err instanceof Error ? err.message : String(err),
                });
                continue;
            }
        }

        await eraseIdentityRow(db, { userId: tombstone.id, triggerSource: 'sweep', actor: null }, now);

        // Enqueue the recipe/food erasure legs via the existing deletion path (U3/U4 seam). Best-effort: a
        // failed enqueue leaves the identity erased but the downstream legs unqueued — a gap the (unbuilt)
        // U4b erasure-reconciliation is designed to detect; it must not undo the completed identity erasure.
        if (DELETION_QUEUE_URL !== undefined) {
            try {
                await enqueueErasureLegs(DELETION_QUEUE_URL, tombstone);
            } catch (err) {
                logger.error('tombstone-sweep: failed to enqueue recipe/food erasure legs (identity erased)', {
                    userId: tombstone.id,
                    error: err instanceof Error ? err.message : String(err),
                });
            }
        } else {
            logger.warn('tombstone-sweep: DELETION_QUEUE_URL unset; recipe/food erasure legs NOT enqueued', {
                userId: tombstone.id,
            });
        }

        erased += 1;
        logger.info('tombstone-sweep: identity erased', { userId: tombstone.id, identityId: tombstone.identityId });
    }

    emitMetric('TombstoneErasureSwept', erased);
    logger.info('tombstone-sweep complete', { scanned: expired.length, erased, failed });

    return { scanned: expired.length, erased, failed };
};

/** @implements CR-002 KTD-3 R3 R8 */
export const handler = withObservability(withDb(innerHandler));
