/**
 * U4 (FR-1/FR-2/FR-4/SC-hold) — the food-API load-test journey.
 *
 * Each VU iteration runs the realistic user journey against the deployed food service:
 *   search a varied corpus query  ->  add-by-name (POST /api/v1/foods)  ->  poll status to a terminal
 * lifecycle state (or a bounded timeout), with think-time between steps. VU `i` authenticates as a
 * distinct Clerk user `i` from a pre-minted pool (see auth/provision-users.mjs), so the load looks like
 * N distinct users, not one.
 *
 * CORRECTNESS INVARIANTS (each learned from an adversarial review — do not regress):
 *   1. Tokens are ~60s-lived. A k6 SharedArray is loaded ONCE at init and can never receive a
 *      disk-refresh, so each VU refreshes ITS OWN token in-iteration (proactively, before expiry) via
 *      FAPI. `REFRESH_AFTER_S` must be < TTL - max-iteration-duration so a token minted at iteration
 *      start stays valid through the whole (up to ~POLL_TIMEOUT_S) iteration.
 *   2. Latency Trends record ONLY the success status (200 search / 202 add). Recording a fast 401/503
 *      rejection would DEFLATE p95 and make a failing service look healthy.
 *   3. Failure classes are RATES over requests, not absolute counts: unexpected-5xx and auth-401 each
 *      threshold as a fraction, so the bar is volume-independent. A non-trivial 401 rate fails the run
 *      loudly (it means tokens expired and any shed-503s are a harness artifact, not real backpressure).
 *   4. `dropped_iterations` is thresholded so silent VU starvation (arrival rate never delivered because
 *      maxVUs < rate x iteration-duration) fails the run instead of quietly under-loading.
 *   5. The pool must have >= MAX_VUS tokens or the distinct-user invariant breaks under scale-up
 *      (setup() asserts this).
 *
 * Run:  k6 run --env FOOD_BASE_URL="$(node printPublicOrigin.mjs food pr-73 commise.app)" journey.js
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';
import { Counter, Rate, Trend } from 'k6/metrics';

// ── Config (env with safe smoke-run defaults) ───────────────────────────────────────────────────────
const BASE_URL = (__ENV.FOOD_BASE_URL || '').replace(/\/$/, '');
const POOL_FILE = __ENV.POOL_FILE || './pool.json';
const CORPUS_FILE = __ENV.CORPUS_FILE || './corpus/food-queries.json';

// Token refresh (invariant #1). Two pool shapes: a FAPI entry carries {devJwt, cookie} and refreshes via
// the Frontend API; a Backend entry carries just {sessionId} and refreshes via the Backend API — no FAPI,
// so no per-IP sign-in throttle. The backend path needs CLERK_SECRET_KEY in __ENV (the harness passes it;
// sk_test_, dev instance only). Which path is used is decided per-entry by whether it has a cookie.
const FAPI = (__ENV.FAPI || 'https://nice-fowl-6.clerk.accounts.dev').replace(/\/$/, '');
const ORIGIN = __ENV.ORIGIN || 'https://sandbox.commise.app';
const CLERK_SK = __ENV.CLERK_SECRET_KEY || '';
const BAPI = 'https://api.clerk.com/v1';
const REFRESH_AFTER_S = Number(__ENV.REFRESH_AFTER_S || 20);

const THINK_MIN_S = Number(__ENV.THINK_MIN_S || 0.5);
const THINK_MAX_S = Number(__ENV.THINK_MAX_S || 2);
const POLL_INTERVAL_S = Number(__ENV.POLL_INTERVAL_S || 2);
const POLL_TIMEOUT_S = Number(__ENV.POLL_TIMEOUT_S || 20);
// When a food reaches a terminal state, read the USDA-sourced data back from the DB to prove it actually
// persisted (not just that a status flag flipped). On by default; set VERIFY_PERSISTENCE=0 for pure-load.
const VERIFY_PERSISTENCE = (__ENV.VERIFY_PERSISTENCE ?? '1') !== '0';

// Staged arrival-rate profile (req/s per stage). Defaults are a modest real run; tune per target.
const BASELINE_RATE = Number(__ENV.BASELINE_RATE || 1);
const BASELINE_DURATION = __ENV.BASELINE_DURATION || '30s';
const HOLD_RATE = Number(__ENV.HOLD_RATE || 2);
const HOLD_DURATION = __ENV.HOLD_DURATION || '1m';
const RAMP_RATE = Number(__ENV.RAMP_RATE || 3);
const RAMP_DURATION = __ENV.RAMP_DURATION || '1m';
// maxVUs must cover peakRate x maxIterationDuration or k6 drops iterations (invariant #4). Sized for
// RAMP_RATE=3/s x ~(POLL_TIMEOUT_S + 2*THINK_MAX) ~= 24s ~= 72, rounded up. POOL_SIZE must be >= MAX_VUS.
const PRE_ALLOCATED_VUS = Number(__ENV.PRE_ALLOCATED_VUS || 30);
const MAX_VUS = Number(__ENV.MAX_VUS || 100);

// k6's arrival-rate `rate`/`target` are int64 — a fractional req/s (e.g. 0.3, handy for a small pool)
// is rejected. Pick the smallest timeUnit (seconds) that turns every configured rate into a whole count,
// then express rates over that unit. 0.3/s → rate 3 per 10s = same arrival rate, but integer-valued.
function rateUnitSeconds(rates) {
    for (const unit of [1, 2, 4, 5, 10, 20, 60]) {
        if (rates.every((r) => Math.abs(r * unit - Math.round(r * unit)) < 1e-9)) {
            return unit;
        }
    }
    return 60; // fall back; the Math.round below absorbs any residual fraction
}
const RATE_UNIT_S = rateUnitSeconds([BASELINE_RATE, HOLD_RATE, RAMP_RATE]);
const perUnit = (rate) => Math.max(0, Math.round(rate * RATE_UNIT_S));

// SC-hold pass bars (tunable; final numbers set at run time).
const THRESH_SEARCH_P95_MS = __ENV.THRESH_SEARCH_P95_MS || '800';
const THRESH_ADD_P95_MS = __ENV.THRESH_ADD_P95_MS || '1500';
const THRESH_UNEXPECTED_5XX_RATE = __ENV.THRESH_UNEXPECTED_5XX_RATE || '0.01';
const THRESH_AUTH_FAIL_RATE = __ENV.THRESH_AUTH_FAIL_RATE || '0.005';
const THRESH_DROPPED = __ENV.THRESH_DROPPED || '50';

const TERMINAL_STATES = ['RESOLVED', 'UNRESOLVED', 'NOT_FOUND', 'FAILED'];

// ── Init-context data ───────────────────────────────────────────────────────────────────────────────
const corpus = new SharedArray('corpus', () => {
    const parsed = JSON.parse(open(CORPUS_FILE));
    const list = Array.isArray(parsed) ? parsed : parsed.queries;

    if (!Array.isArray(list) || list.length === 0) {
        throw new Error(`Corpus ${CORPUS_FILE} has no queries`);
    }

    return list;
});

// ── Custom metrics ──────────────────────────────────────────────────────────────────────────────────
const searchLatency = new Trend('food_search_latency', true); // 200s only (invariant #2)
const addAcceptLatency = new Trend('food_add_accept_latency', true); // 202s only
const pollToTerminal = new Trend('food_poll_to_terminal', true);
const reachedTerminal = new Rate('food_reached_terminal');
const statusMix = new Counter('food_terminal_status'); // tagged by {status}
const shed503 = new Counter('food_auth_shed_503'); // AuthLoadShedder graceful backpressure (FR-052)
const unexpected5xx = new Rate('food_unexpected_5xx'); // fraction of food requests that 5xx'd (not shed)
const authFail = new Rate('food_auth_fail'); // fraction that 401'd — should be ~0 (invariant #3)
const tokenRefreshFail = new Counter('food_token_refresh_fail');
// Of foods that reached a terminal state, the fraction whose USDA data is actually readable from the DB
// (candidate set for UNRESOLVED, golden record for RESOLVED). A gap means the sync→DB write is broken.
const dataPersisted = new Rate('food_data_persisted');

export const options = {
    scenarios: {
        journey: {
            executor: 'ramping-arrival-rate',
            startRate: perUnit(BASELINE_RATE),
            timeUnit: `${RATE_UNIT_S}s`,
            // k6 rejects preAllocatedVUs > maxVUs; clamp so a small MAX_VUS can't produce a config error.
            preAllocatedVUs: Math.min(PRE_ALLOCATED_VUS, MAX_VUS),
            maxVUs: MAX_VUS,
            stages: [
                { target: perUnit(BASELINE_RATE), duration: BASELINE_DURATION },
                { target: perUnit(HOLD_RATE), duration: '15s' },
                { target: perUnit(HOLD_RATE), duration: HOLD_DURATION },
                { target: perUnit(RAMP_RATE), duration: RAMP_DURATION },
                { target: 0, duration: '15s' },
            ],
        },
    },
    thresholds: {
        food_search_latency: [`p(95)<${THRESH_SEARCH_P95_MS}`],
        food_add_accept_latency: [`p(95)<${THRESH_ADD_P95_MS}`],
        food_unexpected_5xx: [`rate<${THRESH_UNEXPECTED_5XX_RATE}`],
        // Non-zero auth failures mean tokens expired → the whole run (incl. any shed-503s) is suspect.
        food_auth_fail: [`rate<${THRESH_AUTH_FAIL_RATE}`],
        // Terminal foods must have their USDA data in the DB — a persistence gap fails the run.
        food_data_persisted: [`rate>${__ENV.THRESH_DATA_PERSISTED || '0.99'}`],
        // Silent VU starvation: the requested arrival rate was not actually delivered.
        dropped_iterations: [`count<${THRESH_DROPPED}`],
    },
};

// ── Per-VU token state (module scope = per-VU instance) ─────────────────────────────────────────────
let handle = null; // this VU's { userId, sessionId, devJwt, cookie, jwt }
let token = null;
let mintedAt = 0;

/**
 * Refresh this VU's session token when it is older than REFRESH_AFTER_S (invariant #1).
 *
 * ⛔ DELIBERATELY NOT `k6/session.js`'s `freshBearer`, which does the same thing for the service tiers.
 * The two diverge on four axes and each divergence is a decision — see that module's header for the full
 * argument. The two that matter most here: this one accepts a BACKEND-API pool entry, which `session.js`
 * is guaranteed never to do, and this one KEEPS a stale token on a failed re-mint so the iteration
 * finishes and `food_token_refresh_fail` carries the verdict, where `session.js` throws. Sharing an
 * implementation would need a flag for each, and the first of those flags re-opens sign-in.
 */
