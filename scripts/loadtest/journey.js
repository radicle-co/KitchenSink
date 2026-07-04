/**
 * U4 (FR-1/FR-2/FR-4/SC-hold) — the food-API load-test journey.
 *
 * Each VU iteration runs the realistic user journey against the deployed food service:
 *   search a varied corpus query  ->  add-by-name (POST /v1/foods)  ->  poll status to a terminal
 * lifecycle state (or a bounded timeout), with think-time between steps. VU `i` authenticates with
 * token `i` from a pre-minted pool (distinct Clerk users — see auth/provision-users.mjs), so the load
 * looks like N distinct users, not one.
 *
 * The scenario stages (baseline -> hold-at-target -> over-ramp) and the SC-hold pass thresholds are all
 * driven from env (see config.example.env) so the same script runs a smoke, a hold, and a saturation
 * ramp. Custom metrics separate each step's latency and the terminal status mix, and tag auth
 * load-shedder 503s distinctly from other 5xx.
 *
 * Run:  k6 run --env FOOD_BASE_URL=https://food-pr-59.commise.app journey.js
 *       (tokens.json + corpus loaded at init; see README.md)
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';
import { Counter, Rate, Trend } from 'k6/metrics';

// ── Config (env with safe smoke-run defaults) ───────────────────────────────────────────────────────
const BASE_URL = (__ENV.FOOD_BASE_URL || 'https://food-pr-59.commise.app').replace(/\/$/, '');
const TOKENS_FILE = __ENV.TOKENS_FILE || './tokens.json';
const CORPUS_FILE = __ENV.CORPUS_FILE || './corpus/food-queries.json';

const THINK_MIN_S = Number(__ENV.THINK_MIN_S || 0.5);
const THINK_MAX_S = Number(__ENV.THINK_MAX_S || 2);
const POLL_INTERVAL_S = Number(__ENV.POLL_INTERVAL_S || 2);
const POLL_TIMEOUT_S = Number(__ENV.POLL_TIMEOUT_S || 30);

// Staged arrival-rate profile (req/s per stage). Defaults are a gentle smoke; real hold/ramp come from env.
const BASELINE_RATE = Number(__ENV.BASELINE_RATE || 1);
const BASELINE_DURATION = __ENV.BASELINE_DURATION || '30s';
const HOLD_RATE = Number(__ENV.HOLD_RATE || 2);
const HOLD_DURATION = __ENV.HOLD_DURATION || '1m';
const RAMP_RATE = Number(__ENV.RAMP_RATE || 5);
const RAMP_DURATION = __ENV.RAMP_DURATION || '1m';
const PRE_ALLOCATED_VUS = Number(__ENV.PRE_ALLOCATED_VUS || 20);
const MAX_VUS = Number(__ENV.MAX_VUS || 100);

// SC-hold pass bar (tunable; final numbers set at run time).
const THRESH_SEARCH_P95_MS = __ENV.THRESH_SEARCH_P95_MS || '800';
const THRESH_ADD_P95_MS = __ENV.THRESH_ADD_P95_MS || '1500';
const THRESH_UNEXPECTED_5XX_RATE = __ENV.THRESH_UNEXPECTED_5XX_RATE || '0.01';

const TERMINAL_STATES = ['RESOLVED', 'UNRESOLVED', 'NOT_FOUND', 'FAILED'];

// ── Init-context data (loaded once, shared across VUs) ──────────────────────────────────────────────
const corpus = new SharedArray('corpus', () => {
    const parsed = JSON.parse(open(CORPUS_FILE));
    const list = Array.isArray(parsed) ? parsed : parsed.queries;

    if (!Array.isArray(list) || list.length === 0) {
        throw new Error(`Corpus ${CORPUS_FILE} has no queries`);
    }

    return list;
});

const tokens = new SharedArray('tokens', () => {
    const parsed = JSON.parse(open(TOKENS_FILE));
    const list = Array.isArray(parsed) ? parsed : parsed.tokens;

    if (!Array.isArray(list) || list.length === 0) {
        throw new Error(`Token pool ${TOKENS_FILE} is empty — run auth/provision-users.mjs first`);
    }

    return list;
});

// ── Custom metrics ──────────────────────────────────────────────────────────────────────────────────
const searchLatency = new Trend('food_search_latency', true);
const addAcceptLatency = new Trend('food_add_accept_latency', true);
const pollToTerminal = new Trend('food_poll_to_terminal', true);
const reachedTerminal = new Rate('food_reached_terminal'); // share of adds that hit a terminal state within POLL_TIMEOUT
const statusMix = new Counter('food_terminal_status'); // tagged by {status}
const shedder503 = new Counter('food_auth_shed_503'); // AuthLoadShedder sheds (FR-052)
const unexpected5xx = new Counter('food_unexpected_5xx');

export const options = {
    scenarios: {
        journey: {
            executor: 'ramping-arrival-rate',
            startRate: BASELINE_RATE,
            timeUnit: '1s',
            preAllocatedVUs: PRE_ALLOCATED_VUS,
            maxVUs: MAX_VUS,
            stages: [
                { target: BASELINE_RATE, duration: BASELINE_DURATION },
                { target: HOLD_RATE, duration: '15s' },
                { target: HOLD_RATE, duration: HOLD_DURATION },
                { target: RAMP_RATE, duration: RAMP_DURATION },
                { target: 0, duration: '15s' },
            ],
        },
    },
    thresholds: {
        // SC-hold: reads stay fast, adds accept fast, and unexpected 5xx stay under the cap. Shed 503s are
        // tracked separately (they are graceful backpressure, not a failure of the service).
        food_search_latency: [`p(95)<${THRESH_SEARCH_P95_MS}`],
        food_add_accept_latency: [`p(95)<${THRESH_ADD_P95_MS}`],
        food_unexpected_5xx: [`count<${Math.ceil(Number(THRESH_UNEXPECTED_5XX_RATE) * 100000)}`],
        // Non-shed request failures should be rare.
        'http_req_failed{expected_response:true}': ['rate<0.05'],
    },
};

function thinkTime() {
    sleep(THINK_MIN_S + Math.random() * (THINK_MAX_S - THINK_MIN_S));
}

/** Pick a corpus query spread across (VU, iter) with a per-VU prime offset + wrap-around (FR-2). */
function pickQuery() {
    const idx = (__VU * 31 + __ITER * 7) % corpus.length;

    return corpus[idx];
}

