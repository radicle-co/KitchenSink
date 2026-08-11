/**
 * FR-043 ranking equivalence, differentially: {@link FetchQueueDao.leaseNext} must drain a queue in the
 * SAME order as the specification's own ranking, over randomised queues that sweep the demotion regime.
 *
 * ## Why this exists as a committed suite
 *
 * `leaseNext` has now been optimised twice, and each time the justification was "the ranking is
 * unchanged". T-197 turned the fairness term from the leading `ORDER BY` key into a filter over an
 * `over_demand` CTE; T-201 added a `promoted_ready` probe that lets the promoted branch be skipped
 * entirely when it would return nothing. Both are behaviour-preserving by argument — and T-197's evidence
 * for that argument was **a throwaway script that is not in this repository**: `tasks.md` records "a
 * differential harness ran the old and new rankings over 12 randomised queues … 0 disagreements / 12
 * trials", and nothing reproduces it. An unreproducible equivalence proof protects the change that was
 * made and nothing after it, which is precisely the position the NEXT optimisation would inherit.
 *
 * So the oracle here is not "the previous query" — chaining a rewrite to its immediate predecessor lets a
 * drift introduced in step N be blessed forever by step N+1. It is **FR-043 stated literally**: demotion
 * as the leading sort key, computed per row as a correlated per-requester `COUNT(*)`, which is the shape
 * the requirement describes and the shape T-195 measured at 20 seconds a claim. It is far too slow to
 * ship and perfectly adequate to be right, which is exactly what an oracle should be.
 *
 * ## What is compared
 *
 * The whole DRAIN ORDER, not one claim: each trial seeds a queue, drains it to empty through the oracle
 * recording the sequence, restores the queue byte-for-byte from a snapshot table, drains it again through
 * the real DAO, and requires the two sequences to be identical. A single-claim comparison would miss a
 * ranking that is right at the head and wrong in the tail — and the tail is exactly where a
 * "prove the promoted tier is empty" short-circuit could go wrong.
 *
 * The oracle mirrors the DAO's own reaper-on-claim (FR-018): it reverts lapsed `in_flight` leases before
 * ranking, because a lapsed row competes by demand like any pending row and dropping that step would make
 * the oracle disagree for a reason that has nothing to do with fairness.
 *
 * ## Fixture design (each element earns its place)
 *
 * `mulberry32` keyed on the trial index makes every trial reproducible from its number alone — a failure
 * reports a seed, not "it happened once". Each trial randomises depth, requester population, per-requester
 * fan-out and the threshold so trials land across the regime: some with nothing demoted, some with
 * everything demoted, and — the interesting ones — some MIXED, where the promoted tier is non-empty but
 * thin, which is where a short-circuit that fires one row too early would show. Deliberately included:
 * foods with NO requester rows (vacuously demoted, the only tier decided by ABSENCE), backoff-deferred
 * rows (`last_requested` in the future, never claimable), and both lapsed and live `in_flight` leases.
 *
 * `first_requested` is UNIQUE per row by construction. The `(tier, request_count DESC, first_requested
 * ASC)` order is only a total order when the third key breaks every tie; with duplicates, two correct
 * implementations may legitimately pick different rows, and asserting on that would be asserting something
 * the contract does not promise.
 *
 * ## Anti-vacuity
 *
 * Randomised suites fail silently by generating uninteresting data. The trials therefore report their own
 * regime and the suite asserts the corpus actually covered all three (nothing demoted / everything demoted
 * / mixed) and that at least one demotion actually REORDERED the drain versus pure demand order — without
 * that, every trial could agree because fairness never engaged.
 *
 * ## Mutation evidence, including what it does NOT catch
 *
 * CAUGHT (each reported `DISAGREEMENT on trial seed 0 … regime mixed` when applied to the shipped DAO):
 *   - forcing the `promoted_ready` gate FALSE, so the promoted tier is never used — the single mutation
 *     that matters most, because it is the failure mode T-201's short-circuit could actually have;
 *   - `count(*) > threshold` → `>=`, FR-043a's off-by-one. This one was MISSED by the first version of the
 *     fixture and is why the boundary requester below is seeded deliberately;
 *   - collapsing the threshold to `count(*) > 0`, i.e. demoting everyone.
 *
 * NOT CAUGHT, deliberately, with the reason measured rather than assumed:
 *   - inverting the gate's `NOT d.over_threshold` filter. That makes the gate MORE permissive (an
 *     over-threshold requester with eligible work satisfies it), so the promoted branch still runs and the
 *     ranking is unchanged — it is a COST regression, not a semantic one, and the plan-shape assertion in
 *     `drain-claim-scaling.integration.test.ts` is what owns it. Equivalence and cost need separate gates.
 *   - deleting `first_requested ASC` from the promoted branch's `ORDER BY`. `idx_fetch_queue_priority` is
 *     `(request_count DESC, first_requested ASC)`, so an index-ordered scan returns the same row either
 *     way; the key is load-bearing for the CONTRACT (and for any plan that sorts) but is not observable
 *     here. `drain-claim-scaling.integration.test.ts` asserts the tie-break directly instead.
 *
 * @implements FR-015 FR-018 FR-043 FR-043a FR-044
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';

import { FetchQueueDao } from '../src/foods/dao/fetch-queue.dao.js';
import { DATABASE_URL, makeDb, makePool, resetSchema, type TestDb } from './support/db.js';

/** Randomised trials. Twelve is what T-197 claimed and never committed; this is that claim, reproducible. */
const TRIALS = 12;

