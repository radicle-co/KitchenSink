// Shared configuration, performance budgets and load-shape helpers for the food-service k6 load suite.
//
// These modules are ES-module JavaScript executed by the **k6 binary** (`k6 run ...`) — they are NOT part
// of the vitest suite and must only import from k6's built-in modules (`k6`, `k6/http`, `k6/metrics`,
// `k6/data`, `k6/execution`). Those specifiers are resolved by k6 itself, never by npm. All target and
// credential configuration is read from the environment via k6's `__ENV`.
//
// Mirrors `packages/services/recipe-service/tests/load/lib/common.js` and identity's equivalent.

import exec from 'k6/execution';
// ⛔ k6 resolves ES modules on the FILESYSTEM and rejects bare specifiers outright (`GoError: the
// moduleSpecifier "@kitchensink/loadtest/k6/session.js" couldn't be recognised as something k6
// supports`), so the workspace name this rule asks for cannot be used here — verified against the
// k6 binary, not assumed. The shared module is why the bearer survives a leg longer than a token.
// eslint-disable-next-line import-x/no-relative-packages
import { freshBearer, loadSessionHandles } from '../../../../../tools/loadtest/k6/session.js';

// Base URL of the food-service under test (Nest app / ALB host). Defaults to the local dev port.
export const BASE_URL = (__ENV['FOOD_API_BASE_URL'] || 'http://localhost:3000').replace(/\/+$/, '');

// --- Performance budgets ------------------------------------------------------------------------
//
// PROVENANCE. Every number below traces to a numbered success criterion in
// `specs/003-usda-food-data/spec.md`, and each states a CONCRETE MECHANISM that can breach it. A budget
// nothing can cross is theatre; a budget with no cited source is a preference.
//
//   SC-001  local-store reads of RESOLVED foods  <= 50ms p95
//   SC-003  backfill 202 -> RESOLVED             <= 60s p95 at pending queue depth < 100
//   SC-004  local-store serve rate               >  80% once the store holds 5,000+ RESOLVED foods
//   SC-005  local-store read throughput          >> 5,000 served reads / hour
//   SC-007  search against <= 50,000 foods       <= 500ms p95 (owner ruling 2026-08-24)
//
// SC-003 is NOT measurable by k6 (it spans the Fargate fan-out worker and a source HTTP call, which this
// suite must not make). Its DB-side component — the drain claim that the FR-046 ceiling stresses — is
// measured by `../drainDemotion.perf.ts`, which owns that budget and its derivation.

// SC-001 verbatim: "Food reads for locally-RESOLVED items MUST return within 50ms at p95 latency."
// Measured on `GET /api/v1/foods/{id}` for a RESOLVED food ONLY — a 202/404 read is a different, cheaper
// query and is tagged separately so it cannot flatter this number.
//
// BREACHABLE BY: the route is SIX sequential/parallel DB round trips behind a signature verification —
// `FoodAuthGuard` verifies the RS256 token in-process (SC-011 budgets that at <= 10ms of the 50ms), then
// `FoodDao.readGoldenRecord` reads the `food` row and fans out over `food_sources`,
// `food_nutrients ⋈ nutrient`, `food_portions` and `food_field_provenance`. Any of these moves it: the
// 20-connection `pg` pool saturating, losing `food_nutrients_food_id_idx` (the fan-out then sequentially
// scans ~1M value rows), one more `await` added to the chain, or a nutrient set that grows per food.
export const READ_P95_MS = Number(__ENV['FOOD_READ_P95_MS'] || 50);

