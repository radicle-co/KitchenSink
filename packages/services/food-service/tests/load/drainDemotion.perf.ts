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
 * The stabilization ledger flagged FR-043's live fairness demotion MEDIUM (DSN-11) with the caveat
 * "acceptable at launch scale (< 10,000 rows), revisit/materialize a per-`sub` pending count at scale —
 * cost is covered by the drain/demotion perf test in T-195". This script IS that test.
 *
 * ⚠️ The query it measures has been rewritten TWICE since this file was written, and the numbers moved each
 * time. As originally written, `leaseNext`'s demotion was the LEADING key of the `ORDER BY`, a per-row
 * per-requester correlated `COUNT(*)`; a computed leading sort key must be evaluated for every eligible row,
 * so `LIMIT 1` could not avoid it and the run measured ~20s per claim at the ceiling. **T-197** made the
 * fairness term a `WHERE` filter over an `over_demand AS MATERIALIZED` CTE computed ONCE per claim, restoring
 * `idx_fetch_queue_priority` and cutting the ceiling to tens of milliseconds. **T-201** then removed the one
 * case T-197 left linear in depth — the run below is what caught it — by gating the promoted branch on a
 * `promoted_ready` probe answered from the aggregate, so an empty promoted tier is no longer proven by
 * examining every row. Read the current shape in `fetchQueue.dao.ts`'s `leaseNext` JSDoc; do not read the
 * profiles below as descriptions of a correlated subquery that no longer exists.
 *
 * ## The two requester profiles, and why both are needed
 *
 * The cost depends entirely on the requester mix, and one profile would measure only one side of it:
 *
 *   - `mixed` — every food has one heavy requester (hundreds pending) AND one requester of its own with a
 *     single pending row. Nothing is demoted, so the promoted-tier branch finds a qualifying row almost
 *     immediately and the index scan early-terminates (`rows=1 loops=1`). This is the realistic steady
 *     state.
 *   - `adversarial` — every requester of every food is over the threshold, so NOTHING qualifies for the
 *     promoted tier. This is FR-043's own worst case (a queue dominated by heavy requesters is exactly when
 *     demotion is supposed to engage) and it is the series that has caught every regression this probe has
 *     ever caught. Post-T-197 it was the full-scan-to-prove-empty — the branch had to examine EVERY eligible
 *     row to conclude its tier was empty — which is what breached at depth 10,000 on CI (85.52ms p95 vs the
 *     60ms budget) while passing on a ~3x faster dev machine at 28.66ms. T-201's `promoted_ready` gate
 *     answers that question from the aggregate instead, so the branch is skipped entirely; what remains
 *     measured here is the one per-claim aggregate over `fetch_requesters`. THIS RUN, ON THIS RUNNER, IS THE
 *     ONLY ARBITER — a local number says nothing about CI, in either direction.
 *
 * Both are measured at every depth, so the report distinguishes "the query is fine" from "the query is fine
 * until fairness actually has work to do".
 *
 * ## The third mechanism: a HOST STALL, and why the sample count is 300 (2026-08-12)
 *
 * This probe has now produced a red for a reason that is neither of the two query shapes above, and it did it
 * twice in five runs on one branch. Run 31608073724 reported `mixed` @10,000 at **90.23ms p95 against the
 * 60ms budget** — a 5.4x "regression" over the 16.59ms the budget was confirmed at — while the MEDIAN of that
 * same series was **12.23ms**, the second-fastest ever measured for it and faster than the 15.69ms median of
 * the confirming run. The query had not changed and neither had its plan: `EXPLAIN (ANALYZE, BUFFERS)` on the
 * statement the DAO actually sends shows the documented shape intact, and the branch the failure was first
 * attributed to costs **1.55ms of an 8.89ms statement** (the FR-043 `demand` aggregate is 81% of it).
 *
 * Two things combined to turn runner noise into a contract breach:
 *
 *   1. **{@link percentile} at n=30 made "p95" the second-largest sample** (and "p99" the maximum,
 *      definitionally). Two slow samples out of thirty therefore decided the verdict, so the gate's real
 *      sensitivity was set by the host, not by the query. {@link SAMPLES} is now 300, where p95 is the
 *      16th-largest observation. The budget, the fixture and the depths are UNCHANGED.
 *   2. **The reported framing said SC-003.** A depth-10,000 breach was printed as a share of "SC-003's 60s
 *      budget", which is a promise conditioned on a depth under 100. See {@link SC003_MAX_DEPTH}.
 *
 * A ±15% variance allowance on perf metrics was granted separately (owner ruling 2026-08-12,
 * {@link CLAIM_P95_VARIANCE_ALLOWANCE}) and is **not** what fixed this: it puts the enforced ceiling at 69ms,
 * and the failing run measured 90.23ms — 50% over the budget, not 15%. The sample-count change is the fix; the
 * allowance is a stated margin on top of it. Do not read the two as interchangeable.
 *
 * The stall mechanism was reproduced on a quiet workstation, so it is not specific to CI: with medians of
 * 8-10ms at depth 10,000, single samples of **62.63ms and 73.78ms** were observed, and two 300-sample
 * measurements of the IDENTICAL fixture minutes apart returned p95 32.28ms and 7.60ms. It was also measured
 * NOT to be this harness's own fixture churn — the plausible suspect, since each series bulk-deletes and
 * re-inserts tens of thousands of rows: 300 samples before and after an explicit `VACUUM (ANALYZE)` moved p50
 * by 0.2-0.4ms (6.64 -> 6.40 `adversarial`, 9.89 -> 9.48 `mixed`) and `autovacuum_count` did not advance
 * during either phase.
 *
 * **Stated honestly: what remains UNPROVEN is the source of the stalls on GitHub's runners** — CPU steal
 * versus IO contention is not diagnosed, and cannot be from inside the job. What IS established is that the
 * stalls exist, that they are not the query, and that they are not this fixture's vacuum state.
 *
 * Usage (from packages/services/food-service):
 *   DATABASE_URL=postgres://postgres:postgres@localhost:5432/food_load npm run test:load:drain
 *   FOOD_DRAIN_DEPTHS=100,1000,10000 FOOD_DRAIN_SAMPLES=50 DATABASE_URL=… npm run test:load:drain
 *
 * Exits NON-ZERO when a series exceeds {@link EFFECTIVE_CEILING_MS} — the SC-003-derived budget plus the
 * owner-granted variance allowance — with the DSN-11 escalation spelled out. Both numbers are printed for
 * every series, pass or fail, because a tolerance nobody can see is indistinguishable from a raised
 * threshold. It never widens the budget and never reports a skip as a pass.
 *
 * @sideEffect DELETES and rewrites the `queue`-kind fixture rows in `fetch_queue` / `fetch_requesters` /
 *            `food` on `DATABASE_URL`, and leases rows during measurement. Refuses any database not named
 *            in `perfFixture.ts`'s disposable allowlist.
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import { settingFromEnv } from '../../src/config/env.schema.js';
import * as schema from '../../src/db/schema/index.js';
import { FetchQueueDao } from '../../src/foods/dao/fetchQueue.dao.js';
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
} from './perfFixture.js';

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

