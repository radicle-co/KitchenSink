/**
 * Drain-claim performance probe — SC-003's database component and the DSN-11 finding it exists to settle.
 *
 * ## Why this is NOT a k6 script
 *
 * SC-003 ("background food resolutions MUST complete within 60 seconds at p95 when the `fetch_queue`
 * pending depth is under 100 rows") spans the Fargate fan-out worker and an outbound SOURCE HTTP call. This
 * suite must make no source call, and k6 cannot speak to Postgres at all (goja has no `pg` driver, and
 * `xk6-sql` needs a custom binary). So SC-003 is decomposed:
 *
 *   - the SOURCE round trip is out of scope here — it is bounded by the adapter's own client timeout and the
 *     FR-019 rolling-window limiter, and measuring it would mean calling USDA from CI;
 *   - the QUEUE MACHINERY — `FetchQueueDao.leaseNext`, the one statement whose cost grows with queue depth —
 *     is measured here, at the FR-046 ceiling, against a real Postgres.
 *
 * The DAO is imported and CALLED, never re-implemented: the SQL measured below is byte-for-byte the SQL the
 * worker runs, so this probe cannot drift from the shipped query the way a copied statement would.
 *
 * ## What DSN-11 says, and what this decides
 *
 * `leaseNext`'s `ORDER BY` opens with FR-043's live fairness demotion:
 *
 *     CASE WHEN NOT EXISTS (
 *         SELECT 1 FROM fetch_requesters r WHERE r.food_id = q.food_id
 *           AND ( SELECT count(*) FROM fetch_queue fq JOIN fetch_requesters fr USING (food_id)
 *                  WHERE fr.requester_id = r.requester_id AND fq.status IN ('pending','in_flight')
 *               ) <= 50
 *     ) THEN 1 ELSE 0 END ASC
 *
 * That is a per-row, per-requester correlated `COUNT(*)` inside the `ORDER BY` of a `… FOR UPDATE SKIP
 * LOCKED LIMIT 1`, with no supporting index — and because it is a SORT KEY, the `LIMIT 1` cannot avoid
 * evaluating it for every candidate row. The stabilization ledger flagged it MEDIUM (DSN-11) with the
 * caveat "acceptable at launch scale (< 10,000 rows), revisit/materialize a per-`sub` pending count at
 * scale — cost is covered by the drain/demotion perf test in T-195". This script IS that test.
 *
 * ## The two requester profiles, and why both are needed
 *
 * The inner `NOT EXISTS` SHORT-CIRCUITS on the first requester found under the threshold. So the cost
 * depends entirely on the requester mix, and one profile would measure only one side of it:
 *
 *   - `mixed` — every food has one heavy requester (hundreds pending) AND one requester of its own with a
 *     single pending row. The `EXISTS` finds an under-threshold requester almost immediately, nothing is
 *     demoted, and this is the realistic steady state.
 *   - `adversarial` — every requester of every food is over the threshold, so the `EXISTS` can never
 *     short-circuit: it evaluates a full correlated `COUNT(*)` for every requester of every candidate row.
 *     This is FR-043's own worst case (a queue dominated by heavy requesters is exactly when demotion is
 *     supposed to engage) and the shape DSN-11 is about.
 *
 * Both are measured at every depth, so the report distinguishes "the query is fine" from "the query is fine
 * until fairness actually has work to do".
 *
 * Usage (from packages/services/food-service):
 *   DATABASE_URL=postgres://postgres:postgres@localhost:5432/food_load npm run test:load:drain
 *   FOOD_DRAIN_DEPTHS=100,1000,10000 FOOD_DRAIN_SAMPLES=50 DATABASE_URL=… npm run test:load:drain
 *
 * Exits NON-ZERO on a budget breach with the DSN-11 escalation spelled out. It never widens the budget and
 * never reports a skip as a pass.
 *
 * @sideEffect DELETES and rewrites the `queue`-kind fixture rows in `fetch_queue` / `fetch_requesters` /
 *            `food` on `DATABASE_URL`, and leases rows during measurement. Refuses any database not named
 *            in `perf-fixture.ts`'s disposable allowlist.
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import { settingFromEnv } from '../../src/config/env.schema.js';
import * as schema from '../../src/db/schema/index.js';
import { FetchQueueDao } from '../../src/foods/dao/fetch-queue.dao.js';
import {
    BRANDS,
    CUTS,
    INGREDIENTS,
    PERF_KIND_LETTER,
    PREPARATIONS,
    perfExternalKey,
    perfFoodIdSql,
    perfFoodNameSql,
    perfSourceIdSql,
    requireDisposableDatabaseUrl,
} from './perf-fixture.js';

const connectionString = requireDisposableDatabaseUrl();

/**
 * Queue depths to measure, ordered. The three defaults are the points the contract cares about:
 *
 *   - **100** — SC-003's stated condition ("pending-row depth is under 100 rows"). This is the depth at
 *     which the 60s promise is made, so a breach here is a breach of SC-003 itself.
 *   - **1,000** — a tenth of the ceiling. Included because a two-point series cannot show WHERE the cost
 *     stops being acceptable, and "acceptable at launch scale, revisit at N rows" (DSN-11) is only
 *     actionable if the measurement says what N is.
 *   - **10,000** — FR-046's hard ceiling (`FOOD_MAX_QUEUE_DEPTH`), the deepest the queue is ever allowed to
 *     get before enqueues fail closed with `503`. This is the adversarial point DSN-11 names.
 */
