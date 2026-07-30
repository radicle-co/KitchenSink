// Service-principal account-erasure load scenario (CR-002 / U4a — the internal machine-auth route).
//
// Exercises `POST /v1/internal/account/erasure`, guarded NOT by Clerk but by a single-target EdDSA service
// token (`ServiceErasureGuard`). Two ramping-vus scenarios run together:
//   - `erase`  — presents a VALID single-target token (bound to a distinct synthetic, non-existent owner)
//                and asserts 202 accepted + p95 latency. The erase is an idempotent no-op on a synthetic
//                owner, so no real data is touched.
//   - `reject` — presents an EXPIRED token and asserts the guard fails closed with 401 UNDER LOAD (the
//                verify path must stay cheap + correct while the accept path is saturated).
//
// Tokens are EdDSA-signed, which k6's goja runtime cannot do — so they are MINTED FIRST by the Node
// `prepare-erasure-tokens.mjs` step (mirroring how `prepare-db.mjs` / the version-archive fixture seed
// state before a k6 run) and loaded here via `open()`. The service under test MUST be booted trusting the
// matching public key (`RECIPE_SERVICE_PRINCIPAL_JWT_KEY=$(cat tests/load/erasure-public-key.pem)`).
//
//   node tests/load/prepare-erasure-tokens.mjs
//   k6 run \
//     -e RECIPE_API_BASE_URL=https://recipe.commise.app \
//     packages/services/recipe-service/tests/load/service-erasure.load.js
//
// A threshold breach exits k6 non-zero and fails the invoking job.

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';
import { SharedArray } from 'k6/data';

import { BASE_URL, rampStages, PEAK_VUS } from './lib/common.js';

// p95 budget (ms) for the erasure accept path — a durable job write + one SQS enqueue. Env-tunable.
const ERASURE_P95_MS = Number(__ENV['RECIPE_ERASURE_P95_MS'] || 500);
// Where prepare-erasure-tokens.mjs wrote the pool (relative to the run cwd = the package dir).
const TOKENS_FILE = __ENV['RECIPE_ERASURE_TOKENS_FILE'] || './erasure-tokens.json';

// Parse the pre-minted pool ONCE in the init context; SharedArray keeps a single copy across all VUs.
const tokens = JSON.parse(open(TOKENS_FILE));
const validTokens = new SharedArray('valid-erasure-tokens', () => tokens.valid);
const expiredToken = tokens.expired;

const eraseTrend = new Trend('recipe_erasure_duration', true);

// The reject storm rides at half the accept peak — enough to prove the guard stays closed under load
// without doubling the run's request budget.
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
        // The valid token is accepted (202) and the expired token is rejected (401) — both UNDER LOAD.
        'checks{op:erase}': ['rate>0.99'],
        'checks{op:reject}': ['rate>0.99'],
    },
};

/** POST the erasure with the given bearer; the target owner is BOUND IN THE TOKEN (no body). */
function postErasure(bearer, op) {
    return http.post(`${BASE_URL}/v1/internal/account/erasure`, null, {
        headers: { Authorization: `Bearer ${bearer}`, Accept: 'application/json' },
        tags: { operation: op },
    });
}

export function erasePath() {
    // A distinct single-target token per iteration (round-robin over the pool). Re-presenting a token for
    // an already-erased synthetic owner is an idempotent 202 (the route de-dupes by owner), so pool reuse
    // never trips the accept check.
    const token = validTokens[(__VU * 997 + __ITER) % validTokens.length];
    const res = postErasure(token, 'eraseAccount');
    eraseTrend.add(res.timings.duration);
    check(res, { 'erasure 202 accepted': (r) => r.status === 202 });
    sleep(1);
}

export function rejectPath() {
    const res = postErasure(expiredToken, 'eraseAccountRejected');
    check(res, { 'expired token 401': (r) => r.status === 401 });
    sleep(1);
}
