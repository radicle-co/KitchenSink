// The auth-rejection path under a SOURCE-KEY-ROTATING flood — FR-052/SC-009/SC-011, and finding 02.F-F1.
//
// WHY THIS NEEDS A TIMED TIER AND NOT ANOTHER UNIT TEST. `AuthLoadShedder` defends a networkless verifier
// by counting `401`s per source and shedding a source that crosses the cap before any signature work runs.
// Its bucket key is the leftmost `X-Forwarded-For` hop — and the shared ALB (ADR-0003) APPENDS to that
// header rather than replacing it, so the key is chosen by the caller. An attacker therefore rotates it
// every request, never trips the per-source cap, and pays one signature verification per request while the
// shedder mints one bucket per request.
//
// Two properties have to hold under that load, and neither is observable from a single request:
//
//   1. **Rejection stays cheap and fails CLOSED.** Every rotated-key request answers `401` — never a `5xx`,
//      which is what a shedder collapsing under its own bookkeeping looks like from outside — and the p95
//      stays inside the read budget, because a rejection that costs more than a served read IS the
//      amplification.
//   2. **Legitimate traffic is not starved.** A valid-token scenario runs alongside at half the flood's
//      peak and keeps its own budget. Without it a green flood run would say nothing about whether real
//      users could still be served during one.
//
// The bucket-cardinality bound that makes (1) survivable is asserted directly in
// `src/auth/__tests__/AuthLoadShedder.test.ts` — a Map size is not visible over HTTP. What this script adds
// is the evidence a unit test structurally cannot give: that the bound holds while the process is actually
// under concurrent load, for the whole ramp, without the rejection path or the served path degrading.
//
//   npm run test:load:tokens
//   DATABASE_URL=… npm run test:load:fixture
//   k6 run tests/load/authFlood.load.js
//
// A threshold breach exits k6 non-zero and fails the invoking job.

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';
import { SharedArray } from 'k6/data';

import {
    BASE_URL,
    PEAK_VUS,
    READ_P95_MS,
    SUMMARY_TREND_STATS,
    authHeaders,
    forIteration,
    loadTokens,
    rampStages,
} from './lib/common.js';

// ⛔ `() => loadTokens().users`, NOT `loadTokens`. `loadTokens()` returns the whole pool OBJECT
// (`{ users: [...] }`), and `SharedArray` accepts only an array — passing the function directly aborts the
// run with `GoError: only arrays can be made into SharedArray` before a single request is made. Every other
// script in this directory already had it right; this one was wired into CI without ever being executed,
// so the mistake was invisible until the heavy tier actually ran.
const warmTokens = new SharedArray('warm-tokens', () => loadTokens().users);

const rejectTrend = new Trend('food_auth_flood_reject_duration', true);
const servedTrend = new Trend('food_auth_flood_served_duration', true);

// Legitimate traffic rides at half the flood's peak — enough for a meaningful percentile without becoming
// the dominant load itself.
const servedPeak = Math.max(1, Math.ceil(PEAK_VUS / 2));

/**
 * A source key no other iteration will ever repeat. This is the WHOLE POINT of the scenario: a fixed key
 * would be shed after `FOOD_AUTH_SHED_THRESHOLD` failures and the run would measure the cheap path only.
 */
function rotatingSourceKey() {
    return `198.51.100.${__VU % 256}-${__ITER}-${Date.now()}`;
}

export const options = {
    summaryTrendStats: SUMMARY_TREND_STATS,
    scenarios: {
        flood: {
            executor: 'ramping-vus',
            exec: 'rotatingRejectPath',
            startVUs: 0,
            stages: rampStages(PEAK_VUS),
            tags: { op: 'flood' },
        },
        served: {
            executor: 'ramping-vus',
            exec: 'servedPath',
            startVUs: 0,
            stages: rampStages(servedPeak),
            tags: { op: 'served' },
        },
    },
    thresholds: {
        // A rejection does signature work and NO database work, so it must beat the warm read.
        'http_req_duration{operation:floodRejected}': [`p(95)<${READ_P95_MS}`],
        // The starvation guard: real users keep the SAME budget they get without a flood.
        'http_req_duration{operation:servedUnderFlood}': [`p(95)<${READ_P95_MS}`],
        // `http_req_failed` counts the flood's 401s as failures by design, so it is scoped to the served
        // scenario ONLY — an untagged global threshold here would be permanently red and meaningless.
        'http_req_failed{op:served}': ['rate<0.01'],
        // Held at rate>0.99 rather than 1.0 so one transport hiccup is not indistinguishable from a
        // fail-open; a real bypass, or a shedder answering 5xx, moves this far below the bar.
        'checks{op:flood}': ['rate>0.99'],
        'checks{op:served}': ['rate>0.99'],
        dropped_iterations: ['count<1'],
    },
};

export function rotatingRejectPath() {
    const res = http.get(`${BASE_URL}/api/v1/foods/search?query=broccoli`, {
        headers: { ...authHeaders('not-a-valid-jwt'), 'X-Forwarded-For': rotatingSourceKey() },
        tags: { operation: 'floodRejected' },
    });

    rejectTrend.add(res.timings.duration);
    check(res, {
        // Exactly 401. A 503 would mean the shedder is shedding a source it has never seen, and a 5xx of
        // any kind under a key-rotating flood is the memory-exhaustion symptom this scenario exists to see.
        'rotated-key flood rejected with 401': (r) => r.status === 401,
    });
    sleep(1);
}

export function servedPath() {
    const res = http.get(`${BASE_URL}/api/v1/foods/search?query=broccoli`, {
        headers: { ...authHeaders(forIteration(warmTokens)), 'X-Forwarded-For': '203.0.113.10' },
        tags: { operation: 'servedUnderFlood' },
    });

    servedTrend.add(res.timings.duration);
    check(res, { 'legitimate caller still served under the flood': (r) => r.status === 200 });
    sleep(1);
}