const DEPTHS = (process.env['FOOD_DRAIN_DEPTHS'] ?? '100,1000,10000')
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0);

/** Measured claims per (profile, depth), subject to {@link SERIES_BUDGET_MS}. */
const SAMPLES = Math.max(5, Number(process.env['FOOD_DRAIN_SAMPLES'] ?? 30));

/** Floor on samples per series — never traded away for the wall-clock budget. */
const MIN_SAMPLES = Math.min(SAMPLES, Math.max(3, Number(process.env['FOOD_DRAIN_MIN_SAMPLES'] ?? 5)));

/** Wall-clock budget per series, after which sampling stops (having reached {@link MIN_SAMPLES}). */
const SERIES_BUDGET_MS = Math.max(1_000, Number(process.env['FOOD_DRAIN_SERIES_BUDGET_MS'] ?? 60_000));

/** Claims discarded before measuring, so the first sample does not carry plan/cache warm-up. */
const WARMUP = Math.max(1, Number(process.env['FOOD_DRAIN_WARMUP'] ?? 3));

/**
 * p95 budget (ms) for ONE `leaseNext` claim.
 *
 * DERIVATION (this is the whole point of the number, so it is spelled out):
 *
 *  1. SC-003 promises 202 -> RESOLVED within 60s p95 while the pending depth is under 100.
 *  2. The worst-placed item at that depth is behind 99 others, so all 100 must drain inside the 60s window.
 *  3. With a single drainer that is 600ms of wall time per item, covering: one `leaseNext` claim, the
 *     source fan-out (~2 HTTP calls, the intended cost), the merge writes, and one `resolve` ack.
 *     (`FOOD_WORKER_CONCURRENCY` raises this to 600ms x K, so 600ms is the STRICTEST case — using it keeps
 *     the budget independent of a worker-sizing change.)
 *  4. The queue machinery must not be what sets the drain rate. Allocating the claim 10% of the per-item
 *     slot leaves the source round trip the dominant term, as designed.
 *
 *  => 60ms p95 per claim. Env-overridable for exploration, but a run that only passes with a raised budget
 *     has NOT satisfied SC-003 — see the DSN-11 escalation this script prints.
 */
const CLAIM_P95_BUDGET_MS = Number(process.env['FOOD_DRAIN_CLAIM_P95_MS'] ?? 60);

/**
 * The per-requester pending threshold the DAO under measurement actually uses (FR-043) — read from the
 * SAME configured source as {@link FetchQueueDao}, never re-stated as a literal here. A copy would let a
 * tuned `FOOD_DEMOTE_THRESHOLD` desynchronise the fixture from the query, which would silently stop
 * exercising the expensive no-short-circuit demotion branch this script exists to time.
 */
const DEMOTION_THRESHOLD = settingFromEnv('FOOD_DEMOTE_THRESHOLD');

/** Pending rows each heavy requester is attached to — comfortably over {@link DEMOTION_THRESHOLD}. */
const HEAVY_FANOUT = 400;

/** A requester profile: how `fetch_requesters` is populated relative to the queue. */
type RequesterProfile = 'mixed' | 'adversarial';