function authHeaders() {
    // VU i -> token i (1-indexed VUs), wrapping if the pool is smaller than the VU count.
    const token = tokens[(__VU - 1) % tokens.length];

    return { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } };
}

/** Classify a response: shed 503 (backpressure) vs unexpected 5xx vs ok. Returns true if the step should continue. */
function classify(res, step) {
    if (res.status === 503) {
        shedder503.add(1, { step });

        return false;
    }

    if (res.status >= 500) {
        unexpected5xx.add(1, { step });

        return false;
    }

    return true;
}

export default function () {
    const auth = authHeaders();

    // 1. Search a varied corpus query.
    const query = pickQuery();
    const searchRes = http.get(`${BASE_URL}/v1/foods/search?query=${encodeURIComponent(query)}`, {
        ...auth,
        tags: { step: 'search' },
    });
    searchLatency.add(searchRes.timings.duration);
    check(searchRes, { 'search 200': (r) => r.status === 200 });

    if (!classify(searchRes, 'search')) {
        return;
    }

    thinkTime();

    // 2. Add by name (202 + id).
    const addRes = http.post(`${BASE_URL}/v1/foods`, JSON.stringify({ name: query }), {
        ...auth,
        tags: { step: 'add' },
    });
    addAcceptLatency.add(addRes.timings.duration);
    check(addRes, { 'add 202': (r) => r.status === 202 });

    if (!classify(addRes, 'add')) {
        return;
    }

    const addBody = addRes.json();
    const foodId = addBody && addBody.id;

    if (!foodId) {
        return;
    }

    thinkTime();

    // 3. Poll status to a terminal state or a bounded timeout (adds are throttle-bound, so PENDING is
    //    expected under load — the terminal-reached rate + status mix are the degradation signal).
    const startedAt = Date.now();
    let terminal = null;

    while ((Date.now() - startedAt) / 1000 < POLL_TIMEOUT_S) {
        const statusRes = http.get(`${BASE_URL}/v1/foods/${foodId}/status`, { ...auth, tags: { step: 'poll' } });

        if (!classify(statusRes, 'poll')) {
            break;
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
    } else {
        reachedTerminal.add(false); // still PENDING at timeout (throttle-bound backlog)
    }
}