function freshToken() {
    if (token && Date.now() - mintedAt < REFRESH_AFTER_S * 1000) {
        return token;
    }

    let res;

    if (handle.cookie) {
        // FAPI pool entry: refresh via the Frontend API with the dev-browser + session cookie.
        const q = `__clerk_db_jwt=${encodeURIComponent(handle.devJwt)}`;
        res = http.post(`${FAPI}/v1/client/sessions/${handle.sessionId}/tokens?${q}`, null, {
            headers: { Origin: ORIGIN, Cookie: handle.cookie },
            tags: { step: 'token-refresh' },
        });
    } else {
        // Backend pool entry: refresh via the Backend API (sk_test_) — no FAPI, no per-IP throttle.
        // Content-Type is required (Clerk 415s a bodyless POST without it).
        res = http.post(`${BAPI}/sessions/${handle.sessionId}/tokens`, null, {
            headers: { Authorization: `Bearer ${CLERK_SK}`, 'Content-Type': 'application/json' },
            tags: { step: 'token-refresh' },
        });
    }

    const jwt = res.status === 200 ? res.json('jwt') : null;

    if (jwt) {
        token = jwt;
        mintedAt = Date.now();
    } else {
        // Keep the old token; the resulting 401s will trip the food_auth_fail threshold (fail loud).
        tokenRefreshFail.add(1);
    }

    return token;
}