/** One measured series. */
interface Measurement {
    readonly profile: RequesterProfile;
    readonly depth: number;
    readonly samples: number;
    readonly p50: number;
    readonly p95: number;
    readonly p99: number;
    readonly max: number;
    readonly requesterRows: number;
    readonly demotedRows: number;
}

const pool = new pg.Pool({ connectionString });
const db = drizzle(pool, { schema });
const dao = new FetchQueueDao(db);

const VOCAB_PARAMS = { preparations: 1, ingredients: 2, cuts: 3, brands: 4 } as const;
const vocabValues = [[...PREPARATIONS], [...INGREDIENTS], [...CUTS], [...BRANDS]];

/**
 * Fail with an actionable message and a non-zero exit.
 *
 * @param message - What went wrong and what to do about it.
 * @sideEffect Terminates the process.
 */
function fail(message: string): never {
    console.error(`drain-demotion: ${message}`);
    process.exit(1);
}

/**
 * Require the food schema to already exist. Never creates it — this script is a measurement, and a
 * measurement that silently provisions its own environment hides the fact that nothing was measured.
 *
 * @sideEffect Reads `information_schema`; terminates the process when the schema is absent.
 */
async function requireSchema(): Promise<void> {
    const { rows } = await pool.query<{ present: boolean }>(
        `SELECT count(*) = 3 AS present
           FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name IN ('food', 'fetch_queue', 'fetch_requesters')`,
    );

    if (rows[0]?.present !== true) {
        fail(
            'the food schema is not present in this database. Apply the ordered DDL first:\n' +
                '  for f in src/db/migrations/*.sql; do psql -v ON_ERROR_STOP=1 -f "$f"; done',
        );
    }
}

/** The `LIKE` pattern matching every `queue`-kind fixture food id (this script's own id space). */
const QUEUE_ID_PATTERN = `01JPERF000${PERF_KIND_LETTER.queue}%`;

/**
 * Delete every row this script owns, so each (profile, depth) series starts from a known queue.
 *
 * Scoped by the `queue` id space, NOT `TRUNCATE`: the same database holds the read/search fixture (and, in
 * CI, whatever the erasure scenario left behind), and a blanket truncate would silently destroy the
 * population a later script measures against.
 *
 * @sideEffect Deletes from `fetch_requesters`, `fetch_queue` and `food`.
 */
async function resetQueueFixture(): Promise<void> {
    await pool.query('DELETE FROM fetch_requesters WHERE food_id LIKE $1', [QUEUE_ID_PATTERN]);
    await pool.query('DELETE FROM fetch_queue WHERE food_id LIKE $1', [QUEUE_ID_PATTERN]);
    await pool.query('DELETE FROM food WHERE id LIKE $1', [QUEUE_ID_PATTERN]);
}

/**
 * Seed `depth` PENDING foods, their queue rows and their requester rows for the given profile.
 *
 * `first_requested` is staggered and `request_count` varied so the ORDER BY's second and third keys
 * (`request_count DESC, first_requested ASC`) have real work to do — a queue where every row ties on both
 * would let the sort settle on heap order and understate the claim's cost.
 *
 * @param depth - Pending rows to create.
 * @param profile - Requester mix (see the module docblock).
 * @returns How many `fetch_requesters` rows were written.
 * @sideEffect Writes to `food`, `food_sources`, `fetch_queue` and `fetch_requesters`; runs `ANALYZE`.
 */
