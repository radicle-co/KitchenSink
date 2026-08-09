// Shared configuration, performance budgets and load-shape helpers for the food-service k6 load suite.
//
// These modules are ES-module JavaScript executed by the **k6 binary** (`k6 run ...`) — they are NOT part
// of the vitest suite and must only import from k6's built-in modules (`k6`, `k6/http`, `k6/metrics`,
// `k6/data`, `k6/execution`). Those specifiers are resolved by k6 itself, never by npm. All target and
// credential configuration is read from the environment via k6's `__ENV`.
//
// Mirrors `packages/services/recipe-service/tests/load/lib/common.js` and identity's equivalent.

import exec from 'k6/execution';

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
//   SC-007  search against <= 50,000 foods       <= 200ms p95
//
// SC-003 is NOT measurable by k6 (it spans the Fargate fan-out worker and a source HTTP call, which this
// suite must not make). Its DB-side component — the drain claim that the FR-046 ceiling stresses — is
// measured by `../drain-demotion.perf.ts`, which owns that budget and its derivation.

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
// (canonical ids) within 200ms at p95."
//
// ONE budget for EVERY query shape, short ones included. There used to be a second, separately
// overridable `SEARCH_SHORT_P95_MS` beside this: it defaulted to the same 200ms, but it existed so the
// T-195 short-query finding could be quantified without deleting the gate, and once T-198 fixed that
// finding it was a standing loophole — a knob whose only possible use is to raise the short shape's bar
// above the success criterion it is named after. SC-007 grants no per-shape exemption, so neither does
// this file. Per-shape ATTRIBUTION is unaffected: it comes from the threshold's `{shape:…}` tag in
// `search.load.js`, not from a per-shape constant.
//
// BREACHABLE BY, at 3+ characters: `FoodSearchDao.search` ORs FOUR predicates — ranked FTS
// (`search_vector @@ plainto_tsquery`), trigram similarity (`name % query`) and two substring
// `ILIKE '%q%'` scans — then ranks EVERY match by `GREATEST(ts_rank, similarity(name, query))` before
// applying `LIMIT 20`. So a broad query must score thousands of rows, and growth of the RESOLVED
// population moves this directly.
//
// BREACHABLE BY, at 1–2 characters (the `short` shape): that statement is not used at all — T-198 routes
// short queries to `search_vector @@ to_tsquery('simple', '<token>:*')` over `food_search_vector_idx`,
// measured at 3.9–15.1ms where the old statement sequentially scanned at 125–157ms. What breaches THIS is
// losing that index, or the routing being reverted so the `ILIKE` branches run below 3 characters again.
// The revert is caught deterministically on every PR by the DAO's unit + integration suites; k6 is the
// only tier that catches the dropped index, because that symptom is time rather than statement shape.
//
// `FoodsService.search` additionally issues TWO crosswalk lookups (barcode, then `external_key`) on every
// single search, so the endpoint is three queries, not one.
export const SEARCH_P95_MS = Number(__ENV['FOOD_SEARCH_P95_MS'] || 200);

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
// `open() failed`. They are functions, not top-level constants, because `service-erasure.load.js` also
// imports this module and must not require a Clerk pool it never uses.

const TOKENS_FILE = __ENV['FOOD_TOKENS_FILE'] || './clerk-tokens.json';
const FIXTURE_FILE = __ENV['FOOD_PERF_FIXTURE_FILE'] || './perf-fixture.json';

/**
 * Load the Clerk session-token pool minted by `prepare-clerk-tokens.ts`.
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
        );
    }

    const pools = JSON.parse(raw);

    if (!Array.isArray(pools.users) || pools.users.length === 0) {
        throw new Error(`common.js: the token pool at '${TOKENS_FILE}' holds no tokens — re-mint it.`);
    }

    return pools;
}

/**
 * Load the store fixture emitted by `prepare-perf-fixture.ts`.
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
 * The pool entry for the current iteration, rotated by `exec.scenario.iterationInTest`.
 *
 * WHY NOT `__VU`. The obvious form is VU affinity (`pool[(__VU - 1) % pool.length]`), and it is WRONG for
 * a multi-scenario script: `__VU` is the VU's id ACROSS THE WHOLE TEST, not within its scenario, so the
 * second scenario is handed a block of high ids and `% pool.length` silently maps two scenarios onto the
 * same pool entry. `iterationInTest` is unique and monotonic PER SCENARIO across all its VUs, so
 * consecutive in-flight iterations get consecutive entries. (Identity's suite records the concrete bug
 * this caused; the same trap applies here.)
 */
export function forIteration(pool) {
    return pool[exec.scenario.iterationInTest % pool.length];
}