/**
 * Measured claims per (profile, depth), subject to {@link SERIES_BUDGET_MS}.
 *
 * **300, not 30 — this is what makes the reported p95 an actual p95.** {@link percentile} is a nearest-rank
 * estimator, so at n=30 the "p95" it returns IS the second-largest sample and the "p99" IS the maximum,
 * definitionally. Two slow samples out of thirty therefore decided the verdict. That is how run 31608073724
 * reported `mixed` @10,000 at 90.23ms p95 while that same series' MEDIAN, 12.23ms, was the second-fastest
 * ever measured for it — faster than the 15.69ms of the run this budget was confirmed on. A 30-sample series
 * cannot resolve a tail finer than 1/30 = 3.3%, and it leaves only 1.5 expected samples above the very
 * percentile it claims to estimate.
 *
 * At 300 samples p95 is the 16th-largest observation, with 15 above it, so a burst of host stalls no longer
 * sets it while a genuine 5%-of-claims pathology still does. **Nothing is widened by this.** The budget, the
 * fixture, the profiles and the depths are untouched; the SAME quantity is estimated with enough samples to
 * mean what it says.
 *
 * Cost, measured on this workstation at depth 10,000 (the most expensive series): sampling grows from ~0.35s
 * to ~3.0s per series, against the ~18s of seeding per series that dominates either way — the two-profile
 * depth-10,000 run went **38.4s -> 42.1s** end to end. CI claims measure ~1.2-3x slower, so expect up to
 * ~10s of sampling per series there, still far inside {@link SERIES_BUDGET_MS}. A pathological regression is
 * still bounded by that wall-clock backstop, which stops a series once it holds {@link MIN_SAMPLES}.
 */