async function seedQueue(depth: number, profile: RequesterProfile): Promise<number> {
    const name = perfFoodNameSql('queue', 's.i', VOCAB_PARAMS);

    await pool.query(
        `INSERT INTO food (id, name, normalized_name, description, kind, status, origin, created_at, updated_at)
         SELECT ${perfFoodIdSql('queue', 's.i')}, ${name}, lower(${name}), NULL,
                'generic', 'PENDING', 'live', now(), now()
           FROM generate_series(0, $5::int - 1) AS s(i)
         ON CONFLICT DO NOTHING`,
        [...vocabValues, depth],
    );

    // One crosswalk row per queued food: the consumer's provenance check and the merge path both read it,
    // so a queue of foods with no `food_sources` row is not the shape the drainer meets.
    await pool.query(
        `INSERT INTO food_sources (id, food_id, source, external_key, fetch_state, fetched_at)
         SELECT ${perfSourceIdSql('queue', 's.i')}, ${perfFoodIdSql('queue', 's.i')},
                'usda', ($2::bigint + s.i)::text, 'fetched', now()
           FROM generate_series(0, $1::int - 1) AS s(i)
         ON CONFLICT DO NOTHING`,
        [depth, Number(perfExternalKey('queue', 0))],
    );

    await pool.query(
        `INSERT INTO fetch_queue (food_id, request_count, first_requested, last_requested, status, attempts)
         SELECT ${perfFoodIdSql('queue', 's.i')},
                1 + (s.i % 7),
                now() - make_interval(secs => (s.i % 3600)),
                now() - make_interval(secs => 60),
                'pending',
                0
           FROM generate_series(0, $1::int - 1) AS s(i)
         ON CONFLICT DO NOTHING`,
        [depth],
    );

    // Heavy requesters: enough of them that each is attached to ~HEAVY_FANOUT pending rows, i.e. far over
    // the demotion threshold. Two per food, so no food is demoted or promoted by a single requester alone.
    const heavyPool = Math.max(1, Math.ceil((depth * 2) / HEAVY_FANOUT));
    const heavy = await pool.query(
        `INSERT INTO fetch_requesters (food_id, requester_id, requested_at)
         SELECT ${perfFoodIdSql('queue', 's.i')},
                'heavy-' || lpad(((s.i * t.stride + t.shift) % $2::int)::text, 6, '0'),
                now()
           FROM generate_series(0, $1::int - 1) AS s(i)
           CROSS JOIN (VALUES (1, 0), (7, 3)) AS t(stride, shift)
         ON CONFLICT DO NOTHING`,
        [depth, heavyPool],
    );

    let requesterRows = heavy.rowCount ?? 0;

    if (profile === 'mixed') {
        // One requester of its own per food, with exactly ONE pending row: under the threshold, so the
        // inner EXISTS finds it and short-circuits. This is what makes `mixed` the cheap realistic case.
        const light = await pool.query(
            `INSERT INTO fetch_requesters (food_id, requester_id, requested_at)
             SELECT ${perfFoodIdSql('queue', 's.i')}, 'light-' || lpad(s.i::text, 8, '0'), now()
               FROM generate_series(0, $1::int - 1) AS s(i)
             ON CONFLICT DO NOTHING`,
            [depth],
        );

        requesterRows += light.rowCount ?? 0;
    }

    // Without statistics the planner picks a plan the deployed service would never pick, so the measured
    // cost would describe a fictional plan. (Same reason `prepare-perf-fixture.ts` analyzes.)
    await pool.query('ANALYZE food, fetch_queue, fetch_requesters');

    return requesterRows;
}

/**
 * How many of the seeded rows the demotion clause actually ranks to the back — i.e. whether fairness is
 * ENGAGED for this profile.
 *
 * This is a measurement-validity check, not a service assertion. A run of the `adversarial` profile in
 * which nothing is demoted has not exercised the expensive branch at all, and its fast p95 would be a
 * false all-clear for exactly the risk DSN-11 raises. The predicate is expressed against the DAO's own
 * threshold constant, and the count is reported next to every timing.
 *
 * @returns The number of queued rows that sort to the demoted tier.
 * @sideEffect Reads `fetch_queue` and `fetch_requesters`.
 */
async function countDemotedRows(): Promise<number> {
    const { rows } = await pool.query<{ demoted: number }>(
        `SELECT count(*)::int AS demoted
           FROM fetch_queue q
          WHERE q.food_id LIKE $1
            AND q.status = 'pending'
            AND NOT EXISTS (
                SELECT 1 FROM fetch_requesters r
                 WHERE r.food_id = q.food_id
                   AND (SELECT count(*) FROM fetch_queue fq JOIN fetch_requesters fr USING (food_id)
                         WHERE fr.requester_id = r.requester_id AND fq.status IN ('pending', 'in_flight')
                       ) <= $2::int
            )`,
        [QUEUE_ID_PATTERN, DEMOTION_THRESHOLD],
    );

    return rows[0]?.demoted ?? 0;
}

