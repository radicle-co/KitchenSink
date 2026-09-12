/**
 * THE RECIPE BACKSTOP (plan U12, R29/R30/R32/R34/R36) — owed work that has stopped moving reaches Sentry.
 *
 * ⛔ IT IS READ-ONLY, IN A READ-ONLY TRANSACTION. A backstop that can write is a backstop that can make the
 * thing it is watching worse — and the one failure it must never cause is the one it exists to detect. The
 * transaction is the enforcement, not a convention: a write inside it is refused by Postgres.
 *
 * ⛔ IT ESCALATES, IT DOES NOT ACT. Nothing here re-queues, re-leases, deletes or repairs. Every guarantee in
 * this plan lives in a producer or a consumer; this only reports when one has failed. A backstop that repairs
 * is a second writer nobody designed for, and the first thing it does under load is fight the consumer for
 * the same rows.
 *
 * ⛔ IT READS THE TRANSPORT AS WELL AS THE ROWS, because "slow is not lost" cannot be decided from rows
 * alone. A backlog of owed lines looks identical whether the queue is draining steadily behind it or nothing
 * is carrying the work — and escalating a healthy backlog trains its reader to ignore the signal, which is
 * worse than not having one.
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

import { requireEnv } from '../common/config.js';
import { getRecipePool } from '../common/db.js';
import { initObservability, withObservability } from '../common/observability.js';
import { checkInQueueCheck, escalate } from '../common/queueEscalation.js';
import { RECIPE_WORK_CLASSES, type RecipeWorkClass } from './queueCheckReads.js';

/** The service identifier every escalation from this backstop carries. */
const SERVICE = 'recipe-workers';

/** One work class this check covers, and what a read of it found. */
export interface RecipeOwedCounts {
    /** Owed units whose deadline has passed. */
    readonly owedPastDeadline: number;
    /** Owed units no consumer has ever claimed. */
    readonly neverReceived: number;
    /** Owed units whose attempts reached the allowance. */
    readonly atAllowance: number;
    /** Owed units holding a claim older than any plausible run. */
    readonly claimedTooLong: number;
    /** Age of the oldest owed unit, in seconds. */
    readonly oldestOwedSeconds: number;
}

/** What one SQS queue looked like when the check ran. */
export interface TransportDepth {
    readonly visible: number;
    readonly inFlight: number;
    readonly deadLettered: number;
}

/** One work class: its rows, its transport, and the name it reports under. */
export interface CheckedQueue {
    /** The closed-vocabulary name this class reports under. Never user input. */
    readonly queueName: string;
    readonly counts: () => Promise<RecipeOwedCounts>;
    readonly depth: () => Promise<TransportDepth>;
}

/** What the check needs. A narrow port so the suite drives it without AWS or a database. */
export interface RecipeCheckDeps {
    readonly stage: string;
    readonly service: string;
    readonly queues: readonly CheckedQueue[];
    readonly escalate: (payload: EscalationPayload) => void;
    /**
     * Report to the cron monitor that this run completed. ⛔ Called only after every class has been read, and
     * only on a stage that checks in — see {@link runRecipeQueueCheck}.
     */
    readonly checkIn: () => void;
    readonly now: () => Date;
}

/**
 * Run one check across every work class.
 *
 * ⚠️ Every class is read even when an earlier one escalates. A check that stopped at the first finding would
 * report the loudest problem and hide the others — and the others are exactly what tells an operator whether
 * one consumer is stuck or the whole stage is.
 *
 * @param deps - The stage, the classes, the sink and the clock.
 * @returns One escalation per class that had something to say.
 * @sideEffect Reads the database and SQS; may emit Sentry events.
 */
export async function runRecipeQueueCheck(deps: RecipeCheckDeps): Promise<readonly EscalationPayload[]> {
    // ⛔ THE NIGHTLY WINDOW, FIRST — before any database or SQS call (R35). ADR-0007 stops the non-prod
    // tier's RDS from 00:00 to 09:00; a check that ran would find its database unreachable and every queue
    // apparently stalled, and would escalate every night in every preview. A signal that fires nightly for a
    // reason nobody can act on is a signal its reader mutes.
    if (!isAwake(deps.stage, deps.now())) {
        return [];
    }

    const raised: EscalationPayload[] = [];

    for (const queue of deps.queues) {
        const counts = await queue.counts();
        const depth = await queue.depth();
        const observation: OwedObservation = {
            owedPastDeadline: counts.owedPastDeadline,
            neverReceived: counts.neverReceived,
            atAllowance: counts.atAllowance,
            claimedTooLong: counts.claimedTooLong,
            transportVisible: depth.visible,
            transportInFlight: depth.inFlight,
            transportDeadLettered: depth.deadLettered,
        };

        const condition = classifyOwed(observation);

        if (condition === undefined) {
            continue;
        }

        const payload: EscalationPayload = {
            service: deps.service,
            stage: deps.stage,
            queueName: queue.queueName,
            condition,
            owedCount: counts.owedPastDeadline,
            oldestOwedSeconds: counts.oldestOwedSeconds,
            transportVisible: depth.visible,
            transportInFlight: depth.inFlight,
            transportDeadLettered: depth.deadLettered,
        };

        deps.escalate(payload);
        raised.push(payload);
    }

    // ⛔ THE CHECK-IN IS LAST, AND IT IS UNCONDITIONAL ON THE FINDINGS (R37). Last, because it means "this run
    // completed" — a read that throws rejects out of the loop above and the monitor's silence is then the
    // truth. Unconditional on the findings, because "the backstop is dead" and "the backstop found something"
    // are unrelated failures, and the escalations already carry the second; withholding a check-in because
    // work is stuck would report a live backstop as a dead one every time it did its job.
    //
    // ⚠️ A preview does not check in at all: its stack is torn down when the PR closes, and the monitor it
    // created would then be missing a check-in forever. It escalates what it finds and promises nothing.
    if (checksIn(deps.stage)) {
        deps.checkIn();
    }

    return raised;
}

