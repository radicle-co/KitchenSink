// Service-principal account-erasure load scenario (CR-002 / U4b — food's internal machine-auth route).
//
// The food mirror of recipe-service's `service-erasure.load.js`. Exercises `POST /v1/internal/account/erasure`,
// guarded NOT by Clerk but by a single-target EdDSA service token pinning the FOOD audience
// (`FoodServiceErasureGuard`). Two ramping-vus scenarios run together:
//   - `erase`  — presents a VALID single-target token (bound to a distinct synthetic, non-existent
//                requester) and asserts 200 + p95 latency. Food's only per-user data is `fetch_requesters`,
//                so a synthetic requester deletes 0 rows — an idempotent no-op that touches no real data.
//   - `reject` — presents an EXPIRED token and asserts the guard fails closed with 401 UNDER LOAD.
//
// Tokens are EdDSA-signed, which k6's goja runtime cannot do — so they are MINTED FIRST by the Node
// `prepare-erasure-tokens.ts` step and loaded here via `open()`. The food service under test MUST be booted
// trusting the matching public key (`FOOD_SERVICE_PRINCIPAL_JWT_KEY=$(cat tests/load/erasure-public-key.pem)`).
//
//   npx tsx tests/load/prepare-erasure-tokens.ts
//   k6 run \
//     -e FOOD_API_BASE_URL=https://food.commise.app \
//     packages/services/food-service/tests/load/service-erasure.load.js
//
// A threshold breach exits k6 non-zero and fails the invoking job.

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';
import { SharedArray } from 'k6/data';

import { BASE_URL, rampStages, PEAK_VUS } from './lib/common.js';

// p95 budget (ms) for the food erasure path — a single indexed DELETE-by-requester (no async hand-off).
// Env-tunable; tighter than recipe's since there is no SQS enqueue.
const ERASURE_P95_MS = Number(__ENV['FOOD_ERASURE_P95_MS'] || 500);
// Where prepare-erasure-tokens.ts wrote the pool (relative to the run cwd = the package dir).
const TOKENS_FILE = __ENV['FOOD_ERASURE_TOKENS_FILE'] || 'tests/load/erasure-tokens.json';

// Parse the pre-minted pool ONCE in the init context; SharedArray keeps a single copy across all VUs.
const tokens = JSON.parse(open(TOKENS_FILE));
const validTokens = new SharedArray('valid-erasure-tokens', () => tokens.valid);
const expiredToken = tokens.expired;

const eraseTrend = new Trend('food_erasure_duration', true);

// The reject storm rides at half the accept peak.
const rejectPeak = Math.max(1, Math.ceil(PEAK_VUS / 2));

export const options = {
    scenarios: {
        erase: {
            executor: 'ramping-vus',
            exec: 'erasePath',
            startVUs: 0,
            stages: rampStages(PEAK_VUS),
            tags: { op: 'erase' },
        },
        reject: {
            executor: 'ramping-vus',
            exec: 'rejectPath',
            startVUs: 0,
            stages: rampStages(rejectPeak),
            tags: { op: 'reject' },
        },
    },
    thresholds: {
        // Accept path: p95 <= budget on the erasure POST.
        'http_req_duration{operation:eraseAccount}': [`p(95)<${ERASURE_P95_MS}`],
        // Only the ACCEPT scenario must stay clean — the reject scenario's 401s are EXPECTED, so the
        // failure-rate threshold is scoped to `op:erase` (an untagged global would trip on the 401s).
        'http_req_failed{op:erase}': ['rate<0.01'],
        // The valid token is accepted (200) and the expired token is rejected (401) — both UNDER LOAD.
        'checks{op:erase}': ['rate>0.99'],
        'checks{op:reject}': ['rate>0.99'],
    },
};

/** POST the erasure with the given bearer; the target requester is BOUND IN THE TOKEN (no body). */
function postErasure(bearer, op) {
    return http.post(`${BASE_URL}/v1/internal/account/erasure`, null, {
        headers: { Authorization: `Bearer ${bearer}`, Accept: 'application/json' },
        tags: { operation: op },
    });
}

export function erasePath() {
    // A distinct single-target token per iteration (round-robin over the pool). Re-presenting a token for
    // an already-erased synthetic requester is an idempotent 200 (0 rows), so pool reuse never trips the check.
    const token = validTokens[(__VU * 997 + __ITER) % validTokens.length];
    const res = postErasure(token, 'eraseAccount');
    eraseTrend.add(res.timings.duration);
    check(res, { 'erasure 200': (r) => r.status === 200 });
    sleep(1);
}

export function rejectPath() {
    const res = postErasure(expiredToken, 'eraseAccountRejected');
    check(res, { 'expired token 401': (r) => r.status === 401 });
    sleep(1);
}