/** The `percentile`-th value of a sorted-ascending copy of `values`. Pure. */
function percentile(values: readonly number[], percentileRank: number): number {
    const sorted = [...values].sort((left, right) => left - right);
    const index = Math.min(sorted.length - 1, Math.ceil((percentileRank / 100) * sorted.length) - 1);

    return sorted[Math.max(0, index)] ?? Number.NaN;
}

/**
 * Time up to {@link SAMPLES} `leaseNext` claims at a fixed depth.
 *
 * After each claim the leased row is reverted to `pending` OUTSIDE the timing, so every sample sees the
 * SAME queue depth. Without that the depth would shrink monotonically and the series would silently
 * measure a progressively cheaper query — the exact failure this probe exists to detect.
 *
 * A claim that returns nothing is a hard failure, not a skipped sample: it means the eligibility predicate
 * did not match the seeded rows, so nothing was measured.
 *
 * **Sampling is time-bounded.** A series stops early once it has at least {@link MIN_SAMPLES} samples AND
 * has spent {@link SERIES_BUDGET_MS}, because a single claim at the FR-046 ceiling can cost seconds and a
 * fixed sample count would make the run's duration a multiple of the very slowness being measured. The
 * ACTUAL sample count is reported in every row of the table, and an early stop prints why — a shortened
 * series is a stated limitation of that number, never a silent one. (It also only ever happens when a
 * series is already far over budget, where the extra samples would not change the verdict.)
 *
 * @param depth - The seeded depth (for the error message only).
 * @returns The per-claim durations in milliseconds.
 * @sideEffect Leases and un-leases `fetch_queue` rows.
 */
async function measureClaims(depth: number): Promise<number[]> {
    const durations: number[] = [];
    const seriesStarted = Date.now();

    for (let attempt = 0; attempt < WARMUP + SAMPLES; attempt += 1) {
        const started = process.hrtime.bigint();
        const row = await dao.leaseNext();
        const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

        if (!row) {
            fail(
                `leaseNext() claimed nothing at depth ${depth}. The seeded rows are not eligible, so no ` +
                    `claim was measured — check that fetch_queue holds 'pending' rows with ` +
                    `last_requested <= now().`,
            );
        }

        await pool.query(`UPDATE fetch_queue SET status = 'pending', leased_at = NULL WHERE food_id = $1`, [
            row.foodId,
        ]);

        if (attempt >= WARMUP) {
            durations.push(elapsedMs);
        }

        if (durations.length >= MIN_SAMPLES && Date.now() - seriesStarted > SERIES_BUDGET_MS) {
            console.log(
                `drain-demotion: depth ${depth} stopped after ${durations.length} sample(s) — the series ` +
                    `exceeded its ${SERIES_BUDGET_MS}ms wall-clock budget, which at this depth means each ` +
                    `claim costs on the order of ${(SERIES_BUDGET_MS / durations.length).toFixed(0)}ms.`,
            );
            break;
        }
    }

    return durations;
}

/**
 * Seed, validate and measure one (profile, depth) series.
 *
 * @param profile - Requester mix.
 * @param depth - Pending queue depth.
 * @returns The measurement.
 * @sideEffect Rewrites this script's queue fixture and leases rows.
 */
async function runSeries(profile: RequesterProfile, depth: number): Promise<Measurement> {
    await resetQueueFixture();
    const requesterRows = await seedQueue(depth, profile);

    const seeded = await pool.query<{ pending: number }>(
        `SELECT count(*)::int AS pending FROM fetch_queue WHERE food_id LIKE $1 AND status = 'pending'`,
        [QUEUE_ID_PATTERN],
    );

    if (seeded.rows[0]?.pending !== depth) {
        fail(
            `expected ${depth} pending rows after seeding but found ${seeded.rows[0]?.pending ?? 'none'} — ` +
                `the measurement would describe a different depth than it reports.`,
        );
    }

    const demotedRows = await countDemotedRows();

    if (profile === 'adversarial' && demotedRows !== depth) {
        fail(
            `the 'adversarial' profile demoted ${demotedRows} of ${depth} rows, not all of them. The ` +
                `expensive no-short-circuit branch of the demotion clause was NOT exercised, so a fast ` +
                `result here would be a false all-clear for DSN-11. Check HEAVY_FANOUT vs the ` +
                `${DEMOTION_THRESHOLD}-row threshold in FetchQueueDao.`,
        );
    }

    if (profile === 'mixed' && demotedRows !== 0) {
        fail(
            `the 'mixed' profile demoted ${demotedRows} row(s); it is meant to be the un-demoted steady ` +
                `state (every food has a single-pending requester). The contrast with 'adversarial' is the ` +
                `evidence, so a polluted 'mixed' series invalidates it.`,
        );
    }

    const durations = await measureClaims(depth);

    return {
        profile,
        depth,
        samples: durations.length,
        p50: percentile(durations, 50),
        p95: percentile(durations, 95),
        p99: percentile(durations, 99),
        max: Math.max(...durations),
        requesterRows,
        demotedRows,
    };
}