// SC-004 verbatim: "The local-store serve rate (reads served from the local store without any source
// call) MUST exceed 80% once the local store contains 5,000+ unique RESOLVED foods."
//
// OPERATIONALIZED as: the share of reads that return a golden record (`200`). A `202` (PENDING /
// UNRESOLVED) or `404` (NOT_FOUND / FAILED) read returned NO food data — the caller must wait for a
// source fetch to complete — so it is by definition not "served from the local store". The fixture sets
// the CEILING (9 of every 10 reads target a RESOLVED food, so the achievable rate is 90%); the threshold
// is what fails when the system starts losing local serves.
//
// BREACHABLE BY: any regression that stops a RESOLVED food being served — a lifecycle-status write bug
// that leaves resolved foods `PENDING`, `readGoldenRecord` returning `null` for a live row (which the
// controller maps to `404`), the read path erroring under pool exhaustion, or the golden-record read
// losing its `RESOLVED` fast path. Losing more than 1 in 9 of the served reads trips it.
export const SERVE_RATE_MIN = Number(__ENV['FOOD_SERVE_RATE_MIN'] || 0.8);

// SC-005 verbatim: "The read API MUST sustain a high local-store serve throughput ... comfortably
// exceeding 5,000 served reads per hour." 5,000/hour = 1.389 served reads/second — the literal spec bar,
// asserted as an absolute floor so the number in the threshold is the number in the spec.
//
// BREACHABLE BY: total collapse of the read path — the service unresponsive, every connection in the
// pool blocked, or the container OOM-restarting mid-run. It is a LIVENESS bar, not a tight fit; the
// regression bar that actually bites is SUSTAIN_FRACTION below.
export const SERVED_READS_PER_SECOND_MIN = Number(__ENV['FOOD_SERVED_READS_PER_SECOND_MIN'] || 5000 / 3600);

// The offered arrival rate for the SC-005 throughput scenario, and the fraction of it the service must
// actually absorb. `constant-arrival-rate` keeps the OFFERED rate fixed regardless of how the service
// responds, so a service that cannot keep up shows up as k6 dropping iterations — which drags the
// achieved request rate below the offered rate. That is the honest way to state "sustained throughput":
// the bar is a function of the offered load, not a number the run can drift under unnoticed.
//
// The fraction is 0.85, not 1.0, because k6 computes a metric's `rate` over the WHOLE test duration
// including `gracefulStop`, so even a perfectly-keeping-up service measures slightly under the offered
// rate. 0.85 is loose enough to absorb that accounting and tight enough that real dropped iterations fail.
export const READ_ARRIVAL_RATE = Number(__ENV['FOOD_READ_ARRIVAL_RATE'] || 100);
export const SUSTAIN_FRACTION = Number(__ENV['FOOD_SUSTAIN_FRACTION'] || 0.85);