/**
 * The visible/in-flight/dead-lettered triple for one class.
 *
 * ⚠️ A class with NO transport answers three zeros, and `classifyOwed` reads that as "nothing is carrying
 * this" — which is the correct reading for `test-resets`, whose runner is in-process, and is stated at each
 * such class in `queueCheckReads.ts` rather than left for a reader to infer from a missing env name.
 *
 * @sideEffect Calls SQS `GetQueueAttributes` — a READ. This role holds no other queue permission.
 */
async function depthOf(
    sqs: QueueAttributeReader,
    workClass: RecipeWorkClass,
    env: NodeJS.ProcessEnv,
): Promise<TransportDepth> {
    const queueUrl = workClass.queueUrlEnv === undefined ? undefined : env[workClass.queueUrlEnv];
    const dlqUrl = workClass.dlqUrlEnv === undefined ? undefined : env[workClass.dlqUrlEnv];
    const [live, dead] = await Promise.all([
        queueUrl === undefined ? Promise.resolve({ visible: 0, inFlight: 0 }) : sqs(queueUrl),
        dlqUrl === undefined ? Promise.resolve({ visible: 0, inFlight: 0 }) : sqs(dlqUrl),
    ]);

    return { visible: live.visible, inFlight: live.inFlight, deadLettered: dead.visible };
}

/** Reads one queue's depth. Injected so the suite drives the check without AWS. */
export type QueueAttributeReader = (queueUrl: string) => Promise<{ visible: number; inFlight: number }>;

/**
 * Read every class inside ONE read-only, repeatable-read transaction.
 *
 * ⛔ READ ONLY IS THE ENFORCEMENT, not a convention. A backstop that can write is a backstop that can make
 * the thing it is watching worse, and the one failure it must never cause is the one it exists to detect.
 * `SET TRANSACTION READ ONLY` means Postgres refuses a write here, so "this only reads" is a property of the
 * database rather than of whoever next edits this file.
 *
 * ⛔ REPEATABLE READ so all five statements see ONE snapshot. Under read committed, a consumer claiming rows
 * between two of them produces a combination of counts that never existed at any instant — and the
 * classifier would then name that combination confidently. Food's check reaches the same guarantee with a
 * single statement; five statements need the isolation level instead.
 *
 * @param session - ONE checked-out connection. A `pg.Pool` is deliberately not assignable; see {@link ReadSession}.
 * @param env - Where the per-class parameters are read from.
 * @returns The counts, per class, in `RECIPE_WORK_CLASSES` order.
 * @sideEffect Opens and closes a read-only transaction.
 */
export async function readOnlyCounts(
    session: ReadSession,
    env: NodeJS.ProcessEnv = process.env,
): Promise<readonly RecipeOwedCounts[]> {
    const { query } = session;

    await query('BEGIN TRANSACTION READ ONLY ISOLATION LEVEL REPEATABLE READ');

    try {
        const counts: RecipeOwedCounts[] = [];

        for (const workClass of RECIPE_WORK_CLASSES) {
            const params = workClass.params.map((name) => requirePositiveEnv(name, env));
            const result = await query(workClass.sql, params);

            // ⛔ NARROWED BY THE SHARED READER, never cast and never `?? 0` — see
            // `@kitchensink/queue-check`'s `countRow.ts` for why a default here reports a clean bill of
            // health for a renamed column.
            counts.push(
                countsFrom(result.rows[0], {
                    owedPastDeadline: 'owed_past_deadline',
                    neverReceived: 'never_received',
                    atAllowance: 'at_allowance',
                    claimedTooLong: 'claimed_too_long',
                    oldestOwedSeconds: 'oldest_owed_seconds',
                }),
            );
        }

        return counts;
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
 * A positive integer from the environment.
 *
 * ⛔ THROWS rather than defaulting. A default here is a second definition of a bound the stack owns, and its
 * drift is silent: a backstop measuring staleness against a window nobody configured reports rows as stuck
 * that the consumer is about to finish. A missing value is a deploy fault, and the monitor's silence while
 * it is fixed is the correct signal.
 *
 * @param name - The env name.
 * @param env - The environment to read.
 * @returns The value. Pure apart from the read.
 */
function requirePositiveEnv(name: string, env: NodeJS.ProcessEnv): number {
    const value = Number(env[name]);

    if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`${name} must be a positive integer`);
    }

    return value;
}

