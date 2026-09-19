/**
 * THE FOOD BACKSTOP (plan U13, R29/R30/R38) — owed work that has stopped moving reaches Sentry.
 *
 * ⛔ IT RIDES THE DRAINER'S OWN REAPER TIMER, and that is the design rather than a shortcut. A separate
 * scheduled function would need its own role, its own VPC attachment (ADR-0004's NAT consumer table, asserted
 * in both directions) and its own database connection — for a query that runs every sixty seconds. Riding the
 * reaper costs none of that, and buys something a separate function could not have: **its silence is the
 * drainer's dead-man signal.** If the drainer stops, the check stops with it, and a cron monitor that expected
 * a check-in reports the drainer's death rather than only its symptoms.
 *
 * ⛔ IT IS READ-ONLY, IN A READ-ONLY TRANSACTION. A backstop that can write is a backstop that can make the
 * thing it is watching worse — and the one failure it must never cause is the one it exists to detect. The
 * transaction is the enforcement, not a convention: a write inside it is refused by Postgres.
 *
 * ⛔ IT ESCALATES, IT DOES NOT ACT. Nothing here re-queues, re-leases, deletes or repairs. Every guarantee in
 * this plan lives in the producer and the consumer; this only reports when one of them has failed, because a
 * backstop that repairs is a second writer nobody designed for and the first thing it does under load is
 * fight the drainer for the same rows.
 *
 * @implements R29 R30 R38
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

import { settingFromEnv } from '../config/env.schema.js';

/** What the check needs. A narrow port so the suite drives it without a drainer. */
export interface QueueCheckDeps {
    /** The deploy stage — decides the awake window and tags the escalation. */
    readonly stage: string;
    /** Runs one read-only query. ⛔ The caller opens the READ ONLY transaction; see `readOnlyCounts`. */
    readonly counts: () => Promise<FoodOwedCounts>;
    /** Where an escalation goes. */
    readonly escalate: (payload: EscalationPayload) => void;
    /**
     * Report to the cron monitor that this run completed.
     *
     * ⛔ For food this is a statement about the DRAINER, not only about the backstop: the check rides the
     * reaper's tick, so a dead drainer stops checking in and the monitor names the cause rather than waiting
     * for the symptoms to pile up.
     */
    readonly checkIn: () => void;
    /** Clock, injected so the nightly window is testable without waiting for midnight. */
    readonly now: () => Date;
}

/** What one read of the food queue found. Counts only — see `escalationPayload.ts` for why. */
export interface FoodOwedCounts {
    /** Queue rows past their lease, which the reaper should have reclaimed. */
    readonly staleLeases: number;
    /** Foods `PENDING` with NO queue row — owed work nothing is carrying. */
    readonly pendingWithNoRow: number;
    /** Pending queue rows eligible to be claimed right now. */
    readonly claimablePending: number;
    /** Rows currently leased. */
    readonly inFlight: number;
    /** Tombstoned rows whose food is `FAILED` — the dead-letter analog. */
    readonly failedTombstones: number;
    /** Age of the oldest pending row, in seconds. */
    readonly oldestPendingSeconds: number;
}

/** The work class this check reports under. A closed vocabulary, per the payload rule. */
const QUEUE_NAME = 'food-fetch';

/**
 * Run one check.
 *
 * @param deps - The stage, the read, the sink and the clock.
 * @returns The escalation raised, or `undefined` when there was nothing to say.
 * @sideEffect Reads the database; may emit one Sentry event.
 */
export async function runQueueCheck(deps: QueueCheckDeps): Promise<EscalationPayload | undefined> {
    // ⛔ THE NIGHTLY WINDOW, FIRST — before any database call (R35). ADR-0007 stops the non-prod tier's RDS
    // from 00:00 to 09:00; a check that ran would find its database unreachable and every queue apparently
    // stalled, and would escalate every night in every preview. A signal that fires nightly for a reason
    // nobody can act on is a signal its reader mutes, and the one time it means something is the night they
    // do not look.
    if (!isAwake(deps.stage, deps.now())) {
        return undefined;
    }

    const counts = await deps.counts();

    // ⛔ THE CHECK-IN IS ISSUED AS SOON AS THE READ SUCCEEDS, AND BEFORE EITHER RETURN BELOW. It means "this
    // run completed", so the quiet case — nothing owed, nothing to say — is exactly the case it must cover:
    // a check that only checked in when it found something would report a healthy stage as a dead backstop,
    // which is the alert inverted. A read that throws never reaches here, and that silence is the truth.
    //
    // ⚠️ A preview does not check in at all: its stack is torn down when the PR closes (ADR-0005), and the
    // monitor it created would be missing a check-in forever afterwards. It escalates and promises nothing.
    if (checksIn(deps.stage)) {
        deps.checkIn();
    }

    const observation: OwedObservation = {
        owedPastDeadline: counts.pendingWithNoRow + counts.staleLeases,
        // ⛔ A PENDING food with no queue row is the LOST case exactly: the row that would carry it does not
        // exist, so nothing is coming for it and no amount of waiting changes that.
        neverReceived: counts.pendingWithNoRow,
        // This queue's allowance is spent by the consumer, which tombstones on exhaustion — so an exhausted
        // unit is a FAILED tombstone rather than a row still carrying attempts.
        atAllowance: 0,
        claimedTooLong: counts.staleLeases,
        transportVisible: counts.claimablePending,
        transportInFlight: counts.inFlight,
        transportDeadLettered: counts.failedTombstones,
    };

    const condition = classifyOwed(observation);

    if (condition === undefined) {
        return undefined;
    }

    const payload: EscalationPayload = {
        service: 'food-service',
        stage: deps.stage,
        queueName: QUEUE_NAME,
        condition,
        owedCount: observation.owedPastDeadline,
        oldestOwedSeconds: counts.oldestPendingSeconds,
        transportVisible: observation.transportVisible,
        transportInFlight: observation.transportInFlight,
        transportDeadLettered: observation.transportDeadLettered,
    };

    deps.escalate(payload);

    return payload;
}

