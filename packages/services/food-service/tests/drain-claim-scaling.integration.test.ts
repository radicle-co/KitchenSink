/**
 * T-197 / DSN-11 — the COST of {@link FetchQueueDao.leaseNext}, and the FR-043 semantics that must
 * survive making it cheap.
 *
 * T-195 measured the shipped claim at 541ms per claim at queue depth 1,000 and 7.6–11s at the FR-046
 * ceiling of 10,000, against a 60ms budget: FR-043's fairness demotion was expressed as a correlated
 * `COUNT(*)` over a join in the LEADING position of the `ORDER BY`, so Postgres had to evaluate it for
 * every eligible row before it could know which row sorted first — `LIMIT 1` could not avoid the work, and
 * `idx_fetch_queue_priority` (which already indexes exactly `request_count DESC, first_requested ASC`
 * over the pending set) could not be used at all. Cost therefore grew SUPERLINEARLY with depth, which is
 * the collapse mode: drain throughput falls exactly when the queue is deepest.
 *
 * This suite is that defect's regression gate in three parts, because no one of them alone is worth
 * anything: a timing assertion would pass a query that ranked rows at random, a semantic assertion would
 * pass the 20-second query T-195 measured, and a plan assertion would pass a plan that is cheap and wrong.
 *
 * 1. **Cost** — a 10× deeper queue must not cost ~10×+ more per claim. Asserted as a RATIO against a
 *    shallower series measured on the same machine in the same run, so the gate does not encode this
 *    laptop's clock speed, plus one deliberately loose absolute ceiling to catch a regression that scales
 *    flat but slowly. A timing assertion alone would pass a query that ranked rows at random.
 * 2. **Semantics** — the equivalences a cheaper ranking is allowed to preserve and nothing else: the
 *    demoted tier's own ordering, the work-conserving fallback when EVERYTHING is demoted, a food with no
 *    requester rows at all, backoff eligibility, a lapsed `in_flight` lease competing BY DEMAND, and
 *    `SKIP LOCKED` under genuinely concurrent claims. `fairness-demotion.integration.test.ts` (T-049/
 *    T-151) owns the headline FR-043 rule; these are the edges that a rewrite of the ranking can silently
 *    move, and every one of them is asserted through the claim `leaseNext` actually returns.
 * 3. **Plan shape** (T-201) — the wall clock could not own what CI then caught. T-197 left the
 *    nothing-promoted case linear in depth: the promoted branch had to examine every eligible row to
 *    conclude its tier was empty, which CI measured at **85.52ms p95 at the FR-046 ceiling against a 60ms
 *    budget** while this laptop measured 28ms for the same query — a 3× hardware gap that makes any local
 *    timing assertion worthless as a gate, and the ratio in (1) is diluted further by the ~3ms client round
 *    trip. So the mechanism is asserted from the REAL plan instead: `EXPLAIN (ANALYZE, FORMAT JSON)` of the
 *    statement `leaseNext` actually sent (captured from a Drizzle logger, never restated here), counting
 *    tuples pulled from `idx_fetch_queue_priority`. That number is deterministic and
 *    hardware-independent, and it is exactly the quantity that used to grow with depth.
 *
 * ## Mutation evidence for (3)
 *
 * Weakening the gate to `CASE WHEN true OR EXISTS (promoted_ready)` reds it with **201 tuples at depth 200
 * and 2,001 at depth 2,000** — the O(depth) walk, visible directly. Reverting `leaseNext` to its pre-T-201
 * form reds the capture step instead ("no statement containing the `promoted_ready` CTE"), which is the
 * intended behaviour: a plan gate that cannot identify its statement must fail loudly rather than assert
 * on the reaper `UPDATE` and report a healthy plan for a query nobody runs.
 *
 * @implements FR-015 FR-018 FR-043 FR-046
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';

import { FetchQueueDao } from '../src/foods/dao/fetch-queue.dao.js';
import { FetchRequestersDao } from '../src/foods/dao/fetch-requesters.dao.js';
import { FoodDao } from '../src/foods/dao/food.dao.js';
import { DATABASE_URL, makeDb, makePool, resetSchema, type TestDb } from './support/db.js';

/**
 * Ceiling on `idx_fetch_queue_priority` tuples the claim may examine when NOTHING is promoted.
 *
 * The honest count is 1 — the demoted fallback's `LIMIT 1`, since the promoted branch is skipped entirely.
 * 10 leaves room for a plan that peeks slightly further without leaving room for a per-row walk: the
 * pre-T-201 statement examined `depth + 1` here (10,001 at the FR-046 ceiling), which is the regression
 * this number exists to make impossible. Asserted at TWO depths, so "does not scale with depth" is a
 * measured property rather than one number that happens to pass.
 */