/** Per-trial queue depth bounds. Small on purpose: the oracle is O(depth² × requesters) by design. */
const MIN_DEPTH = 24;
const MAX_DEPTH = 60;

/** Which regime a trial's seeded queue landed in — reported so the corpus can be checked for coverage. */
type Regime = 'none-demoted' | 'all-demoted' | 'mixed';

/** One trial's outcome. */
interface TrialResult {
    readonly seed: number;
    readonly depth: number;
    readonly threshold: number;
    readonly regime: Regime;
    readonly oracleOrder: readonly string[];
    readonly daoOrder: readonly string[];
    /** Whether demotion actually moved a row off pure `request_count DESC, first_requested ASC` order. */
    readonly reordered: boolean;
    /** Whether this trial landed a requester on EXACTLY the threshold (FR-043a's off-by-one edge). */
    readonly boundaryExact: boolean;
}

/**
 * Deterministic 32-bit PRNG (Mulberry32). Pure with respect to its own state cell.
 *
 * A seeded generator rather than `Math.random`: a differential failure is only actionable if the exact
 * queue that produced it can be regenerated from the number in the failure message.
 *
 * @param seed - Any 32-bit integer.
 * @returns A function yielding successive values in `[0, 1)`.
 */
function mulberry32(seed: number): () => number {
    let state = seed >>> 0;

    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let value = state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);

        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
}