const SAMPLES = Math.max(5, Number(process.env['FOOD_DRAIN_SAMPLES'] ?? 300));

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
 *
 * This number is the CONTRACT arithmetic and stays 60. The separate, owner-granted variance allowance that
 * turns it into the enforced ceiling is {@link CLAIM_P95_VARIANCE_ALLOWANCE} — deliberately a second number,
 * so a reader can always see what SC-003 derives and what the runner is being forgiven.
 */
const CLAIM_P95_BUDGET_MS = Number(process.env['FOOD_DRAIN_CLAIM_P95_MS'] ?? 60);

/**
 * Variance allowance on the measured p95, as a fraction of {@link CLAIM_P95_BUDGET_MS} (15%).
 *
 * **Owner ruling, 2026-08-12:** _"I think we have to account for and allow variations with plus/minus 15% on
 * perf metrics."_ It is the general form of the SC-007 ruling of 2026-08-10, which widened that budget to
 * 250ms ±15% because "a p95 measured on shared CI hardware needs a stated allowance for run-to-run variance,
 * and a gate that reds on hardware noise trains everyone to ignore red gates" (spec.md SC-007). Recorded
 * beside SC-003 and SC-007 in `specs/003-usda-food-data/spec.md`, not only here.
 *
 * **Kept as a separate constant on purpose, and NOT folded into the 60.** The 60 is derived from SC-003's own
 * arithmetic and must stay visibly derived; the 15% is a judgement about measurement noise and must stay
 * visibly a judgement. A single 69 would lose both facts and read as a quietly raised budget — the exact move
 * this script's own warning forbids. It is also deliberately NOT env-overridable: `FOOD_DRAIN_CLAIM_P95_MS`
 * already exists for exploration, and a second knob that loosens the gate is a second way to lose the number.
 *
 * ⚠️ **What this allowance does and does not buy — state it accurately or the next reader will misdiagnose.**
 * It does NOT rescue the run this was granted after: 60 × 1.15 = **69ms**, and run 31608073724 measured
 * **90.23ms**, i.e. 50% over the budget, not 15%. What removed that false red is the {@link SAMPLES} change
 * (30 → 300), which makes the reported p95 the 16th-largest observation rather than the second-largest: the
 * worst contaminated p95 measured at n=300 was **32.28ms**, comfortably inside 60ms, let alone 69ms. The
 * allowance is a stated safety margin ON TOP of an honest estimator — never the mechanism that makes the
 * estimator honest.
 *
 * **Residual, accepted rather than closed:** a contamination episode large enough to move the 16th-largest of
 * 300 samples past 69ms would still red the job. That is now a deliberately accepted risk with a number on
 * it, instead of an unexamined one.
 */
const CLAIM_P95_VARIANCE_ALLOWANCE = 0.15;

/**
 * The ceiling actually enforced: {@link CLAIM_P95_BUDGET_MS} plus its {@link CLAIM_P95_VARIANCE_ALLOWANCE}.
 *
 * Derived in ONE place and printed on EVERY series, pass or fail. A tolerance a reader cannot see in the
 * output is indistinguishable from a raised threshold, which is precisely what this script warns against.
 */