/** Format a millisecond value for the report. Pure. */
function ms(value: number): string {
    return `${value.toFixed(2)}ms`;
}

try {
    if (DEPTHS.length === 0) {
        fail('FOOD_DRAIN_DEPTHS parsed to no usable depth — expected e.g. "100,10000".');
    }

    await requireSchema();

    const measurements: Measurement[] = [];

    for (const profile of ['mixed', 'adversarial'] as const) {
        for (const depth of DEPTHS) {
            measurements.push(await runSeries(profile, depth));
        }
    }

    await resetQueueFixture();

    console.log(
        `\ndrain-demotion: FetchQueueDao.leaseNext() — ${SAMPLES} measured claims per series ` +
            `(+${WARMUP} discarded warm-up), budget p95 <= ${CLAIM_P95_BUDGET_MS}ms (10% of SC-003's ` +
            `600ms-per-item drain slot at depth 100, single drainer).\n`,
    );
    console.log('profile      depth   requesters  demoted  n        p50        p95        p99        max');

    for (const entry of measurements) {
        console.log(
            `${entry.profile.padEnd(12)} ${String(entry.depth).padStart(5)}   ` +
                `${String(entry.requesterRows).padStart(10)}  ${String(entry.demotedRows).padStart(7)}  ` +
                `${String(entry.samples).padStart(2)}  ${ms(entry.p50).padStart(9)}  ${ms(entry.p95).padStart(9)}  ` +
                `${ms(entry.p99).padStart(9)}  ${ms(entry.max).padStart(9)}`,
        );
    }

    // The claim overhead a 100-item backlog pays, expressed against the budget SC-003 actually states.
    for (const entry of measurements) {
        const backlogSeconds = (entry.p95 * 100) / 1000;
        console.log(
            `drain-demotion: at depth ${entry.depth} (${entry.profile}), draining a 100-item backlog spends ` +
                `${backlogSeconds.toFixed(1)}s in claim overhead alone — ${((backlogSeconds / 60) * 100).toFixed(1)}% ` +
                `of SC-003's 60s budget, before any source call.`,
        );
    }

    const breaches = measurements.filter((entry) => entry.p95 > CLAIM_P95_BUDGET_MS);

    if (breaches.length > 0) {
        console.error('');

        for (const entry of breaches) {
            console.error(
                `drain-demotion: BREACH — ${entry.profile} @ depth ${entry.depth}: claim p95 ${ms(entry.p95)} ` +
                    `> ${CLAIM_P95_BUDGET_MS}ms.`,
            );
        }

        fail(
            "the per-`sub` correlated COUNT(*) demotion in leaseNext()'s ORDER BY does NOT stay within the " +
                'SC-003 backfill budget.\n' +
                'ESCALATION (DSN-11, specs/003-usda-food-data/tasks.md T-151 / T-195): materialize the ' +
                'per-`sub` pending count — a maintained counter or a summary table keyed by `requester_id` — ' +
                'so the drain ORDER BY reads a scalar instead of running a correlated aggregate per candidate ' +
                'row. Do NOT raise FOOD_DRAIN_CLAIM_P95_MS to make this pass: the budget is derived from ' +
                "SC-003's own 60s promise, and widening it changes the reported number, not the drain rate.",
        );
    }

    console.log(
        `\ndrain-demotion: PASS — every series stayed within ${CLAIM_P95_BUDGET_MS}ms p95, so the DSN-11 ` +
            `correlated COUNT(*) is within the SC-003 backfill budget at the measured depths.`,
    );
} finally {
    await pool.end();
}
