/**
 * THE IDENTITY BACKSTOP (plan U12, R29/R30/R32/R34/R36) — owed provider work that has stopped moving reaches
 * Sentry.
 *
 * ⛔ WHAT IT WATCHES, and why each one is invisible without it:
 *
 *  - **Unapplied closures and reactivations.** U10 made a status change carry a VERSION and the worker settle
 *    only what it actually applied, so "the provider is behind the database" is now a readable fact rather
 *    than an inference. Before that pair existed there was no way to ask the question at all — an account
 *    `tombstoned` here and still active at Clerk looked exactly like one that was fine.
 *  - **Owed handle syncs.** U9 made a rename record that a sync is owed. A failed publish previously left
 *    nothing behind: the cook's name changed here, never changed on their recipes, and the only trace was one
 *    log line.
 *  - **The deletion queue's depth**, which is the transport those closures ride. Without it, owed rows and a
 *    dead queue are indistinguishable from owed rows and a busy one.
 *
 * ⛔ READ-ONLY, and ESCALATE-ONLY. It never bans, unbans, re-enqueues or repairs — every guarantee lives in
 * the producer and the worker, and a backstop that repairs is a second writer nobody designed for.
 *
 * @implements R29 R30 R32 R34 R36
 */
import {
    checksIn,
    classifyOwed,
    countsFrom,
    isAwake,
    type EscalationPayload,
    type OwedObservation,
    type ReadSession,
} from '@kitchensink/queue-check';

import { GetQueueAttributesCommand, SQSClient } from '@aws-sdk/client-sqs';

import { getIdentityPool } from '../common/db.js';
import { withObservability } from '../common/observability.js';
import { checkInQueueCheck, escalate } from '../common/queueEscalation.js';

/** What one read of identity's owed work found. Counts only — see `escalationPayload.ts` for why. */
export interface IdentityOwedCounts {
    /** Accounts whose provider state is behind the database and are not erased (U10). */
    readonly unappliedStatusChanges: number;
    /** Renames whose handle sync is still owed (U9). */
    readonly owedHandleSyncs: number;
    /** Owed syncs that recorded a failure code — the gate tried and could not. */
    readonly failedHandleSyncs: number;
    /**
     * Age of the oldest unapplied status change, in seconds.
     *
     * ⛔ ONE AGE PER WORK CLASS. A single figure over both populations is the OLDER of the two, so a
     * handle-sync escalation could report the age of a stranded account closure and send an operator to the
     * wrong table.
     */
    readonly oldestConvergenceSeconds: number;
    /** Age of the oldest owed handle sync, in seconds. */
    readonly oldestHandleSyncSeconds: number;
}

/** The deletion queue's depth when the check ran. */
export interface DeletionQueueDepth {
    readonly visible: number;
    readonly inFlight: number;
    readonly deadLettered: number;
}

/** What the check needs. A narrow port so the suite drives it without AWS or a database. */
export interface IdentityCheckDeps {
    readonly stage: string;
    readonly counts: () => Promise<IdentityOwedCounts>;
    readonly depth: () => Promise<DeletionQueueDepth>;
    readonly escalate: (payload: EscalationPayload) => void;
    /** Report to the cron monitor that this run completed. Called last, and only on a checking-in stage. */
    readonly checkIn: () => void;
    readonly now: () => Date;
}

/** The two work classes this check reports under. A closed vocabulary, per the payload rule. */
const PROVIDER_CONVERGENCE = 'identity-provider-convergence';
const HANDLE_SYNC = 'identity-handle-sync';

/**
 * Run one check.
 *
 * @param deps - The stage, the reads, the sink and the clock.
 * @returns One escalation per class that had something to say.
 * @sideEffect Reads the database and SQS; may emit Sentry events.
 */