// SC-007 verbatim: "Food search queries against a local store of up to 50,000 foods MUST return results
// (canonical ids) within 250ms at p95, with a +/-15% tolerance" (owner ruling 2026-08-10; was 200ms,
// which was validated on a workstation rather than on CI-class hardware).
//
// ONE budget for EVERY query shape. There used to be a second, separately overridable
// `SEARCH_SHORT_P95_MS` beside this: it defaulted to the same 200ms, but it existed so the T-195
// short-query finding could be quantified without deleting the gate, and once T-198 fixed that finding it
// was a standing loophole — a knob whose only possible use is to raise one shape's bar above the success
// criterion it is named after. SC-007 grants no per-shape exemption, so neither does this file. Per-shape
// ATTRIBUTION is unaffected: it comes from the threshold's `{shape:…}` tag in `search.load.js`, not from a
// per-shape constant.
//
// BREACHABLE BY: `FoodSearchDao.search` ORs FOUR predicates — ranked FTS
// (`search_vector @@ plainto_tsquery`), trigram similarity (`name % query`) and two substring
// `ILIKE '%q%'` scans, plus the curated-alias tsvector U2 added — then ranks EVERY match by
// `GREATEST(ts_rank(search_vector), ts_rank(aliases_search_vector), similarity(name, query))` before
// applying `LIMIT 20`. So a broad query must score thousands of rows, and growth of the RESOLVED
// population moves this directly.
//
// ⛔ NOTHING here measures a query shorter than three characters any more (003-FR-010a, plan U37): below
// the minimum `FoodsService.search` returns an empty set without issuing a single statement and without
// either crosswalk read, so its latency is not search latency. The `short` shape that used to be budgeted
// here is DELETED rather than re-budgeted — timing a short-circuit would report the speed of doing no work
// as evidence that search is fast.
//
// `FoodsService.search` additionally issues TWO crosswalk lookups (barcode, then `external_key`) on every
// single search, so the endpoint is three queries, not one.
// OWNER RULING 2026-08-10: the budget is a TARGET of 250ms with an explicit ±15% tolerance, so the gate
// fails above 287.5ms. Encoded as target × (1 + tolerance) rather than a hardcoded 288 so the ruling stays
// legible and the tolerance is a stated allowance rather than a number nobody can explain.
//
// WHY IT MOVED, and why this is not goal-post-shifting. The original 200ms was SC-007 verbatim, and SC-007
// was validated on a developer workstation. CI runners measure this endpoint 2.5–3.8× slower: `narrow` is
// 68–105ms locally and 196.73 / 258.74 / 253.10ms across three CI runs; `phrase` 52–131ms locally and
// 152.41 / 185.20 / 206.29ms on CI. The distributions barely move between runs (`narrow` averages
// 145.6 / 156.4 / 154.2ms) — only the p95 tail crosses, so this was a marginal budget rather than a flake,
// and `narrow` passed its first CI run by 1.7% before failing the two after it. A p95 measured on shared,
// noisy-neighbour CI hardware needs a stated tolerance; the alternative is a gate that is red on hardware
// variance and therefore teaches everyone to ignore it.
//
// This does NOT license widening again. Raising the target, or the tolerance, without an owner ruling and a
// measurement is the goal-post-shifting three separate agents correctly refused today.
//
// OWNER RULING 2026-08-24: the budget is now a flat 500ms — "Less than 500ms is good for now."
// ⛔ THE TOLERANCE IS ZERO HERE, AND THAT IS NOT A REVOCATION of the general ±15% allowance (2026-08-12).
// The tolerance existed because 250ms was MARGINAL against a measured 145–158ms average: only the p95 tail
// crossed, so run-to-run variance decided the gate. 500ms against the same measurements is ~3x headroom,
// which absorbs that variance in the budget itself. Applying both would gate at 575ms and admit a p95 the
// ruling calls too slow. Encoded as tolerance 0 rather than by back-solving a 435ms target, so the number
// in this file is the number the owner said.
// ⚠️ This is the SECOND widening (200 → 250±15% → 500). It resolves the SC-007 breach by moving the bar,
// which is legitimate only because it is an owner ruling — but it does NOT make the fixture truthful. See
// the OPEN entry in `specs/003-usda-food-data/tasks.md`: the load fixture charges a MEDIAN query tail cost,
// and the real catalog's worst head term is broader than the fixture's uniform one. A benchmark measuring
// the wrong distribution will mislead the next decision too, at any ceiling.
export const SEARCH_P95_TARGET_MS = Number(__ENV['FOOD_SEARCH_P95_MS'] || 500);
export const SEARCH_P95_TOLERANCE = Number(__ENV['FOOD_SEARCH_P95_TOLERANCE'] || 0);
export const SEARCH_P95_MS = Math.round(SEARCH_P95_TARGET_MS * (1 + SEARCH_P95_TOLERANCE));

// --- Batch nutrition (plan U8) -------------------------------------------------------------------
//
// ⚠️ PROVENANCE IS DIFFERENT HERE, AND SAYING SO IS THE POINT. Every budget above quotes a numbered
// success criterion from `specs/003-usda-food-data/spec.md`. `GET /api/v1/foods/nutrition` has NO SC: it
// is a plan-U8 endpoint, and U8's stated verification is behavioural ("the recipe service can render a
// 20-recipe list with one call"), not a latency figure. So this budget is DERIVED rather than quoted, and
// it is a CEILING that has not yet been measured on CI hardware — read the derivation before tightening
// or widening it, and record the first CI numbers here the way SEARCH_P95_MS records its own history.

