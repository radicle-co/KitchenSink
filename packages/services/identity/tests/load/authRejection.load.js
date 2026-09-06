// The rejection path under load — SC-006, and the amplification surface that comes with a public ALB.
//
// @loadTier deployed-capable — every reject shape is obtainable against a real instance, and azp enforcement is stage
//   CONFIG that only exists deployed
//
// WHY THIS MATTERS FOR PERFORMANCE, not just security. Identity is fronted by an internet-facing shared
// ALB (ADR-0003) and deliberately has NO trusted-header shortcut (PR #39) and no rate limiter of its own —
// so anyone can send it unlimited invalid bearers, and every one of them costs the service a token
// verification. Two properties therefore have to hold under load, and neither is observable from a
// single-request test:
//
//   1. Rejection is CHEAP and fails CLOSED. Four different rejection reasons run concurrently — an
//      untrusted signature, an expired token, a valid token with an `azp` outside the allowlist, and a
//      string that is not a JWT. Each must answer 401, and the p95 must stay below the warm-read budget
//      (a rejection that reaches the database before failing closed is both a latency and an
//      amplification defect). The `wrongAzp` case is the one CLAUDE.md flags as the real sandbox trust
//      boundary — this is where it gets exercised under concurrency rather than in a unit test.
//
//   2. Legitimate traffic is NOT STARVED by the rejection storm. A `valid` scenario runs alongside at half
//      the rejection peak and keeps its own thresholds. Without it a green rejection run would say nothing
//      about whether real users could still sign in during one.
//
//   npm run test:load:tokens
//   npm run test:load:db                     # DATABASE_URL=…
//   k6 run -e IDENTITY_API_BASE_URL=http://localhost:3001 tests/load/authRejection.load.js
//
// A threshold breach exits k6 non-zero and fails the invoking job.

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';
import { SharedArray } from 'k6/data';

import {
    BASE_URL,
    ME_P95_MS,
    PEAK_VUS,
    REJECT_P95_MS,
    SUMMARY_TREND_STATS,
    TOKENS,
    authHeaders,
    rampStages,
    warmTokenForIteration,
} from './lib/common.js';

const warmTokens = new SharedArray('warm-tokens', () => TOKENS.warm);

// The four rejection shapes, each a DIFFERENT failure the verifier must fail closed on. `noBearer` is
// added here rather than in the prepare step: the absence of a header is not something to mint.
const rejectCases = new SharedArray('reject-cases', () => [
    { name: 'badSignature', token: TOKENS.reject.badSignature },
    { name: 'expired', token: TOKENS.reject.expired },
    { name: 'wrongAzp', token: TOKENS.reject.wrongAzp },
    { name: 'malformed', token: TOKENS.reject.malformed },
    { name: 'noBearer', token: null },
]);

const rejectTrend = new Trend('identity_reject_duration', true);
const validTrend = new Trend('identity_valid_under_storm_duration', true);

// Legitimate traffic rides at half the storm's peak — enough to produce a meaningful percentile without
// becoming the dominant load itself.
const validPeak = Math.max(1, Math.ceil(PEAK_VUS / 2));

export const options = {
    summaryTrendStats: SUMMARY_TREND_STATS,
    scenarios: {
        storm: {
            executor: 'ramping-vus',
            exec: 'rejectPath',
            startVUs: 0,
            stages: rampStages(PEAK_VUS),
            tags: { op: 'storm' },
        },
        valid: {
            executor: 'ramping-vus',
            exec: 'validPath',
            startVUs: 0,
            stages: rampStages(validPeak),
            tags: { op: 'valid' },
        },
    },
    thresholds: {
        // A 401 does signature work and NO database work, so it must beat the warm read comfortably.
        'http_req_duration{operation:rejected}': [`p(95)<${REJECT_P95_MS}`],
        // The starvation guard: real users keep the SAME budget they get without a storm.
        'http_req_duration{operation:validUnderStorm}': [`p(95)<${ME_P95_MS}`],
        // `http_req_failed` counts the storm's 401s as failures by design, so it is scoped to `op:valid`
        // ONLY — an untagged global threshold here would be permanently red and therefore meaningless.
        'http_req_failed{op:valid}': ['rate<0.01'],
        // SC-006: 100% of requests without a valid token receive 401. Held at rate>0.99 rather than 1.0
        // purely so a single transport hiccup is not indistinguishable from an auth bypass; any real
        // fail-open moves this far below the bar.
        'checks{op:storm}': ['rate>0.99'],
        'checks{op:valid}': ['rate>0.99'],
        dropped_iterations: ['count<1'],
    },
};

export function rejectPath() {
    // Round-robin over the reject shapes so all four are exercised throughout the run, not just at the start.
    const testCase = rejectCases[(__VU * 7 + __ITER) % rejectCases.length];
    const res = http.get(`${BASE_URL}/api/v1/users/me`, {
        headers: authHeaders(testCase.token),
        tags: { operation: 'rejected', rejectCase: testCase.name },
    });

    rejectTrend.add(res.timings.duration);
    check(res, {
        // Exactly 401 — not "any 4xx". A 403 would mean the request got past authentication, and a 500
        // would mean the rejection path threw rather than failing closed.
        'invalid credential rejected with 401': (r) => r.status === 401,
    });
    sleep(1);
}

export function validPath() {
    const token = warmTokenForIteration(warmTokens);
    const res = http.get(`${BASE_URL}/api/v1/users/me`, {
        headers: authHeaders(token),
        tags: { operation: 'validUnderStorm' },
    });

    validTrend.add(res.timings.duration);
    check(res, { 'valid session still served during storm': (r) => r.status === 200 });
    sleep(1);
}