const MAX_PRIORITY_INDEX_TUPLES = 10;

/** Shallow series depth — the SC-003 condition ("pending depth under 100 rows") plus headroom. */
const SHALLOW_DEPTH = 200;

/** Deep series depth: 10× shallow, and deep enough that an O(depth²) ranking is unmistakable. */
const DEEP_DEPTH = 2_000;

/**
 * Largest tolerated (deep ÷ shallow) claim-cost ratio for a 10× deeper queue.
 *
 * An index-ordered claim is O(log n) plus one bounded fairness pass, so the honest expectation is a ratio
 * near 1–3 (the fairness pass does scale with depth). 6 leaves room for that and for CI noise while still
 * being far below what the defect produces: T-195 measured ~14–20× per 10× of depth, and the fixture below
 * drives the same shape (every claim re-counted every heavy requester's whole outstanding set).
 */
const MAX_DEPTH_COST_RATIO = 6;

/**
 * Absolute ceiling (ms) on the median claim at {@link DEEP_DEPTH}, to catch a regression that scales
 * flat but is uniformly slow (which the ratio alone would pass). Deliberately loose — 2.5× the 60ms p95
 * the `Drain-claim FR-046 ceiling probe` holds production to — because this tier runs on shared CI
 * hardware alongside a Postgres container. The probe, not this number, is the performance CONTRACT.
 */
const DEEP_MEDIAN_CEILING_MS = 150;

/** Timed claims per series, after {@link WARMUP_CLAIMS} discarded ones. */
const SAMPLE_CLAIMS = 5;

/** Discarded claims per series, so no sample carries first-call plan/cache warm-up. */
const WARMUP_CLAIMS = 2;

/**
 * Distinct heavy requesters spread over the bulk fixture. Each ends up attached to ~half the queue, so
 * every one of them is far over the demotion threshold and EVERY row is demoted — FR-043's own worst case
 * (a queue dominated by heavy requesters is exactly when demotion engages) and the shape DSN-11 named.
 */
const HEAVY_REQUESTERS = 4;