// The batch size the budget is stated at — U8's own worked example, a 20-recipe list served by one call.
export const NUTRITION_BATCH_IDS = Number(__ENV['FOOD_NUTRITION_BATCH_IDS'] || 20);

// THE DERIVATION. `FoodsService.getNutritionBatch` issues `ids.length` CONCURRENT `readGoldenRecord`
// calls through `Promise.all`, and each one of those is precisely the SC-001 read this file already
// budgets at READ_P95_MS (a `food` row fanned out over `food_sources`, `food_nutrients ⋈ nutrient`,
// `food_portions` and `food_field_provenance`). So `READ_P95_MS × NUTRITION_BATCH_IDS` is the line at
// which ONE BATCHED ID COSTS AS MUCH AS A WHOLE STANDALONE READ — i.e. the point where the endpoint has
// amortized nothing at all and a caller would be no worse off issuing the N separate requests it exists
// to replace. That makes the threshold a statement about the endpoint's REASON TO EXIST rather than an
// invented number, and it is why the script runs a single-read control scenario in the SAME contention
// window: the control's SC-001 threshold is what makes this one interpretable.
//
// BREACHABLE BY: the fan-out losing its concurrency (an `await` in a loop), the 20-connection `pg` pool
// saturating so the N reads serialize, `food_nutrients_food_id_idx` disappearing (each of the N reads
// then scans the value table), or the per-id read growing a query.
//
// ⛔ It is deliberately LOOSE, and must not be cited as evidence the endpoint is fast — only as evidence
// it is not a pessimization. Tightening it to a measured value is a follow-up, not a licence to widen.
export const NUTRITION_BATCH_P95_MS = Number(__ENV['FOOD_NUTRITION_BATCH_P95_MS'] || READ_P95_MS * NUTRITION_BATCH_IDS);

// p95 budget (ms) for the internal EdDSA-guarded erasure POST — a single indexed DELETE-by-requester with
// no async hand-off (CR-002/U4b). Tighter than recipe's because there is no SQS enqueue.
// BREACHABLE BY: `fetch_requesters` losing `idx_fetch_requesters_requester_id`, which turns the delete's
// row location into a scan of every queued food's requester rows.
export const ERASURE_P95_MS = Number(__ENV['FOOD_ERASURE_P95_MS'] || 500);

// --- Load shape ---------------------------------------------------------------------------------
// A single k6 runner cannot honestly generate a production-scale peak, so it is env-driven: CI runs a safe
// smoke value and a true validation supplies a high FOOD_LOAD_PEAK_VUS from a distributed / k6 Cloud run.
// The THRESHOLDS ARE IDENTICAL at every peak, so the pass/fail bar never changes with scale — only the
// sample count does.
export const PEAK_VUS = Number(__ENV['FOOD_LOAD_PEAK_VUS'] || 50);
export const RAMP_UP = __ENV['FOOD_LOAD_RAMP_UP'] || '30s';
export const HOLD = __ENV['FOOD_LOAD_HOLD'] || '1m';
export const RAMP_DOWN = __ENV['FOOD_LOAD_RAMP_DOWN'] || '15s';

// A ramping-vus stage set to the given peak. Shared by every scenario so load shape stays uniform.
export function rampStages(peak) {
    return [
        { duration: RAMP_UP, target: peak },
        { duration: HOLD, target: peak },
        { duration: RAMP_DOWN, target: 0 },
    ];
}

/** Parse a k6 duration string (`'90s'`, `'2m'`, `'1h'`) to seconds. Pure. */
function durationToSeconds(value) {
    const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(String(value).trim());

    if (!match) {
        throw new Error(`common.js: unsupported duration '${value}' (expected e.g. '30s', '2m')`);
    }

    const factor = { ms: 0.001, s: 1, m: 60, h: 3600 }[match[2]];

    return Number(match[1]) * factor;
}