const EFFECTIVE_CEILING_MS = CLAIM_P95_BUDGET_MS * (1 + CLAIM_P95_VARIANCE_ALLOWANCE);

/**
 * The queue depth below which SC-003's promise binds: it is conditioned on "when the `fetch_queue`
 * pending-row depth is **under 100 rows**" (spec.md SC-003), which is also where
 * {@link CLAIM_P95_BUDGET_MS} is derived from.
 *
 * Above this depth the SAME bar ({@link EFFECTIVE_CEILING_MS}) still applies and still fails the run — it is
 * the depth-independent engineering intent that the queue machinery must not be what sets the drain rate —
 * but a breach there is an **FR-046 ceiling / DSN-11 scaling** finding, NOT a breach of SC-003. The
 * variance allowance applies at EVERY depth including this one, which is a small, deliberate loosening of a
 * contract gate and is recorded next to SC-003 in the spec rather than only here. The distinction is not
 * pedantry: a
 * breach above this depth was reported as "15.0% of SC-003's 60s budget", which reads as a product-promise
 * emergency and sent a reader after the wrong mechanism entirely.
 */
const SC003_MAX_DEPTH = 100;

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
    // cost would describe a fictional plan. (Same reason `preparePerfFixture.ts` analyzes.)
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

/**
 * The `percentile`-th value of `values` by **nearest rank** — the observed sample at `ceil(p/100 x n)`, with
 * NO interpolation. Pure.
 *
 * Nearest rank is deliberate and is what k6 and the other load tools in this repo report: a latency gate
 * should assert on a measurement that actually happened, not on a synthetic value interpolated between two
 * samples that did. It is kept rather than "fixed" for that reason.
 *
 * ⚠️ **What the estimator cannot fix, so read it here: a percentile only means something when `n` is large
 * enough to have samples above it.** The zero-based rank is `ceil(p/100 x n) - 1`, so:
 *
 *   - n=30:  p95 -> index 28 = the **2nd-largest** sample; p99 -> index 29 = **the maximum, definitionally**.
 *     That is why every table this probe printed under the old 30-sample default had `p99 == max` in EVERY
 *     row — it was arithmetic, not a property of the queue, and it must not be read as a tail measurement.
 *   - n=300: p95 -> index 284 = the 16th-largest, with 15 samples above it, which is enough to mean what it
 *     says; p99 -> index 296 = the 4th-largest, with only 3 above it.
 *
 * Rule of thumb: a p-th percentile needs `n >= 10 x 100/(100-p)` before it stops being a near-max — 200 for
 * p95, 1,000 for p99. {@link SAMPLES} is sized for **p95**, which is the budgeted statistic. `p99` and `max`
 * are reported as tail DIAGNOSTICS — they are what expose a host stall (see the breach message) — and
 * nothing gates on them.
 */
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
            `(+${WARMUP} discarded warm-up). Budget p95 <= ${CLAIM_P95_BUDGET_MS}ms (10% of SC-003's ` +
            `600ms-per-item drain slot at depth ${SC003_MAX_DEPTH}, single drainer), plus a ` +
            `${(CLAIM_P95_VARIANCE_ALLOWANCE * 100).toFixed(0)}% variance allowance on perf metrics (owner ` +
            `ruling 2026-08-12) => ENFORCED CEILING ${ms(EFFECTIVE_CEILING_MS)}.\n`,
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

    // What the measured claim cost MEANS, framed by the depth it was measured at.
    //
    // Only at or below SC003_MAX_DEPTH does SC-003's 60s promise bind, so only there is "the claim's share of
    // that budget" the right translation. Above it the claim cost is a SCALING measurement — FR-046's ceiling
    // and DSN-11's "revisit at N rows" — and the honest translation is what the FULL backlog at that depth
    // costs in claim overhead, with no 60s comparison at all. Printing the depth-100 arithmetic at depth
    // 10,000 produced "draining a 100-item backlog … 15.0% of SC-003's 60s budget", which is a category
    // error twice over: at that depth the backlog is 10,000 items, not 100, and enqueues are already failing
    // closed with 503 (FR-046). It read as an SC-003 emergency that the spec does not describe.
    // Every series states its verdict against BOTH numbers, pass or fail: the measured p95, the SC-003-derived
    // budget, the owner-granted allowance, and the ceiling the two produce. A tolerance that only appears when
    // it is needed is indistinguishable from a threshold someone raised quietly.
    for (const entry of measurements) {
        console.log(
            `drain-demotion: ${entry.profile} @ depth ${entry.depth}: p95 ${ms(entry.p95)} vs ceiling ` +
                `${ms(EFFECTIVE_CEILING_MS)} (${CLAIM_P95_BUDGET_MS}ms budget + ` +
                `${(CLAIM_P95_VARIANCE_ALLOWANCE * 100).toFixed(0)}% variance allowance) — ` +
                `${entry.p95 > EFFECTIVE_CEILING_MS ? 'OVER' : 'WITHIN'}, ` +
                `${((entry.p95 / EFFECTIVE_CEILING_MS) * 100).toFixed(1)}% of ceiling.`,
        );
    }

    for (const entry of measurements) {
        const backlogSeconds = (entry.p95 * entry.depth) / 1000;

        if (entry.depth <= SC003_MAX_DEPTH) {
            console.log(
                `drain-demotion: at depth ${entry.depth} (${entry.profile}), draining a ${entry.depth}-item ` +
                    `backlog spends ${backlogSeconds.toFixed(1)}s in claim overhead alone — ` +
                    `${((backlogSeconds / 60) * 100).toFixed(1)}% of SC-003's 60s budget, before any source call.`,
            );
        } else {
            console.log(
                `drain-demotion: at depth ${entry.depth} (${entry.profile}), draining the full ` +
                    `${entry.depth}-item backlog spends ${backlogSeconds.toFixed(1)}s in claim overhead alone. ` +
                    `That is an FR-046-ceiling SCALING figure (DSN-11), NOT an SC-003 number: SC-003's 60s ` +
                    `promise is conditioned on a pending depth under ${SC003_MAX_DEPTH}.`,
            );
        }
    }

    const breaches = measurements.filter((entry) => entry.p95 > EFFECTIVE_CEILING_MS);

    if (breaches.length > 0) {
        console.error('');

        for (const entry of breaches) {
            const kind = entry.depth <= SC003_MAX_DEPTH ? 'SC-003' : 'FR-046 ceiling / DSN-11 scaling';

            console.error(
                `drain-demotion: BREACH (${kind}) — ${entry.profile} @ depth ${entry.depth}: claim p95 ` +
                    `${ms(entry.p95)} > ${ms(EFFECTIVE_CEILING_MS)} (${CLAIM_P95_BUDGET_MS}ms budget + ` +
                    `${(CLAIM_P95_VARIANCE_ALLOWANCE * 100).toFixed(0)}% variance allowance; p50 ` +
                    `${ms(entry.p50)}, p99 ${ms(entry.p99)}, max ${ms(entry.max)} over ${entry.samples} samples).`,
            );
        }

        // WHICH contract broke depends on the depth, and the answer changes what the reader should do next.
        const breachesSc003 = breaches.some((entry) => entry.depth <= SC003_MAX_DEPTH);
        const headline = breachesSc003
            ? 'the FR-043 fairness demotion in leaseNext() does NOT stay within the SC-003 backfill budget ' +
              `on this runner — the breach is at depth <= ${SC003_MAX_DEPTH}, where SC-003's 60s promise ` +
              'actually binds.\n'
            : `every breach is ABOVE depth ${SC003_MAX_DEPTH}, so this is an FR-046-CEILING / DSN-11 SCALING ` +
              'breach, NOT a breach of SC-003 (whose 60s promise is conditioned on a pending depth under ' +
              `${SC003_MAX_DEPTH}, and which passes above). It still fails the run deliberately: the queue ` +
              'machinery is starting to set the drain rate, and depth >= 1,000 is where BOTH real defects ' +
              'this probe has ever caught actually surfaced while depth 100 kept 8-12x headroom.\n';

        fail(
            headline +
                `Note the ceiling breached ALREADY INCLUDES the ${(CLAIM_P95_VARIANCE_ALLOWANCE * 100).toFixed(0)}% ` +
                'variance allowance (owner ruling 2026-08-12), so run-to-run noise of that size has already ' +
                'been forgiven. The allowance is a margin on top of an honest estimator, not a substitute for ' +
                'one — it is NOT what keeps a host stall from reddening this gate; the 300-sample p95 is.\n' +
                'DIAGNOSE BEFORE CHANGING ANYTHING — three mechanisms produce this red and they need ' +
                'different fixes (all recorded in tests/load/README.md "Finding 2"):\n' +
                '  • FIRST, rule out a HOST STALL on the runner, because it is the cheapest to check and the ' +
                'most common cause of this red. Signature: the MEDIAN is in family with earlier runs (or ' +
                'faster) and only p95/p99/max moved, and often ANOTHER series in the same run spikes at a ' +
                'depth where the claim does almost no work. Recorded example: run 31537195430 measured ' +
                '`mixed` @100 at p50 2.31ms with p95 56.51ms — 94% of the 60ms budget at the depth where SC-003 ' +
                'binds, from stalls alone; run 31608073724 reported `mixed` @10,000 at p95 90.23ms with a ' +
                'p50 of 12.23ms, faster than the 15.69ms median of the run this budget was confirmed on. ' +
                'Compare MEDIANS against tests/load/README.md "Finding 2" before touching the query.\n' +
                '  • if `mixed` and `adversarial` breach TOGETHER and scale with requester rows, the ' +
                'per-claim `demand` aggregate is the cost — the escalation is a MAINTAINED per-requester ' +
                'outstanding count, accepting that it is a second representation of one number and needs a ' +
                'reconciliation test (see T-199a for why that matters).\n' +
                '  • if only `adversarial` breaches, the promoted branch is being WALKED instead of skipped: ' +
                "`promoted_ready`'s gate has regressed. `drainClaimScaling.integration.test.ts` asserts " +
                'that from the real EXPLAIN plan and will say so precisely.\n' +
                'Do NOT raise FOOD_DRAIN_CLAIM_P95_MS to make this pass, do NOT widen the 15% variance ' +
                'allowance (it is an owner ruling, and changing it needs another one), do NOT add ' +
                "continue-on-error, and do NOT narrow the fixture: the budget is derived from SC-003's own 60s " +
                'promise, and widening either number changes the reported figure, not the drain rate.',
        );
    }

    // The PASS line is depth-aware for the same reason the breach line is: claiming SC-003 compliance from a
    // depth-10,000 series would be the same category error in the green direction.
    const sc003Depths = DEPTHS.filter((depth) => depth <= SC003_MAX_DEPTH);
    const scalingDepths = DEPTHS.filter((depth) => depth > SC003_MAX_DEPTH);
    const sc003Verdict =
        sc003Depths.length > 0
            ? ` At depth ${sc003Depths.join(', ')} — where SC-003's 60s promise binds — FR-043's fairness ` +
              `demotion is within the SC-003 backfill budget (${CLAIM_P95_BUDGET_MS}ms + ` +
              `${(CLAIM_P95_VARIANCE_ALLOWANCE * 100).toFixed(0)}% allowance).`
            : '';
    const scalingVerdict =
        scalingDepths.length > 0
            ? ` At depth ${scalingDepths.join(', ')} the same per-claim bar holds as an FR-046-ceiling / ` +
              `DSN-11 scaling check, so the queue machinery is not what sets the drain rate (DSN-11 closed).`
            : '';

    console.log(
        `\ndrain-demotion: PASS — every series stayed within the ${ms(EFFECTIVE_CEILING_MS)} enforced ceiling ` +
            `at p95.${sc003Verdict}${scalingVerdict}`,
    );
} finally {
    await pool.end();
}