describe.skipIf(!DATABASE_URL)('drain-claim ranking is differentially equivalent to FR-043 (T-201)', () => {
    let pool: pg.Pool;
    let db: TestDb;

    beforeAll(() => {
        pool = makePool();
        db = makeDb(pool);
    });

    afterAll(async () => {
        await pool?.end();
    });

    beforeEach(async () => {
        await resetSchema(pool);
        // A plain table, not TEMP: statements go out over a pool, so a per-connection temp table would be
        // invisible to half of them. Restoring only the columns a drain mutates is sufficient and exact.
        await pool.query(`CREATE TABLE queue_snapshot AS SELECT * FROM fetch_queue WITH NO DATA`);
    });

    /**
     * Seed one randomised queue and describe the regime it landed in.
     *
     * @param seed - Trial seed (also the trial index).
     * @returns The seeded depth, the threshold to run both rankings with, and the resulting regime.
     * @sideEffect Writes `food`, `fetch_queue`, `fetch_requesters`; runs `ANALYZE`.
     */
    async function seedRandomQueue(
        seed: number,
    ): Promise<{ depth: number; threshold: number; regime: Regime; boundaryExact: boolean }> {
        const random = mulberry32(seed + 1);
        const depth = MIN_DEPTH + Math.floor(random() * (MAX_DEPTH - MIN_DEPTH + 1));

        // A SKEWED requester population is what produces a mixed regime at all. With uniform fan-out every
        // requester ends up holding roughly the same number of rows, so any threshold is either above all of
        // them or below all of them and the queue is never partly demoted — the first version of this fixture
        // did exactly that and its own anti-vacuity check caught it (12/12 trials `all-demoted`). So: a few
        // HEAVY requesters spread across most of the queue, several LIGHT ones holding a row or two, and a
        // threshold drawn from the band BETWEEN those loads.
        const heavyCount = 1 + Math.floor(random() * 2);
        const lightCount = 2 + Math.floor(random() * 6);
        const threshold = 2 + Math.floor(random() * Math.min(14, Math.ceil(depth * 0.6)));

        const foodIds = Array.from({ length: depth }, (_, index) => `01JT201${String(index).padStart(19, '0')}`);

        await pool.query(
            `INSERT INTO food (id, name, normalized_name, kind, status, origin)
             SELECT id, 'diff food ' || ordinality, 'diff food ' || ordinality, 'generic', 'PENDING', 'live'
               FROM unnest($1::text[]) WITH ORDINALITY AS t(id, ordinality)`,
            [foodIds],
        );

        // `first_requested` is index-unique (the tie-breaker must be total, see the header). `status` /
        // `last_requested` deliberately include the three non-trivially-eligible shapes.
        const rows = foodIds.map((foodId, index) => {
            const roll = random();
            const status = roll < 0.06 ? 'in_flight' : 'pending';
            // A lapsed lease (600s old) must compete; a live one must not be claimable at all.
            const leaseAgeSeconds = status === 'in_flight' ? (random() < 0.6 ? 600 : 0) : null;
            const deferred = status === 'pending' && random() < 0.1;

            return {
                foodId,
                requestCount: 1 + Math.floor(random() * 9),
                firstRequestedAgeSeconds: 10_000 - index,
                lastRequestedOffsetSeconds: deferred ? 3_600 : -60,
                status,
                leaseAgeSeconds,
            };
        });

        for (const row of rows) {
            await pool.query(
                `INSERT INTO fetch_queue
                     (food_id, request_count, first_requested, last_requested, status, attempts, leased_at)
                 VALUES ($1, $2, now() - make_interval(secs => $3::int),
                         now() + make_interval(secs => $4::int), $5, 0,
                         CASE WHEN $6::int IS NULL THEN NULL ELSE now() - make_interval(secs => $6::int) END)`,
                [
                    row.foodId,
                    row.requestCount,
                    row.firstRequestedAgeSeconds,
                    row.lastRequestedOffsetSeconds,
                    row.status,
                    row.leaseAgeSeconds,
                ],
            );
        }

        /** Attach one requester to one food, tolerating the `(food_id, requester_id)` PK. */
        const attach = async (foodId: string, requesterId: string): Promise<void> => {
            await pool.query(
                `INSERT INTO fetch_requesters (food_id, requester_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
                [foodId, requesterId],
            );
        };

        // Heavy requesters: each on a large random share of the queue, so each is over any modest threshold.
        for (let heavy = 0; heavy < heavyCount; heavy += 1) {
            const share = 0.4 + random() * 0.5;

            for (const { foodId } of rows) {
                if (random() < share) {
                    await attach(foodId, `heavy-${heavy}`);
                }
            }
        }

        // Light requesters: one or two rows each, so each is under any modest threshold. A food holding a
        // light requester is PROMOTED while a food holding only heavy ones is DEMOTED — that split is the
        // mixed regime. Foods left with no requester row at all exercise the "demoted by ABSENCE" tier.
        for (let light = 0; light < lightCount; light += 1) {
            const attachCount = 1 + Math.floor(random() * 2);

            for (let slot = 0; slot < attachCount; slot += 1) {
                const target = rows[Math.floor(random() * rows.length)];

                if (target !== undefined) {
                    await attach(target.foodId, `light-${light}`);
                }
            }
        }

        // FR-043a's BOUNDARY, seeded deliberately rather than hoped for. One requester attached to EXACTLY
        // `threshold` outstanding rows is still UNDER-demand (`> threshold`, not `>=`), so the foods it holds
        // must be PROMOTED. Chosen from foods that carry no light requester, so their tier is decided by this
        // requester alone and a tier flip therefore changes the drain order.
        //
        // Load-bearing, and measured: without it, mutating the DAO's `count(*) > threshold` to `>=` produced
        // ZERO disagreements across all 12 trials — the randomised population simply never landed a requester
        // on the boundary, so the suite could not see an off-by-one in the rule it exists to police.
        const boundary = await pool.query(
            `INSERT INTO fetch_requesters (food_id, requester_id)
             SELECT q.food_id, 'boundary-0'
               FROM fetch_queue q
              WHERE q.status IN ('pending', 'in_flight')
                AND NOT EXISTS (
                    SELECT 1 FROM fetch_requesters r
                     WHERE r.food_id = q.food_id AND r.requester_id LIKE 'light-%'
                )
              ORDER BY q.first_requested ASC
              LIMIT $1::int`,
            [threshold],
        );

        const boundaryExact = (boundary.rowCount ?? 0) === threshold;

        await pool.query('ANALYZE food, fetch_queue, fetch_requesters');

        const { rows: counts } = await pool.query<{ eligible: number; demoted: number }>(
            `SELECT count(*)::int AS eligible,
                    count(*) FILTER (WHERE NOT EXISTS (
                        SELECT 1 FROM fetch_requesters r
                         WHERE r.food_id = q.food_id
                           AND (SELECT count(*) FROM fetch_queue fq JOIN fetch_requesters fr USING (food_id)
                                 WHERE fr.requester_id = r.requester_id
                                   AND fq.status IN ('pending', 'in_flight')) <= $1::int
                    ))::int AS demoted
               FROM fetch_queue q
              WHERE q.status = 'pending' AND q.last_requested <= now()`,
            [threshold],
        );

        const eligible = counts[0]?.eligible ?? 0;
        const demoted = counts[0]?.demoted ?? 0;
        const regime: Regime = demoted === 0 ? 'none-demoted' : demoted === eligible ? 'all-demoted' : 'mixed';

        return { depth, threshold, regime, boundaryExact };
    }

    /** Snapshot the mutable columns of `fetch_queue`. @sideEffect Writes `queue_snapshot`. */
    async function snapshotQueue(): Promise<void> {
        await pool.query('TRUNCATE queue_snapshot');
        await pool.query('INSERT INTO queue_snapshot SELECT * FROM fetch_queue');
    }

    /** Restore `fetch_queue` to the snapshot. @sideEffect Overwrites `fetch_queue`'s drain state. */
    async function restoreQueue(): Promise<void> {
        await pool.query(
            `UPDATE fetch_queue q
                SET status = s.status, leased_at = s.leased_at, last_requested = s.last_requested,
                    attempts = s.attempts, request_count = s.request_count, first_requested = s.first_requested
               FROM queue_snapshot s
              WHERE q.food_id = s.food_id`,
        );
    }

    /**
     * Drain the queue to empty using FR-043 stated literally, and return the claim order.
     *
     * Demotion is the LEADING sort key, computed per candidate row as a correlated per-requester
     * `COUNT(*)` — the shape the requirement describes, with no CTE, no filter rewrite and no
     * short-circuit. Slow by construction; that is the point.
     *
     * @param threshold - The per-requester pending threshold (FR-043).
     * @param leaseSeconds - Lease window, matched to the DAO's so reaper behaviour lines up.
     * @returns The food ids in the order the oracle claims them.
     * @sideEffect Leases `fetch_queue` rows, and reverts lapsed leases exactly as FR-018 requires.
     */
    async function drainWithOracle(threshold: number, leaseSeconds: number): Promise<readonly string[]> {
        const order: string[] = [];

        for (;;) {
            // Reaper-on-claim (FR-018), mirrored from the DAO: a lapsed lease competes by demand.
            await pool.query(
                `UPDATE fetch_queue SET status = 'pending'
                  WHERE status = 'in_flight' AND leased_at < now() - make_interval(secs => $1::int)`,
                [leaseSeconds],
            );

            const { rows } = await pool.query<{ food_id: string }>(
                `SELECT q.food_id
                   FROM fetch_queue q
                  WHERE q.status = 'pending' AND q.last_requested <= now()
                  ORDER BY
                      CASE WHEN EXISTS (
                          SELECT 1 FROM fetch_requesters r
                           WHERE r.food_id = q.food_id
                             AND (SELECT count(*) FROM fetch_queue fq JOIN fetch_requesters fr USING (food_id)
                                   WHERE fr.requester_id = r.requester_id
                                     AND fq.status IN ('pending', 'in_flight')) <= $1::int
                      ) THEN 0 ELSE 1 END ASC,
                      q.request_count DESC,
                      q.first_requested ASC
                  LIMIT 1`,
                [threshold],
            );

            const claimed = rows[0]?.food_id;

            if (claimed === undefined) {
                return order;
            }

            order.push(claimed);
            await pool.query(`UPDATE fetch_queue SET status = 'in_flight', leased_at = now() WHERE food_id = $1`, [
                claimed,
            ]);
        }
    }

    /**
     * Drain the queue to empty through the real DAO, and return the claim order.
     *
     * @param threshold - The per-requester pending threshold, passed as the DAO's override.
     * @param leaseSeconds - Lease window.
     * @returns The food ids in the order `leaseNext` claims them.
     * @sideEffect Leases `fetch_queue` rows.
     */
    async function drainWithDao(threshold: number, leaseSeconds: number): Promise<readonly string[]> {
        const dao = new FetchQueueDao(db, { demoteThreshold: threshold });
        const order: string[] = [];

        for (;;) {
            const claimed = await dao.leaseNext(leaseSeconds);

            if (claimed === undefined) {
                return order;
            }

            order.push(claimed.foodId);
        }
    }

    /** Pure demand-only order of the same drain, to tell whether fairness changed anything. */
    function isPureDemandOrder(order: readonly string[], byDemand: readonly string[]): boolean {
        return order.length === byDemand.length && order.every((id, index) => id === byDemand[index]);
    }

    /**
     * Run one trial end to end.
     *
     * @param seed - Trial seed.
     * @returns The trial result, including both drain orders.
     * @sideEffect Reseeds and drains the queue twice.
     */
    async function runTrial(seed: number): Promise<TrialResult> {
        const { depth, threshold, regime, boundaryExact } = await seedRandomQueue(seed);

        await snapshotQueue();

        // The order the drain would take with fairness switched off, captured from the same snapshot, so
        // "demotion actually reordered something" is a fact about this trial rather than an assumption.
        const { rows: demandRows } = await pool.query<{ food_id: string }>(
            `SELECT food_id FROM queue_snapshot
              WHERE status = 'pending' AND last_requested <= now()
              ORDER BY request_count DESC, first_requested ASC`,
        );

        const oracleOrder = await drainWithOracle(threshold, 30);

        await restoreQueue();

        const daoOrder = await drainWithDao(threshold, 30);

        return {
            seed,
            depth,
            threshold,
            regime,
            oracleOrder,
            daoOrder,
            boundaryExact,
            reordered: !isPureDemandOrder(
                oracleOrder.slice(0, demandRows.length),
                demandRows.map((row) => row.food_id),
            ),
        };
    }

    it(`agrees with FR-043's own ranking on every claim of ${TRIALS} randomised drains`, async () => {
        const results: TrialResult[] = [];

        for (let seed = 0; seed < TRIALS; seed += 1) {
            const result = await runTrial(seed);

            results.push(result);

            expect(
                result.daoOrder,
                `DISAGREEMENT on trial seed ${result.seed} (depth ${result.depth}, threshold ` +
                    `${result.threshold}, regime ${result.regime}). leaseNext drained in a different order ` +
                    `than FR-043's literal ranking. Regenerate this exact queue with mulberry32(seed + 1). ` +
                    `The claim that leaseNext's optimisations preserve the ranking is FALSE as written.`,
            ).toEqual(result.oracleOrder);

            await resetSchema(pool);
            await pool.query(`CREATE TABLE queue_snapshot AS SELECT * FROM fetch_queue WITH NO DATA`);
        }

        // ── Anti-vacuity: the corpus has to have exercised the thing it claims to have exercised. ──
        const regimes = new Set(results.map((result) => result.regime));

        expect(
            [...regimes].sort(),
            `the ${TRIALS} randomised trials only produced regime(s) ${[...regimes].join(', ')}. Agreement ` +
                `across trials that never engage demotion, or that demote everything, proves nothing about ` +
                `the promoted/demoted boundary — widen the fixture's threshold or fan-out ranges.`,
        ).toContain('mixed');

        expect(
            results.some((result) => result.reordered),
            'no trial had fairness change the drain order versus pure request_count/first_requested ' +
                'order, so every comparison could have passed with the demotion clause deleted entirely.',
        ).toBe(true);

        expect(
            results.some((result) => result.boundaryExact),
            "no trial landed a requester on EXACTLY the demotion threshold, so FR-043a's off-by-one " +
                '("holding exactly the threshold is still under-demand") was never compared. Measured: ' +
                'without this case, mutating the DAO to `count(*) >= threshold` produces zero ' +
                'disagreements across every trial.',
        ).toBe(true);

        expect(
            results.every((result) => result.oracleOrder.length > 0),
            'a trial drained zero rows — nothing was compared in it.',
        ).toBe(true);
    });
});