function thinkTime() {
    sleep(THINK_MIN_S + Math.random() * (THINK_MAX_S - THINK_MIN_S));
}

/** Pick a corpus query spread across (VU, iter) with a per-VU prime offset + wrap-around (FR-2). */
function pickQuery() {
    return corpus[(__VU * 31 + __ITER * 7) % corpus.length];
}

/**
 * Record failure-class rates for a food request and return whether it succeeded (== okStatus). Latency
 * is recorded by the caller ONLY on success (invariant #2), so this never touches latency Trends.
 */
function gate(res, step, okStatus) {
    const is401 = res.status === 401;
    const isShed = res.status === 503;
    const is5xx = res.status >= 500 && res.status !== 503;

    authFail.add(is401, { step });
    unexpected5xx.add(is5xx, { step });

    if (isShed) {
        shed503.add(1, { step });
    }

    return res.status === okStatus;
}

// The pool is loaded in the INIT context — `open()` is init-only (not allowed in setup()). A SharedArray
// is safe here: userId/sessionId are stable; only the ~60s token is refreshed in-VU (freshToken), never
// from this array.
const pool = new SharedArray('pool', () => {
    const parsed = JSON.parse(open(POOL_FILE));
    const list = Array.isArray(parsed) ? parsed : parsed.pool;

    if (!Array.isArray(list) || list.length === 0) {
        throw new Error(
            `Pool ${POOL_FILE} is empty — run \`npm run provision:pool\` (or auth/provision-users.mjs) first`,
        );
    }

    return list;
});