/**
 * Read the counts inside a READ ONLY transaction.
 *
 * ⛔ THE TRANSACTION IS THE ENFORCEMENT, not a convention. A backstop that can write is a backstop that can
 * make the thing it is watching worse — and the one failure it must never cause is the one it exists to
 * detect. `SET TRANSACTION READ ONLY` means Postgres refuses a write here, so "this only reads" is a
 * property of the database rather than of whoever next edits this function.
 *
 * ⚠️ ONE statement, with every count as a scalar subquery, rather than six round trips. They must describe
 * the SAME instant: six separate reads would let the drainer claim a row between two of them and produce a
 * combination that never existed — which the classifier would then confidently name.
 *
 * ⚠️ The lease window comes from the SAME configured value the reaper uses (`FOOD_LEASE_TIMEOUT_SECONDS`,
 * derived by `leaseWindow.ts`), never a literal. A backstop measuring staleness against a different window
 * than the reaper reclaims on would report rows as stuck that the reaper is about to take, or miss rows it
 * has already given up on — and both readings would look authoritative.
 *
 * @param session - ONE checked-out connection. A `pg.Pool` is deliberately not assignable — see
   `@kitchensink/queue-check`'s `readSession.ts`, whose whole purpose is that this caller cannot pass one.
 * @returns The counts.
 * @sideEffect Opens and closes a read-only transaction.
 */
export async function readOnlyCounts(
    session: ReadSession,
    leaseSeconds: number = settingFromEnv('FOOD_LEASE_TIMEOUT_SECONDS'),
): Promise<FoodOwedCounts> {
    const { query } = session;

    await query('BEGIN TRANSACTION READ ONLY');

    try {
        const result = await query(
            `
            SELECT
                (SELECT count(*) FROM fetch_queue
                  WHERE status = 'in_flight'
                    AND leased_at < now() - make_interval(secs => $1))::int AS stale_leases,
                (SELECT count(*) FROM food f
                  WHERE f.status = 'PENDING'
                    AND NOT EXISTS (SELECT 1 FROM fetch_queue q WHERE q.food_id = f.id))::int AS pending_no_row,
                (SELECT count(*) FROM fetch_queue
                  WHERE status = 'pending' AND last_requested <= now())::int AS claimable_pending,
                (SELECT count(*) FROM fetch_queue WHERE status = 'in_flight')::int AS in_flight,
                (SELECT count(*) FROM fetch_queue q JOIN food f ON f.id = q.food_id
                  WHERE q.status = 'tombstone' AND f.status = 'FAILED')::int AS failed_tombstones,
                COALESCE((SELECT EXTRACT(EPOCH FROM (now() - min(first_requested)))::int
                            FROM fetch_queue WHERE status = 'pending'), 0) AS oldest_pending_seconds
        `,
            [leaseSeconds],
        );

        // ⛔ NARROWED, NOT CAST, AND NEVER `?? 0`. This used to read
        // `result.rows[0] as Record<string, number>` and default each column — which turns a renamed column,
        // an edited subquery, an empty result set or a NULL from an un-COALESCEd `MAX()` into ZERO OWED WORK.
        // `classifyOwed` reads that as "nothing is owed", so the check says nothing and the stage looks
        // exactly as healthy as one where nothing is stuck: the precise failure ADR-0041 exists to remove,
        // reintroduced inside the code that implements it. A throw is loud — the log names the column and the
        // missed cron check-in says the backstop is down. See `@kitchensink/queue-check`'s `countRow.ts`.
        return countsFrom(result.rows[0], {
            staleLeases: 'stale_leases',
            pendingWithNoRow: 'pending_no_row',
            claimablePending: 'claimable_pending',
            inFlight: 'in_flight',
            failedTombstones: 'failed_tombstones',
            oldestPendingSeconds: 'oldest_pending_seconds',
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
