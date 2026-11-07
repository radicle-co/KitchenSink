import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { and, asc, lte, ne, sql } from 'drizzle-orm';

import { idpDeletionMessageSchema } from '@kitchensink/identity-core';
import { users } from '@kitchensink/identity-db';

import type { DbContext } from './handlerPipeline.js';
import { emitMetric, logger } from './observability.js';

const sqsClient = new SQSClient({});

/**
 * An account whose provider state is behind the database has been owed for at least this long before it is re-driven.
 * A change committed a moment ago is legitimately still in flight on the queue, and re-sending it would only double
 * the worker's work.
 */
export const REDRIVE_GRACE_MS = 15 * 60 * 1000;

/** The most accounts one run re-drives. The next run takes the rest, oldest first, so a backlog drains without a spike. */
export const REDRIVE_BATCH_LIMIT = 200;

/** What one run did. */
export interface RedriveResult {
    readonly scanned: number;
    readonly redriven: number;
    readonly failed: number;
}

/**
 * Wake the deletion worker again for every non-erased account whose provider state is behind the database.
 *
 * ⛔ WHY THIS EXISTS (ADR-0081 §4). A status change commits, THEN sends one SQS message (`suspendUser`,
 * `unsuspendUser`, `deleteUserMe`, `reactivateUser`). When SQS is down at that moment the change stays unapplied and
 * the message is gone: an unsuspended person keeps the suspended mark in their token, and recipe and food answer `403`
 * for good. `queueCheck` only READS and ESCALATES by design (its role holds no send permission), so it cannot repair
 * this. A message is a TRIGGER, not an instruction: the worker reads the stored status and converges, so a repeat,
 * a stale repeat, and a repeat that overlaps the original are all harmless.
 *
 * The owed set is the SAME predicate as migration 0014's partial index and `queueCheck`'s count:
 * `status_applied_version IS DISTINCT FROM status_version`, minus `erased` (erasure has its own re-drive, above).
 *
 * @param db - The identity db handle.
 * @param queueUrl - The deletion queue URL, or `undefined` when the stage has none configured.
 * @param now - The run's instant, so the grace window is a parameter rather than a hidden clock.
 * @returns How many accounts were found, re-sent and failed.
 * @sideEffect Reads `users`, sends SQS messages, emits a metric and logs. Never throws for one account's failure.
 */
export async function redriveUnappliedConvergence(
    db: DbContext['db'],
    queueUrl: string | undefined,
    now: Date,
): Promise<RedriveResult> {
    if (queueUrl === undefined) {
        logger.error('convergence-redrive: DELETION_QUEUE_URL is unset; owed provider changes cannot be re-driven');

        return { scanned: 0, redriven: 0, failed: 0 };
    }

    const cutoff = new Date(now.getTime() - REDRIVE_GRACE_MS);
    const owed = await db
        .select({ id: users.id, identityId: users.identityId, status: users.status })
        .from(users)
        .where(
            and(
                ne(users.status, 'erased'),
                lte(users.updatedAt, cutoff),
                sql`${users.statusAppliedVersion} IS DISTINCT FROM ${users.statusVersion}`,
            ),
        )
        .orderBy(asc(users.updatedAt))
        .limit(REDRIVE_BATCH_LIMIT);

    let redriven = 0;
    let failed = 0;

    for (const account of owed) {
        try {
            // The event name is historical: the worker converges on the stored status whatever it says (U10).
            const message = idpDeletionMessageSchema.parse({
                identityId: account.identityId,
                userId: account.id,
                event: account.status === 'tombstoned' ? 'closure' : 'reactivation',
                enqueuedAt: now.toISOString(),
            });

            await sqsClient.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify(message) }));
            redriven += 1;
            // Dimensionless: the owner id is on the log line below (see the cardinality gate).
            emitMetric('ProviderConvergenceReEnqueued', 1);
            logger.warn('convergence-redrive: provider change was still owed; re-enqueued the convergence trigger', {
                userId: account.id,
            });
        } catch (err) {
            failed += 1;
            logger.error('convergence-redrive: re-enqueue failed; the next run tries again', {
                userId: account.id,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }

    return { scanned: owed.length, redriven, failed };
}