/**
 * Total wall-clock length of {@link rampStages}, as a k6 duration string. A non-`ramping-vus` scenario
 * that must span the SAME window derives its duration from this instead of hardcoding one — otherwise
 * raising `FOOD_LOAD_HOLD` would silently leave it finishing early.
 */
export function totalRampDuration() {
    return `${Math.ceil(durationToSeconds(RAMP_UP) + durationToSeconds(HOLD) + durationToSeconds(RAMP_DOWN))}s`;
}

/**
 * Trend statistics every script reports. k6's DEFAULT set omits `p(99)`, which would leave the tail
 * invisible in both the terminal summary and the `--summary-export` artifact CI uploads — and a threshold
 * whose neighbouring percentile you cannot read turns a failure into a guess.
 */
export const SUMMARY_TREND_STATS = ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'];

// --- Generated fixtures -------------------------------------------------------------------------
//
// ⚠️ k6's `open()` resolves relative to the directory of the MODULE WHOSE CODE IS EXECUTING at the moment
// of the call — not the process cwd, and not (as this comment previously claimed) the entry script's
// directory unconditionally. The distinction only shows up in a helper module like this one, and it is
// exactly what decides `'./'` vs `'../'`. RE-MEASURED on k6 v0.54.0 (commit/baba871c8a), entry script at
// `load/entry.load.js`, helper at `load/lib/common.js`, probe files in both directories:
//
//   | call site                                       | `'./x'` resolves to | `'../x'` resolves to |
//   | ----------------------------------------------- | ------------------- | -------------------- |
//   | this helper's MODULE TOP LEVEL                   | `load/lib/x`        | `load/x`             |
//   | a function here CALLED from the entry's init     | `load/x`  ✅        | (one above `load/`)  |
//
// The loaders below are FUNCTIONS the entry scripts call, so they sit in the second row and `'./<name>'` is
// correct for a fixture beside the entry scripts, even though this file is one directory deeper. Do not
// "fix" these to `'../…'` to match the helper's own location, do not make them cwd-relative, and do not
// move an `open()` call to this module's top level without changing the prefix with it — the whole point is
// that `k6 run` works identically from the package directory and from the repo root.
//
// (The identity suite opens its pool at its helper's MODULE TOP LEVEL, i.e. the first row, so its correct
// default is `'../clerk-tokens.json'`. An earlier edit there copied the `'./'` from here on the strength of
// this comment's over-general rule and broke all four of its scripts at init. Both suites are right; they
// are not copies. Do not reconcile them to one prefix.)
//
// Both files are GENERATED and GITIGNORED, so they are NEVER present from a fresh checkout: the loaders
// below fail with an actionable message naming the prepare step rather than letting k6 report a bare
// `open() failed`. They are functions, not top-level constants, because `serviceErasure.load.js` also
// imports this module and must not require a Clerk pool it never uses.

const TOKENS_FILE = __ENV['FOOD_TOKENS_FILE'] || './clerk-tokens.json';
const FIXTURE_FILE = __ENV['FOOD_PERF_FIXTURE_FILE'] || './perf-fixture.json';

/**
 * Load the Clerk session-token pool minted by `prepareClerkTokens.ts`.
 *
 * Must be called from the INIT context (k6 forbids `open()` elsewhere).
 *
 * @returns `{ azp, ttlSeconds, users: string[] }`.
 */
export function loadTokens() {
    let raw;

    try {
        raw = open(TOKENS_FILE);
    } catch (error) {
        throw new Error(
            `common.js: cannot read the Clerk token pool at '${TOKENS_FILE}' (${error}). It is generated, ` +
                `gitignored credential material — run \`npm run test:load:tokens\` first, and boot the ` +
                `service under test with CLERK_JWT_KEY="$(cat tests/load/clerk-public-key.pem)".`,
            { cause: error },
        );
    }

    const pools = JSON.parse(raw);

    if (!Array.isArray(pools.users) || pools.users.length === 0) {
        throw new Error(`common.js: the token pool at '${TOKENS_FILE}' holds no tokens — re-mint it.`);
    }

    return pools;
}