export async function runIdentityQueueCheck(deps: IdentityCheckDeps): Promise<readonly EscalationPayload[]> {
    // The nightly window, before any call (R35) — see the recipe check for the full argument.
    if (!isAwake(deps.stage, deps.now())) {
        return [];
    }

    const counts = await deps.counts();
    const depth = await deps.depth();
    const raised: EscalationPayload[] = [];

    const report = (queueName: string, observation: OwedObservation, oldestOwedSeconds: number): void => {
        const condition = classifyOwed(observation);

        if (condition === undefined) {
            return;
        }

        const payload: EscalationPayload = {
            service: 'identity-webhooks',
            stage: deps.stage,
            queueName,
            condition,
            owedCount: observation.owedPastDeadline,
            oldestOwedSeconds,
            transportVisible: observation.transportVisible,
            transportInFlight: observation.transportInFlight,
            transportDeadLettered: observation.transportDeadLettered,
        };

        deps.escalate(payload);
        raised.push(payload);
    };

    report(
        PROVIDER_CONVERGENCE,
        {
            owedPastDeadline: counts.unappliedStatusChanges,
            // ⛔ The DELETION QUEUE is the transport for these, so an unapplied change with an empty queue is
            // LOST — nothing is carrying it — while the same count behind a busy queue is merely late. This
            // is the whole "slow is not lost" rule, applied to the one work class where getting it wrong
            // means telling an operator an account is stranded when it is thirty seconds from converging.
            neverReceived: counts.unappliedStatusChanges,
            atAllowance: 0,
            claimedTooLong: 0,
            transportVisible: depth.visible,
            transportInFlight: depth.inFlight,
            transportDeadLettered: depth.deadLettered,
        },
        counts.oldestConvergenceSeconds,
    );

    report(
        HANDLE_SYNC,
        {
            owedPastDeadline: counts.owedHandleSyncs,
            // ⚠️ An owed sync with NO failure code was never attempted — nothing is carrying it. One WITH a
            // code was attempted and refused, which is a different thing an operator acts on differently, so
            // it is reported as exhausted rather than lost.
            neverReceived: counts.owedHandleSyncs - counts.failedHandleSyncs,
            atAllowance: counts.failedHandleSyncs,
            claimedTooLong: 0,
            // ⚠️ Handle sync publishes to SNS, which has no readable depth — so this class has no transport
            // to consult, and its rows are judged alone. Stated rather than left as three zeros a reader
            // would take for "the queue is empty".
            transportVisible: 0,
            transportInFlight: 0,
            transportDeadLettered: 0,
        },
        counts.oldestHandleSyncSeconds,
    );

    // The dead-man check-in (R37) — last, and unconditional on the findings. See the recipe check for the
    // full argument; the reasoning is identical and deliberately not restated here.
    if (checksIn(deps.stage)) {
        deps.checkIn();
    }

    return raised;
}

/**
 * ⛔ THE ONE STATEMENT, inside a READ ONLY transaction.
 *
 * READ ONLY is the enforcement rather than a convention: a backstop that can write is a backstop that can
 * make the thing it is watching worse, and the one failure it must never cause is the one it exists to
 * detect. `SET TRANSACTION READ ONLY` means Postgres refuses a write here, so "this only reads" is a
 * property of the database rather than of whoever next edits this file.
 *
 * ⚠️ ONE statement with every count as a scalar subquery, rather than four round trips. They must describe
 * the SAME instant: separate reads would let the deletion worker converge an account between two of them and
 * produce a combination that never existed, which `classifyOwed` would then name with confidence.
 *
 * ⚠️ `status_applied_version IS DISTINCT FROM status_version` is the SAME predicate as migration 0014's
 * partial index, so this read uses it rather than scanning. An `erased` account is excluded because its
 * provider account is already gone — there is nothing left to converge, and counting it would escalate a
 * completed erasure forever.
 */
const IDENTITY_OWED_SQL = `
    SELECT
        (SELECT count(*) FROM users
          WHERE status_applied_version IS DISTINCT FROM status_version
            AND status <> 'erased')::int AS unapplied_status_changes,
        (SELECT count(*) FROM profiles WHERE handle_sync_owed_at IS NOT NULL)::int AS owed_handle_syncs,
        (SELECT count(*) FROM profiles
          WHERE handle_sync_owed_at IS NOT NULL AND handle_sync_failure_code IS NOT NULL)::int
            AS failed_handle_syncs,
        -- ⛔ ONE AGE PER WORK CLASS, not a GREATEST over both. A single figure is the OLDER of the two
        -- populations, so a handle-sync escalation could report the age of a stranded account closure and
        -- vice versa — an operator reading "oldest owed: 9 hours" would look at the wrong table. The
        -- populations are unrelated: one is an identity-provider convergence, the other a display name.
        COALESCE(
            (SELECT MAX(EXTRACT(EPOCH FROM (now() - updated_at))) FROM users
              WHERE status_applied_version IS DISTINCT FROM status_version AND status <> 'erased'),
            0
        )::int AS oldest_convergence_seconds,
        COALESCE(
            (SELECT MAX(EXTRACT(EPOCH FROM (now() - handle_sync_owed_at))) FROM profiles
              WHERE handle_sync_owed_at IS NOT NULL),
            0
        )::int AS oldest_handle_sync_seconds
`;

/**
 * Read the owed counts inside a read-only transaction.
 *
 * @param session - ONE checked-out connection. A `pg.Pool` is deliberately not assignable; see {@link ReadSession}.
 * @returns The counts.
 * @sideEffect Opens and closes a read-only transaction.
 */