export function setup() {
    // ⛔ No target, no run — never a green run against a default host that no longer exists.
    if (!BASE_URL) {
        throw new Error(
            'FOOD_BASE_URL is required — resolve it with `node printPublicOrigin.mjs food <stage> <apex>`. ' +
                'It used to default to a typed host that stopped resolving when that PR closed.',
        );
    }

    // Distinct-user invariant (invariant #5): every concurrent VU needs its own user.
    if (pool.length < MAX_VUS) {
        throw new Error(
            `Pool has ${pool.length} users but MAX_VUS=${MAX_VUS}; provision POOL_SIZE >= MAX_VUS so VUs do not share Clerk users.`,
        );
    }

    return {};
}

export default function () {
    if (!handle) {
        handle = pool[(__VU - 1) % pool.length];
        token = null; // force a fresh mint on first use regardless of how stale the pooled jwt is
        mintedAt = 0;
    }

    const jwt = freshToken();
    const auth = { headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' } };

    // 1. Search.
    const searchRes = http.get(`${BASE_URL}/api/v1/foods/search?query=${encodeURIComponent(pickQuery())}`, {
        ...auth,
        tags: { step: 'search' },
    });
    const searchOk = gate(searchRes, 'search', 200);
    check(searchRes, { 'search 200': () => searchOk });

    if (searchOk) {
        searchLatency.add(searchRes.timings.duration);
    } else {
        return;
    }

    thinkTime();

    // 2. Add by name (202 + id).
    const q = pickQuery();
    const addRes = http.post(`${BASE_URL}/api/v1/foods`, JSON.stringify({ name: q }), {
        ...auth,
        tags: { step: 'add' },
    });
    const addOk = gate(addRes, 'add', 202);
    check(addRes, { 'add 202': () => addOk });

    if (addOk) {
        addAcceptLatency.add(addRes.timings.duration);
    } else {
        return;
    }

    const foodId = addRes.json('id');

    if (!foodId) {
        // A 202 with no `id` is malformed server behavior — record it as a non-terminal outcome so it is
        // not silently dropped (which would bias the reached-terminal rate upward).
        reachedTerminal.add(false);
        check(addRes, { 'add returned id': () => false });

        return;
    }

    thinkTime();

    // 3. Poll status to a terminal state or a bounded timeout (PENDING is expected under a throttle-bound
    //    backlog — the terminal-reached rate + status mix are the degradation signal).
    const startedAt = Date.now();
    let terminal = null;

    while ((Date.now() - startedAt) / 1000 < POLL_TIMEOUT_S) {
        const statusRes = http.get(`${BASE_URL}/api/v1/foods/${foodId}/status`, { ...auth, tags: { step: 'poll' } });

        if (!gate(statusRes, 'poll', 200)) {
            break; // shed/5xx/401 — stop polling this item
        }

        const status = statusRes.json('status');

        if (TERMINAL_STATES.indexOf(status) !== -1) {
            terminal = status;
            break;
        }

        sleep(POLL_INTERVAL_S);
    }

    if (terminal) {
        pollToTerminal.add(Date.now() - startedAt);
        statusMix.add(1, { status: terminal });
        reachedTerminal.add(true);

        // Read the USDA data back from the DB to confirm it persisted (not just a status flip). UNRESOLVED
        // keeps its candidate set (food_candidates); RESOLVED materializes a golden record (foods). Only
        // these two states carry persisted USDA data — NOT_FOUND (no match) / FAILED (fetch error) do not.
        if (VERIFY_PERSISTENCE && (terminal === 'UNRESOLVED' || terminal === 'RESOLVED')) {
            let persisted = false;

            if (terminal === 'UNRESOLVED') {
                const candRes = http.get(`${BASE_URL}/api/v1/foods/${foodId}/candidates`, {
                    ...auth,
                    tags: { step: 'candidates' },
                });
                const body = candRes.status === 200 ? candRes.json() : null;
                const list = body?.candidates ?? body?.items ?? body?.results ?? (Array.isArray(body) ? body : []);
                persisted = Array.isArray(list) && list.length > 0;
            } else {
                const detailRes = http.get(`${BASE_URL}/api/v1/foods/${foodId}`, { ...auth, tags: { step: 'detail' } });
                persisted = detailRes.status === 200 && Boolean(detailRes.json('id'));
            }

            dataPersisted.add(persisted);
            check(persisted, { 'usda data persisted in DB': (ok) => ok === true });
        }
    } else {
        reachedTerminal.add(false);
    }
}