/**
 * A lazily-read, once-only batch of every class's counts.
 *
 * ⛔ LAZY AND SHARED, and both halves are load-bearing. LAZY because {@link runRecipeQueueCheck} must reach
 * its nightly-window check before anything touches the database (R35) — a handler that pre-read would call an
 * RDS that ADR-0007 has stopped, every night, in every non-prod stage. SHARED because all five statements
 * must describe ONE instant: five independent reads let a consumer claim rows between two of them and produce
 * a combination that never existed, which the classifier would then name with confidence.
 *
 * @param session - ONE checked-out connection; see {@link ReadSession}.
 * @param env - Where the per-class parameters are read from.
 * @returns A per-class reader; the first call performs the one transaction.
 * @sideEffect Reads the database on first call.
 */
export function batchedCounts(
    session: ReadSession,
    env: NodeJS.ProcessEnv = process.env,
): (index: number) => Promise<RecipeOwedCounts> {
    let pending: Promise<readonly RecipeOwedCounts[]> | undefined;

    return async (index: number): Promise<RecipeOwedCounts> => {
        pending ??= readOnlyCounts(session, env);

        const counts = (await pending)[index];

        if (counts === undefined) {
            throw new Error(`queue check read returned no counts for class ${String(index)}`);
        }

        return counts;
    };
}

/**
 * Build the classes {@link runRecipeQueueCheck} reads, bound to a real database and a real SQS.
 *
 * @param session - ONE checked-out connection; see {@link ReadSession}.
 * @param sqs - Reads one queue's depth.
 * @param env - Where queue URLs and per-class parameters are read from.
 * @returns One {@link CheckedQueue} per entry of `RECIPE_WORK_CLASSES`.
 */
export function checkedQueues(session: ReadSession, sqs: QueueAttributeReader, env: NodeJS.ProcessEnv) {
    const counts = batchedCounts(session, env);

    return RECIPE_WORK_CLASSES.map((workClass, index) => ({
        queueName: workClass.queueName,
        counts: async () => counts(index),
        depth: async () => depthOf(sqs, workClass, env),
    }));
}

/**
 * Read one queue's depth through SQS.
 *
 * ⛔ `GetQueueAttributes` AND NOTHING ELSE. This function's role is granted exactly that action on exactly
 * these queues (`queueProducerRegister.test.ts` asserts it in both directions): a backstop that could receive
 * would take a message from the consumer it is watching, and a backstop that could delete or purge could
 * destroy the very evidence it exists to report. The read is the whole capability.
 *
 * ⚠️ `ApproximateNumberOfMessages` is approximate by contract, which is fine for the question being asked:
 * `classifyOwed` only ever compares it against zero and against owed row counts, never treats it as exact.
 *
 * @param client - An SQS client.
 * @returns A depth reader.
 * @sideEffect Calls SQS.
 */
export function sqsDepthReader(client: SQSClient): QueueAttributeReader {
    return async (queueUrl: string) => {
        const result = await client.send(
            new GetQueueAttributesCommand({
                QueueUrl: queueUrl,
                AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible'],
            }),
        );

        return {
            visible: Number(result.Attributes?.['ApproximateNumberOfMessages'] ?? 0),
            inFlight: Number(result.Attributes?.['ApproximateNumberOfMessagesNotVisible'] ?? 0),
        };
    };
}

/**
 * ⛔ WRAPPED, so a thrown error becomes a Sentry ISSUE rather than only a log line (plan U16) — and for THIS
 * function that matters more than for any other in the package: a backstop that throws every run is a
 * backstop that is not watching, and its silence would otherwise be indistinguishable from a quiet stage.
 * The cron monitor catches the same failure from the other side.
 */
initObservability();

/**
 * The scheduled recipe backstop.
 *
 * @sideEffect Reads the database and SQS; may emit Sentry events and a cron check-in.
 */
async function rawHandler(): Promise<void> {
    const stage = requireEnv('STAGE');
    const sqs = new SQSClient({});
    // ⛔ ONE CHECKED-OUT CONNECTION, held across the whole read. The pool would hand a different backend to
    // every statement, which would leave `BEGIN TRANSACTION READ ONLY` applying to a session nothing else
    // uses — see `ReadSession`. Taken eagerly rather than lazily because `pool.connect()` on an idle pool is
    // a local handshake, not a database round trip, and a lazy acquire would put a second ownership question
    // inside the nightly-window branch for no gain.
    const client = await getRecipePool().connect();

    try {
        await runRecipeQueueCheck({
            stage,
            service: SERVICE,
            queues: checkedQueues(
                {
                    query: async (text, params) => client.query(text, params as unknown[]),
                    release: () => {
                        client.release();
                    },
                },
                sqsDepthReader(sqs),
                process.env,
            ),
            escalate,
            checkIn: () => {
                checkInQueueCheck(stage);
            },
            now: () => new Date(),
        });
    } finally {
        client.release();
    }
}

export const handler = withObservability(rawHandler);