export async function readOnlyCounts(session: ReadSession): Promise<IdentityOwedCounts> {
    const { query } = session;

    await query('BEGIN TRANSACTION READ ONLY');

    try {
        const result = await query(IDENTITY_OWED_SQL);

        // ⛔ NARROWED BY THE SHARED READER, never cast and never `?? 0` — see
        // `@kitchensink/queue-check`'s `countRow.ts` for why a default here reports a clean bill of health
        // for a renamed column.
        return countsFrom(result.rows[0], {
            unappliedStatusChanges: 'unapplied_status_changes',
            owedHandleSyncs: 'owed_handle_syncs',
            failedHandleSyncs: 'failed_handle_syncs',
            oldestConvergenceSeconds: 'oldest_convergence_seconds',
            oldestHandleSyncSeconds: 'oldest_handle_sync_seconds',
        });
    } finally {
        // ⛔ ROLLBACK, AND ITS FAILURE IS SWALLOWED. Two things were wrong with `await query('COMMIT')` here.
        // `COMMIT` is the wrong verb for a transaction that wrote nothing — `ROLLBACK` says what happened and
        // is what an aborted transaction needs anyway. And an unswallowed statement in a `finally` REPLACES
        // the error being propagated: on a dead connection the read's own failure would be thrown away and
        // the Sentry issue would name the rollback instead, in the one module whose value is explaining why
        // it cannot see.
        await query('ROLLBACK').catch(() => undefined);
    }
}

/**
 * Read the deletion queue's depth.
 *
 * ⛔ `GetQueueAttributes` AND NOTHING ELSE. This function's role is granted exactly that action on exactly
 * this queue (`queueProducerRegister.test.ts` asserts it in both directions), and the deletion queue is the
 * one that carries GDPR Art. 17 erasure — a backstop that could receive from it would take an erasure out of
 * the hands of the single consumer that guard keeps it to.
 *
 * @param client - An SQS client.
 * @param queueUrl - The queue.
 * @param dlqUrl - Its dead-letter queue.
 * @returns The depth triple.
 * @sideEffect Calls SQS.
 */
export async function readDeletionQueueDepth(
    client: SQSClient,
    queueUrl: string,
    dlqUrl: string,
): Promise<DeletionQueueDepth> {
    const attributes = async (url: string): Promise<{ visible: number; inFlight: number }> => {
        const result = await client.send(
            new GetQueueAttributesCommand({
                QueueUrl: url,
                AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible'],
            }),
        );

        return {
            visible: Number(result.Attributes?.['ApproximateNumberOfMessages'] ?? 0),
            inFlight: Number(result.Attributes?.['ApproximateNumberOfMessagesNotVisible'] ?? 0),
        };
    };

    const [live, dead] = await Promise.all([attributes(queueUrl), attributes(dlqUrl)]);

    return { visible: live.visible, inFlight: live.inFlight, deadLettered: dead.visible };
}

/**
 * The scheduled identity backstop.
 *
 * ⚠️ The reads are LAZY — passed as thunks rather than awaited here — because {@link runIdentityQueueCheck}
 * must reach its nightly-window check before anything touches the database or SQS (R35). A handler that
 * pre-read would call an RDS that ADR-0007 has stopped, every night, in every non-prod stage.
 *
 * @sideEffect Reads the database and SQS; may emit Sentry events and a cron check-in.
 */
async function rawHandler(): Promise<void> {
    const stage = requireEnvValue('STAGE');
    const queueUrl = requireEnvValue('DELETION_QUEUE_URL');
    const dlqUrl = requireEnvValue('DELETION_DLQ_URL');
    const sqs = new SQSClient({});

    await runIdentityQueueCheck({
        stage,
        // ⛔ ONE CHECKED-OUT CONNECTION, held for the whole read and released whatever happens. The pool
        // would hand a different backend to each statement, leaving the read-only transaction applying to a
        // session nothing else uses — see `ReadSession`. Acquired INSIDE the thunk so the nightly-window
        // check still runs before anything touches the database (R35).
        counts: async () => {
            const client = await (await getIdentityPool()).connect();

            try {
                return await readOnlyCounts({
                    query: async (text, params) => client.query(text, params as unknown[]),
                    release: () => {
                        client.release();
                    },
                });
            } finally {
                client.release();
            }
        },
        depth: async () => readDeletionQueueDepth(sqs, queueUrl, dlqUrl),
        escalate,
        checkIn: () => {
            checkInQueueCheck(stage);
        },
        now: () => new Date(),
    });
}

/**
 * A required environment value.
 *
 * ⛔ THROWS rather than defaulting: a backstop pointed at a queue URL somebody guessed reports on the wrong
 * queue, which is worse than not reporting at all. A missing value is a deploy fault, and the cron monitor's
 * silence while it is fixed is the correct signal.
 *
 * @param name - The env name.
 * @returns The value.
 */
function requireEnvValue(name: string): string {
    const value = process.env[name];

    if (value === undefined || value === '') {
        throw new Error(`${name} is required`);
    }

    return value;
}

export const handler = withObservability(rawHandler);
