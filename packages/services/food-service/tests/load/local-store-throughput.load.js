// Local-store read THROUGHPUT scenario — SC-005 ("the read API MUST sustain a high local-store serve
// throughput ... comfortably exceeding 5,000 served reads per hour").
//
// Deliberately a SEPARATE script from `local-store-read.load.js`, and deliberately a different executor.
//
//  - **Why separate.** Two scenarios hammering the same read path in one script contend for the service's
//    20-connection pool, so each would inflate the other's numbers and neither latency nor throughput would
//    be attributable. Splitting them costs one extra k6 invocation and buys measurements that mean something.
//  - **Why `constant-arrival-rate` and not `ramping-vus`.** A VU-driven executor's throughput is an OUTPUT:
//    if the service slows down, the VUs simply issue fewer requests and the run still "passes" while quietly
//    measuring a degraded service. An arrival-rate executor holds the OFFERED rate fixed no matter how the
//    service responds — a service that cannot keep up shows up as dropped iterations, which drags the
//    achieved served-read rate below the offered rate and fails the threshold. That is the only honest way
//    to assert "sustained throughput".
//
// Every read targets a RESOLVED food, so every iteration is a local-store serve with no source call.
//
//   npm run test:load:tokens
//   DATABASE_URL=… npm run test:load:fixture
//   k6 run tests/load/local-store-throughput.load.js
//
// A threshold breach exits k6 non-zero and fails the invoking job.

import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';
import { SharedArray } from 'k6/data';

import {
    BASE_URL,
    HOLD,
    READ_ARRIVAL_RATE,
    READ_P95_MS,
    SERVED_READS_PER_SECOND_MIN,
    SUMMARY_TREND_STATS,
    SUSTAIN_FRACTION,
    authHeaders,
    forIteration,
    loadFixture,
    loadTokens,
} from './lib/common.js';

const fixture = loadFixture();
const tokens = loadTokens();

const resolvedIds = new SharedArray('resolved-ids', () => fixture.resolvedIds);
const sessionTokens = new SharedArray('session-tokens', () => tokens.users);

// VUs the arrival-rate executor may use. `preAllocatedVUs` is sized for the happy path (rate x p95 budget
// = 100/s x 0.05s = 5 concurrent, with headroom); `maxVUs` is the ceiling k6 may grow to before it starts
// DROPPING iterations. The gap matters: if k6 could grow without limit it would absorb an arbitrarily slow
// service by adding VUs and the sustained-rate threshold would never fail. A bounded pool is what turns
// service slowness into a threshold breach.
const PRE_ALLOCATED_VUS = Number(__ENV['FOOD_THROUGHPUT_PREALLOCATED_VUS'] || 20);
const MAX_VUS = Number(__ENV['FOOD_THROUGHPUT_MAX_VUS'] || 100);

// Reads answered from the local store with a golden record. `rate` on a Counter is count/second over the
// test duration, which is precisely "served reads per second".
const servedReads = new Counter('food_served_reads');

export const options = {
    summaryTrendStats: SUMMARY_TREND_STATS,
    scenarios: {
        sustained: {
            executor: 'constant-arrival-rate',
            exec: 'sustainedReadPath',
            rate: READ_ARRIVAL_RATE,
            timeUnit: '1s',
            duration: HOLD,
            preAllocatedVUs: PRE_ALLOCATED_VUS,
            maxVUs: MAX_VUS,
            tags: { op: 'throughput' },
        },
    },
    thresholds: {
        food_served_reads: [
            // SC-005's literal bar: 5,000 served reads per hour = 1.389/s. A liveness floor.
            `rate>${SERVED_READS_PER_SECOND_MIN}`,
            // The regression bar that actually bites: the service absorbed the offered arrival rate.
            `rate>${READ_ARRIVAL_RATE * SUSTAIN_FRACTION}`,
        ],
        // Throughput without latency is meaningless — a service that answers 100/s at 5s each has neither
        // sustained anything nor stayed usable. SC-001's budget must still hold AT the offered rate.
        'http_req_duration{operation:sustainedRead}': [`p(95)<${READ_P95_MS}`],
        'http_req_failed{operation:sustainedRead}': ['rate<0.01'],
        checks: ['rate>0.99'],
    },
};

/** One local-store read at the fixed arrival rate. No think-time: the executor owns the pacing. */
export function sustainedReadPath() {
    const cursor = __ITER * 1000 + __VU;
    const id = resolvedIds[cursor % resolvedIds.length];
    const res = http.get(`${BASE_URL}/api/v1/foods/${id}`, {
        headers: authHeaders(forIteration(sessionTokens)),
        tags: { operation: 'sustainedRead' },
    });

    const served = res.status === 200;

    if (served) {
        servedReads.add(1);
    }

    check(res, { 'sustained read served 200': () => served });
}