describe.skipIf(!DATABASE_URL)('drain-claim cost + ranking equivalence (T-197, DSN-11)', () => {
    let pool: pg.Pool;
    let db: TestDb;
    let foods: FoodDao;
    let queue: FetchQueueDao;
    let requesters: FetchRequestersDao;

    beforeAll(() => {
        pool = makePool();
        db = makeDb(pool);
        foods = new FoodDao(db);
        queue = new FetchQueueDao(db);
        requesters = new FetchRequestersDao(db);
    });

    afterAll(async () => {
        await pool?.end();
    });

    beforeEach(async () => {
        await resetSchema(pool);
    });

    /**
     * Bulk-seed `depth` eligible pending rows whose requesters are ALL over the demotion threshold.
     *
     * Written as one INSERT per table rather than through the DAOs: 2,000 round trips would dominate the
     * suite's runtime, and the fixture's only job is depth. `request_count` and `first_requested` are both
     * varied so the second and third sort keys have real work to do — a queue tied on both would let the
     * sort settle on heap order and understate the claim's cost.
     *
     * @param depth - Pending rows to create.
     * @sideEffect Writes to `food`, `fetch_queue`, `fetch_requesters`; runs `ANALYZE`.
     */
    async function seedDeepQueue(depth: number): Promise<void> {
        const foodId = `'01JT197000Q' || lpad(s.i::text, 15, '0')`;

        await pool.query(
            `INSERT INTO food (id, name, normalized_name, kind, status, origin)
             SELECT ${foodId}, 'scaling food ' || s.i, 'scaling food ' || s.i, 'generic', 'PENDING', 'live'
               FROM generate_series(0, $1::int - 1) AS s(i)`,
            [depth],
        );

        await pool.query(
            `INSERT INTO fetch_queue (food_id, request_count, first_requested, last_requested, status, attempts)
             SELECT ${foodId}, 1 + (s.i % 7), now() - make_interval(secs => (s.i % 3600)),
                    now() - make_interval(secs => 60), 'pending', 0
               FROM generate_series(0, $1::int - 1) AS s(i)`,
            [depth],
        );

        await pool.query(
            `INSERT INTO fetch_requesters (food_id, requester_id, requested_at)
             SELECT ${foodId}, 'heavy-' || ((s.i * t.stride + t.shift) % $2::int), now()
               FROM generate_series(0, $1::int - 1) AS s(i)
               CROSS JOIN (VALUES (1, 0), (7, 3)) AS t(stride, shift)
             ON CONFLICT DO NOTHING`,
            [depth, HEAVY_REQUESTERS],
        );

        // Without statistics the planner picks a plan the deployed service would never pick, so the
        // measured cost would describe a fictional plan.
        await pool.query('ANALYZE food, fetch_queue, fetch_requesters');
    }

    /**
     * Median wall-clock cost of one `leaseNext` claim at the currently seeded depth.
     *
     * Each claimed row is reverted to `pending` OUTSIDE the timing, so every sample sees the SAME depth —
     * otherwise the series would silently measure a progressively shallower (cheaper) queue.
     *
     * @param depth - The seeded depth, for the failure message only.
     * @returns The median of {@link SAMPLE_CLAIMS} timed claims, in milliseconds.
     * @sideEffect Leases and un-leases `fetch_queue` rows.
     */
    async function medianClaimMs(depth: number): Promise<number> {
        const timings: number[] = [];

        for (let attempt = 0; attempt < WARMUP_CLAIMS + SAMPLE_CLAIMS; attempt += 1) {
            const startedAt = process.hrtime.bigint();
            const claimed = await queue.leaseNext(30);
            const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

            expect(claimed, `leaseNext claimed nothing at depth ${depth} — nothing was measured`).toBeDefined();

            await queue.releaseInFlight();

            if (attempt >= WARMUP_CLAIMS) {
                timings.push(elapsedMs);
            }
        }

        const sorted = [...timings].sort((left, right) => left - right);

        return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
    }

    /** Create a PENDING food + pending queue row, attach `subs` as distinct requesters, recompute demand. */
    async function seedPending(normalizedName: string, subs: readonly string[]): Promise<string> {
        const { id } = await foods.createByName({ normalizedName, displayName: normalizedName });

        for (const requesterId of subs) {
            await requesters.add({ foodId: id, requesterId });
        }

        await queue.enqueue(id);

        return id;
    }

    /** Force a row's demand + age so an ordering assertion does not depend on how it was seeded. */
    async function setDemand(foodId: string, requestCount: number, ageSeconds: number): Promise<void> {
        await pool.query(
            `UPDATE fetch_queue SET request_count = $2, first_requested = now() - make_interval(secs => $3)
              WHERE food_id = $1`,
            [foodId, requestCount, ageSeconds],
        );
    }

    /**
     * The EXACT claim statement `leaseNext` sends, captured from a Drizzle query logger.
     *
     * Captured rather than restated. A copy of the SQL in this file would be a second representation of the
     * statement under test, and the copy is the one that silently stops matching production — which for a
     * PLAN assertion is worse than no assertion, because it would keep reporting a healthy plan for a query
     * nobody runs. The claim is identified by its `promoted_ready` CTE, and the identification is asserted,
     * so renaming that CTE fails loudly instead of quietly selecting the reaper statement instead.
     *
     * @returns The claim's SQL text and bound parameters.
     * @sideEffect Performs one real claim (and releases it again).
     */
    async function captureClaimStatement(): Promise<{ text: string; values: readonly unknown[] }> {
        const seen: { text: string; values: readonly unknown[] }[] = [];
        const logged = makeDb(pool, {
            logQuery: (query, params) => {
                seen.push({ text: query, values: params });
            },
        });

        await new FetchQueueDao(logged).leaseNext(30);
        await queue.releaseInFlight();

        const claims = seen.filter((statement) => statement.text.includes('promoted_ready'));

        expect(
            claims,
            'no statement containing the `promoted_ready` CTE was captured from leaseNext. Either the ' +
                'claim no longer builds that CTE (in which case this plan gate is asserting nothing and ' +
                'must be re-pointed) or the Drizzle logger stopped firing.',
        ).toHaveLength(1);

        return claims[0] as { text: string; values: readonly unknown[] };
    }

    /**
     * `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` the given statement and return the plan tree, rolled back.
     *
     * `EXPLAIN ANALYZE` on an `UPDATE` really performs it, so it runs inside a transaction on a single
     * dedicated connection that is always rolled back — the surrounding series must keep seeing the same
     * queue depth.
     *
     * @param statement - SQL text plus bound parameters.
     * @returns Every node of the executed plan, flattened.
     * @sideEffect Opens a connection and executes-then-rolls-back the statement.
     */
    async function explainNodes(statement: {
        text: string;
        values: readonly unknown[];
    }): Promise<readonly Record<string, unknown>[]> {
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            const explained = await client.query<{ 'QUERY PLAN': { Plan: Record<string, unknown> }[] }>({
                text: `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${statement.text}`,
                values: [...statement.values],
            });

            await client.query('ROLLBACK');

            const root = explained.rows[0]?.['QUERY PLAN']?.[0]?.Plan;
            const flat: Record<string, unknown>[] = [];

            const walk = (node: Record<string, unknown> | undefined): void => {
                if (node === undefined) {
                    return;
                }

                flat.push(node);

                for (const child of (node['Plans'] as Record<string, unknown>[] | undefined) ?? []) {
                    walk(child);
                }
            };

            walk(root);

            return flat;
        } finally {
            client.release();
        }
    }

    /**
     * Tuples the plan actually pulled from `idx_fetch_queue_priority` (rows × loops, so a `never executed`
     * node contributes zero). Pure.
     */
    function priorityIndexTuples(nodes: readonly Record<string, unknown>[]): { nodes: number; tuples: number } {
        const scans = nodes.filter((node) => node['Index Name'] === 'idx_fetch_queue_priority');
        const tuples = scans.reduce(
            (total, node) => total + Number(node['Actual Rows'] ?? 0) * Number(node['Actual Loops'] ?? 0),
            0,
        );

        return { nodes: scans.length, tuples };
    }

    describe('cost (SC-003, FR-046)', () => {
        it('a 10x deeper queue does not cost ~10x+ more per claim', async () => {
            await seedDeepQueue(SHALLOW_DEPTH);
            const shallowMs = await medianClaimMs(SHALLOW_DEPTH);

            await resetSchema(pool);
            await seedDeepQueue(DEEP_DEPTH);
            const deepMs = await medianClaimMs(DEEP_DEPTH);

            const ratio = deepMs / shallowMs;
            const report =
                `claim median ${shallowMs.toFixed(2)}ms @ depth ${SHALLOW_DEPTH} -> ` +
                `${deepMs.toFixed(2)}ms @ depth ${DEEP_DEPTH} (${ratio.toFixed(1)}x for 10x depth)`;

            expect(deepMs, report).toBeLessThan(DEEP_MEDIAN_CEILING_MS);
            expect(ratio, report).toBeLessThan(MAX_DEPTH_COST_RATIO);
        });

        it('examines O(1) queue rows to conclude the promoted tier is empty, at any depth (T-201)', async () => {
            // THE MECHANISM, asserted from the real plan rather than from a stopwatch. T-197 left one case
            // linear in depth: with nothing promoted, the promoted branch's index-ordered scan had to examine
            // EVERY eligible row before it could conclude the tier was empty — CI measured 85.52ms p95 at the
            // FR-046 ceiling against a 60ms budget, where this laptop measured 28ms. A wall-clock assertion
            // therefore cannot own this: it encodes the runner's clock speed and it is diluted by the client
            // round trip (~3ms here, which at DEEP_DEPTH is most of the measurement). Tuples pulled from
            // `idx_fetch_queue_priority` are hardware-independent, deterministic, and are precisely the
            // quantity that used to grow with depth.
            //
            // The fixture demotes EVERYTHING, so the promoted branch must be skipped by `promoted_ready` and
            // its subplan must be `never executed`.
            const measured: { depth: number; nodes: number; tuples: number }[] = [];

            for (const depth of [SHALLOW_DEPTH, DEEP_DEPTH]) {
                await resetSchema(pool);
                await seedDeepQueue(depth);

                const nodes = await explainNodes(await captureClaimStatement());

                measured.push({ depth, ...priorityIndexTuples(nodes) });
            }

            const report = measured
                .map((entry) => `depth ${entry.depth}: ${entry.tuples} tuple(s) over ${entry.nodes} scan(s)`)
                .join('; ');

            // Anti-vacuity: if the planner stopped using the partial index altogether, zero tuples would
            // pass this gate while the claim had in fact regressed to a Seq Scan + Sort.
            expect(
                measured.every((entry) => entry.nodes > 0),
                `the claim's plan contains no idx_fetch_queue_priority scan at all (${report}). That index ` +
                    `IS the ordered access path (T-197); without it the claim is a Seq Scan + Sort and this ` +
                    `assertion would pass vacuously.`,
            ).toBe(true);

            for (const entry of measured) {
                expect(
                    entry.tuples,
                    `at depth ${entry.depth} with EVERY row demoted, the claim pulled ${entry.tuples} tuples ` +
                        `from idx_fetch_queue_priority (${report}). It must not scale with depth: the ` +
                        `promoted branch has to be skipped via the promoted_ready gate, not walked to ` +
                        `exhaustion. A count near the depth means the CASE gate is gone or is always true, ` +
                        `which is the DSN-11 breach at the FR-046 ceiling.`,
                ).toBeLessThanOrEqual(MAX_PRIORITY_INDEX_TUPLES);
            }
        });

        it('breaks a demand tie on first_requested ASC inside the demoted tier', async () => {
            // Owned here because the differential harness cannot see it: `idx_fetch_queue_priority` is
            // `(request_count DESC, first_requested ASC)`, so an index-ordered scan returns the right row even
            // if the key were dropped from the ORDER BY. Asserted directly so the CONTRACT is pinned
            // independently of whichever plan the optimiser picks.
            const newer = await seedPending('tie newer', ['flood']);
            const older = await seedPending('tie older', ['flood']);

            await setDemand(newer, 4, 30);
            await setDemand(older, 4, 3_600);

            const dao = new FetchQueueDao(db, { demoteThreshold: 1 });

            expect((await dao.leaseNext(30))?.foodId).toBe(older);
            expect((await dao.leaseNext(30))?.foodId).toBe(newer);
        });
    });

    describe('ranking equivalence (FR-043, FR-015)', () => {
        it('claims the highest-demand row of the DEMOTED tier when every eligible row is demoted', async () => {
            // One flooder holds all three rows, so with a threshold of 1 every row is demoted and the
            // claim can only come from the demoted tier — it must still be the best row IN that tier,
            // never nothing (demotion is a re-ordering, not a rejection: FR-043, no 429).
            const top = await seedPending('demoted top demand', ['flood']);
            const middle = await seedPending('demoted middle demand', ['flood']);
            const oldest = await seedPending('demoted oldest', ['flood']);

            await setDemand(top, 3, 10);
            await setDemand(middle, 2, 20);
            await setDemand(oldest, 2, 3_600);

            const dao = new FetchQueueDao(db, { demoteThreshold: 1 });

            expect((await dao.leaseNext(30))?.foodId).toBe(top);
            // Tie on request_count inside the demoted tier still breaks on first_requested ASC.
            expect((await dao.leaseNext(30))?.foodId).toBe(oldest);
            expect((await dao.leaseNext(30))?.foodId).toBe(middle);
        });

        it('demotes a food with NO requester rows behind a lower-demand requested food', async () => {
            // "Demoted" is "no requester of this food is under the threshold", which for a food with zero
            // requester rows is vacuously true — so an unrequested row sorts BACK even at higher demand.
            // Load-bearing: it is the only case where the demotion tier is decided by the ABSENCE of rows.
            const orphan = await seedPending('orphaned high demand food', []);
            const requested = await seedPending('requested low demand food', ['solo']);

            await setDemand(orphan, 9, 3_600);
            await setDemand(requested, 1, 10);

            expect((await queue.leaseNext(30))?.foodId).toBe(requested);
            // Still work-conserving: the orphan is claimable once the promoted tier is empty.
            expect((await queue.leaseNext(30))?.foodId).toBe(orphan);
        });

        it('never claims a backed-off row (last_requested in the future) even at the highest demand', async () => {
            const backedOff = await seedPending('backed off high demand', ['a', 'b', 'c']);
            const ready = await seedPending('ready low demand', ['d']);

            await queue.deferLease(backedOff, 3_600);

            expect((await queue.leaseNext(30))?.foodId).toBe(ready);
            expect(await queue.leaseNext(30)).toBeUndefined();
        });

        it('lets a LAPSED in_flight lease compete by demand, and reclaims it without spending attempts', async () => {
            const lapsed = await seedPending('lapsed high demand', ['a']);
            const pending = await seedPending('pending low demand', ['b']);

            await setDemand(lapsed, 5, 10);
            await setDemand(pending, 1, 10);
            await queue.leaseNext(30);
            await pool.query(`UPDATE fetch_queue SET leased_at = now() - interval '600 seconds' WHERE food_id = $1`, [
                lapsed,
            ]);

            const reclaimed = await queue.leaseNext(30);

            expect(reclaimed?.foodId).toBe(lapsed);
            expect(reclaimed?.attempts).toBe(0); // a reclaim is not a failure (DSN-5)
        });

        it('lets a pending row outrank a LAPSED in_flight lease of lower demand', async () => {
            const lapsed = await seedPending('lapsed low demand', ['a']);
            const pending = await seedPending('pending high demand', ['b']);

            await setDemand(lapsed, 1, 3_600);
            await setDemand(pending, 5, 10);
            // Stamped directly rather than via `leaseNext`, because `leaseNext` would (correctly) claim the
            // HIGHER-demand row — the lapsed state under test is a lease the drainer already lost.
            await pool.query(
                `UPDATE fetch_queue SET status = 'in_flight', leased_at = now() - interval '600 seconds'
                  WHERE food_id = $1`,
                [lapsed],
            );

            expect((await queue.leaseNext(30))?.foodId).toBe(pending);
        });
    });

    describe('concurrent claims (FOR UPDATE SKIP LOCKED)', () => {
        /**
         * Claim from `count` connections AT ONCE and return what each got.
         *
         * `Promise.all` over a pool with room for all of them is genuinely concurrent — the statements
         * overlap inside Postgres — which is the only way to exercise `SKIP LOCKED`. A sequential loop
         * would pass even if the lock clause were deleted outright.
         *
         * @param count - How many claims to issue simultaneously.
         * @param dao - The DAO whose threshold decides which branch of the claim is exercised.
         * @returns The claimed food ids, `undefined` for a claim that got nothing.
         * @sideEffect Leases `fetch_queue` rows from `count` connections.
         */
        async function claimConcurrently(count: number, dao: FetchQueueDao): Promise<(string | undefined)[]> {
            const claims = Array.from({ length: count }, async () => (await dao.leaseNext(30))?.foodId);

            return Promise.all(claims);
        }

        it('never hands the same promoted row to two workers', async () => {
            const seeded: string[] = [];

            for (let i = 0; i < 6; i += 1) {
                seeded.push(await seedPending(`concurrent promoted ${i}`, [`sub_${i}`]));
            }

            const claimed = await claimConcurrently(seeded.length, queue);

            expect(new Set(claimed).size).toBe(seeded.length);
            expect(claimed).not.toContain(undefined);
        });

        it('never hands the same row to two workers on the all-demoted fallback path', async () => {
            const seeded: string[] = [];

            for (let i = 0; i < 6; i += 1) {
                seeded.push(await seedPending(`concurrent demoted ${i}`, ['flood']));
            }

            // Threshold 1 with one flooder holding all six rows: every claim must take the fallback.
            const claimed = await claimConcurrently(seeded.length, new FetchQueueDao(db, { demoteThreshold: 1 }));

            expect(new Set(claimed).size).toBe(seeded.length);
            expect(claimed).not.toContain(undefined);
        });
    });
});