/**
 * Load the store fixture emitted by `preparePerfFixture.ts`.
 *
 * Must be called from the INIT context. Validates every list the scripts index into is non-empty, so a
 * truncated or half-written fixture fails HERE instead of producing `undefined` in a URL — which the
 * service would answer `400` for, and a 400 is fast, so the run would report a flattering p95 for a
 * request that never touched the local store.
 *
 * @returns The parsed `perf-fixture.json`.
 */
export function loadFixture() {
    let raw;

    try {
        raw = open(FIXTURE_FILE);
    } catch (error) {
        throw new Error(
            `common.js: cannot read the store fixture at '${FIXTURE_FILE}' (${error}). Run ` +
                `\`DATABASE_URL=… npm run test:load:fixture\` first (it seeds the RESOLVED population these ` +
                `scripts read and emits the id/probe lists).`,
            { cause: error },
        );
    }

    const fixture = JSON.parse(raw);
    const required = ['resolvedIds', 'pendingIds', 'notFoundIds'];

    for (const key of required) {
        if (!Array.isArray(fixture[key]) || fixture[key].length === 0) {
            throw new Error(`common.js: fixture '${FIXTURE_FILE}' has no ${key} — re-run the prepare step.`);
        }
    }

    for (const key of Object.keys(fixture.search || {})) {
        if (!Array.isArray(fixture.search[key]) || fixture.search[key].length === 0) {
            throw new Error(`common.js: fixture '${FIXTURE_FILE}' has no search.${key} probes.`);
        }
    }

    return fixture;
}

/** Read-only headers (Bearer + Accept) for the given token. */
export function authHeaders(token) {
    return { Accept: 'application/json', Authorization: `Bearer ${token}` };
}

/**
 * The sign-in handles, so a bearer can be re-minted mid-run. Read at INIT — `open()` cannot be called
 * from a VU. Absent, the selectors below fall back to the static pool exactly as before.
 */
const SESSION_HANDLES = loadSessionHandles('FOOD_HANDLES_FILE');

/**
 * The bearer for this iteration, minted within the last 45 seconds.
 *
 * ⛔ RE-MINTED, NOT READ ONCE. A Clerk token lives 60 seconds and a leg runs 105, so a pool captured at
 * init is expired for the tail of every run — see `loadtest/k6/session.js` for the run that measured it.
 * `pool` remains the fallback for a run given tokens but no handles.
 */
export function forIteration(pool) {
    return freshBearer(SESSION_HANDLES, pool[exec.scenario.iterationInTest % pool.length]);
}

/**
 * Which profile this run measures — `substrate` (the calibrated runner-local machine) or `deployed`.
 *
 * ⛔ THE ONLY THING IT CHANGES IS WHICH THRESHOLDS ARE IN FORCE. Every latency budget in this suite was
 * calibrated against a dedicated container with its own Postgres and no rate limiter. A per-PR preview is
 * half a reclaimable vCPU on a database shared with every other open PR, so carrying those numbers across
 * yields a gate that reddens on the NEIGHBOURS' traffic — and the predictable next step is somebody
 * switching it off, which costs more than never having had it.
 */
export const LOAD_PROFILE = __ENV['LOAD_PROFILE'] || 'substrate';

/**
 * The given thresholds, in force ONLY on the substrate profile.
 *
 * ⛔ NOT an env-tunable budget set to a huge number on the deployed profile. That leaves a threshold that
 * LOOKS gated and can never fire — the coverage theatre `docs/CODING_STANDARDS.md` §7.1 forbids. The
 * de-gated metrics still appear in `summaryTrendStats`, so the numbers are produced and the trend is
 * readable; what is removed is the false claim that they are being enforced.
 *
 * @param thresholds - The latency thresholds to gate on a calibrated machine.
 * @returns The thresholds on `substrate`, an empty object on any other profile.
 */
export function whenSubstrate(thresholds) {
    return LOAD_PROFILE === 'substrate' ? thresholds : {};
}
