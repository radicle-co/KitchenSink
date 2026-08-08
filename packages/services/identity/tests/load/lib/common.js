// Shared configuration, load shape and token-pool loading for the identity-service k6 load suite.
//
// These modules are ES-module JavaScript executed by the **k6 binary** (`k6 run ...`) — they are NOT part
// of the vitest suite and must only import from k6's built-in modules (`k6`, `k6/http`, `k6/metrics`,
// `k6/data`). Those specifiers are resolved by k6 itself, never by npm. All target configuration is read
// from the environment via k6's `__ENV`.
//
// Mirrors `packages/services/recipe-service/tests/load/lib/common.js` and food's equivalent.

import exec from 'k6/execution';

// Base URL of the identity service under test (Nest app / shared ALB host). Defaults to the service's own
// configured PORT default (3001, per src/config/env.schema.ts) rather than 3000, so a bare local run finds it.
export const BASE_URL = (__ENV['IDENTITY_API_BASE_URL'] || 'http://localhost:3001').replace(/\/+$/, '');

// --- Performance budgets ------------------------------------------------------------------------
//
// PROVENANCE. Every number below traces to a written target or a mechanism in this repo — none is a round
// number picked for comfort, and each has a concrete way to be breached (stated per budget).
//
// The service's own targets are `specs/002-user-auth/plan.md` § "Performance Targets (NFR-011a)":
//   - Silent token refresh endpoint <= 500ms P99
//   - Profile data endpoint <= 1s P99
//   - Webhook processing <= 2s P99            (identity-webhooks' Lambda tier — out of scope here)
// plus SC-005 (profile page within 2s), SC-006 (100% of requests without a valid token get 401) and
// SC-007 (10,000 concurrent authenticated users, aligned to Commise SC-009). They were previously
// "asserted" only by `tests/perf/latency-perf.test.ts`, a vitest stub in the UNIT tier that compares
// constants to themselves under no load at all; these thresholds are what actually enforces them.
//
// The cross-service reference point is the recipe/food k6 suites: p95 <= 500ms for an indexed read or a
// single-row write (SC-009), < 2s for a full-text search.

// `GET /api/v1/users/me` — the profile read, and the platform's single hottest authenticated path.
// p95 500ms matches the recipe/food SC-009 read budget; p99 1000ms IS the plan's "Profile data endpoint
// <= 1s P99" verbatim. BREACHABLE BY: the route costs FOUR sequential DB round trips (the middleware's
// read-through join, then `UserDAO.findById`, `AccountDAO.findByUserId` and the profiles select), so
// connection-pool saturation (`pg` max: 20 per task), a lost index on `users.identity_id`, or one more
// await added to the chain all move it.
export const ME_P95_MS = Number(__ENV['IDENTITY_ME_P95_MS'] || 500);
export const ME_P99_MS = Number(__ENV['IDENTITY_ME_P99_MS'] || 1000);

// First-sight read-through provisioning: an unseen `sub`'s first authenticated request runs
// `provisionCompleteUser` — a transaction inserting users + accounts + profiles — before the route body.
// No written target covers it, so it is derived: the warm read budget (500ms) plus one write transaction
// budgeted like a recipe create (500ms) = 1000ms p95. BREACHABLE BY: lock contention on the users-row
// ordering (the deadlock-avoidance ordering in `deleteUserMe`/`provisionCompleteUser`), an index build on
// `users_email_unique`, or the transaction growing an extra statement.
export const PROVISION_P95_MS = Number(__ENV['IDENTITY_PROVISION_P95_MS'] || 1000);

// `PATCH /api/v1/users/me` — the rename write. p95 500ms, the SC-009 single-row write budget. BREACHABLE
// BY: the handle-sync SNS publish is `await`ed INSIDE the request (`users.service.ts`), so a slow or
// throttled topic directly inflates user-visible rename latency; also 1 select + 1 update + 2 selects.
export const RENAME_P95_MS = Number(__ENV['IDENTITY_RENAME_P95_MS'] || 500);

// `GET /api/v1/admin/users?email=…` — `ilike '%needle%'`, which a btree on `users.email` CANNOT serve, so
// the planner sequentially scans. 1000ms p95: tighter than recipe's 2s full-text search budget (this is a
// single-table filter, not a tsquery) and looser than the 500ms indexed-read budget (it is a scan).
// BREACHABLE BY: growth of the users table alone — the whole point of the budget is that it fails BEFORE
// an operator-facing admin search becomes unusable, rather than after.
export const ADMIN_SEARCH_P95_MS = Number(__ENV['IDENTITY_ADMIN_SEARCH_P95_MS'] || 1000);

// `GET /api/v1/admin/users?sub=…` — `eq(users.id, …)`, a primary-key probe. Held to the 500ms indexed-read
// budget. Its real job is CONTRAST: the same endpoint, the same table, the same load — one predicate
// index-served, one not. If this and ADMIN_SEARCH ever converge, the index stopped being used.
export const ADMIN_LOOKUP_P95_MS = Number(__ENV['IDENTITY_ADMIN_LOOKUP_P95_MS'] || 500);

// `GET /health/ready` while the service is saturated. `READINESS_PROBE_TIMEOUT_MS` (src/health/readiness.ts)
// is 2000ms, past which the probe REJECTS and the route answers 503 — and the ECS/ALB health checks
// (infra/lib/identity-service-stack.ts) use a 10s timeout on a 30s interval, so sustained 503s drain
// otherwise-healthy tasks. Budgeting p95 at HALF the probe timeout is the early-warning line: it fails
// while the probe is merely at risk, not after the ALB has already started cycling tasks. BREACHABLE BY:
// the probe shares the same 20-connection `pg` pool as request traffic, so pool exhaustion starves it.
export const READY_P95_MS = Number(__ENV['IDENTITY_READY_P95_MS'] || 1000);

// A rejected request (`401`). It must be CHEAPER than an authenticated read: signature verification with
// no DB work at all. Half the warm-read budget. BREACHABLE BY: any rejection path that reaches the
// database before failing closed — which is also the amplification risk that matters, since identity sits
// on a public internet-facing ALB and anyone can send it unlimited invalid bearers.
export const REJECT_P95_MS = Number(__ENV['IDENTITY_REJECT_P95_MS'] || 250);

// --- Load shape ---------------------------------------------------------------------------------
// SC-007 targets 10,000 concurrent authenticated users. A single k6 runner cannot honestly generate that,
// so the peak is env-driven: CI runs a safe smoke value and a true SC-007 validation supplies a high
// IDENTITY_LOAD_PEAK_VUS from a distributed / k6 Cloud execution. The THRESHOLDS ARE IDENTICAL at every
// peak, so the pass/fail bar never changes with scale — only the sample count does.
//
// The default 50 VUs with a 1s think-time is ~50 req/s per operation, which sits between the plan's Day-30
// capacity point (500 DAU, peak 50 req/s) and Day-90 (1,500 DAU, peak 200 req/s) — i.e. the smoke shape
// already exceeds the traffic identity is sized for today, on ONE task (the service scales 1→6).
export const PEAK_VUS = Number(__ENV['IDENTITY_LOAD_PEAK_VUS'] || 50);
export const RAMP_UP = __ENV['IDENTITY_LOAD_RAMP_UP'] || '30s';
export const HOLD = __ENV['IDENTITY_LOAD_HOLD'] || '1m';
export const RAMP_DOWN = __ENV['IDENTITY_LOAD_RAMP_DOWN'] || '15s';

/**
 * Trend statistics every script reports. k6's DEFAULT set omits `p(99)` — which would leave the profile
 * endpoint's p99 threshold (the plan's NFR-011a target) enforced but ABSENT from the terminal summary and
 * from the `--summary-export` artifact CI uploads. A threshold you cannot read the value of turns a
 * failure into a guess, so p99 is added explicitly.
 */
export const SUMMARY_TREND_STATS = ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'];

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
 * Total wall-clock length of {@link rampStages}, as a k6 duration string. A non-`ramping-vus` scenario that
 * must span the SAME window (the readiness prober) derives its duration from this instead of hardcoding
 * one — otherwise raising `IDENTITY_LOAD_HOLD` would silently leave the probe finishing early and the
 * hold-at-peak period unsampled, which is precisely the period it exists to observe.
 */
export function totalRampDuration() {
    return `${Math.ceil(durationToSeconds(RAMP_UP) + durationToSeconds(HOLD) + durationToSeconds(RAMP_DOWN))}s`;
}

// --- Token pool ---------------------------------------------------------------------------------
// Where `prepare-clerk-tokens.ts` wrote the pools.
//
// ⚠️ k6's `open()` resolves RELATIVE TO THE SCRIPT, not the process cwd. This module lives in
// `tests/load/lib/`, so the pool one directory up is `'../clerk-tokens.json'` — and that is correct
// whether k6 was invoked from the package directory or from the repo root. Do not "fix" it to a
// cwd-relative path.
const TOKENS_FILE = __ENV['IDENTITY_TOKENS_FILE'] || '../clerk-tokens.json';

// Parsed ONCE in the init context. Every scenario imports from here, so the file is opened exactly once
// per run regardless of how many scripts share it.
export const TOKENS = JSON.parse(open(TOKENS_FILE));

/** Read-only headers (Bearer + Accept) for the given token. */
export function authHeaders(token, extra) {
    const headers = { Accept: 'application/json' };
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    return Object.assign(headers, extra || {});
}

/** Write headers (adds JSON content-type). */
export function jsonHeaders(token) {
    return authHeaders(token, { 'Content-Type': 'application/json' });
}

/**
 * The warm token for the current iteration, rotated by `exec.scenario.iterationInTest`.
 *
 * WHY NOT `__VU`. The obvious form is VU-to-user affinity (`pool[(__VU - 1) % pool.length]`), and it is
 * WRONG here: `__VU` is the VU's id ACROSS THE WHOLE TEST, not within its scenario. A script with two
 * scenarios (every script in this suite has two) hands the second scenario a block of high ids — e.g.
 * 51..75 for a 25-VU scenario running beside a 50-VU one — so `% pool.length` silently maps two different
 * scenarios' VUs onto the SAME warm user. Two concurrent writers on one profile row then break
 * `patchUserMe`'s non-transactional read-after-write and produce inexplicable ~0.1% check failures.
 *
 * `iterationInTest` is unique and monotonic PER SCENARIO across all its VUs, so consecutive in-flight
 * iterations get consecutive users. Distinctness of concurrent iterations therefore holds as long as a
 * scenario's peak VU count is below the pool size — which `prepare-db.ts` asserts
 * (`IDENTITY_WARM_POOL_SIZE >= IDENTITY_LOAD_PEAK_VUS`) rather than leaving to chance.
 */
export function warmTokenForIteration(pool) {
    return pool[exec.scenario.iterationInTest % pool.length];
}
