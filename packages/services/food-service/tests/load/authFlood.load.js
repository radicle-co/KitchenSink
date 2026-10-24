// The auth-rejection path under a flood that rotates its client-written source key — FR-052/SC-009/SC-011,
// finding 02.F-F1, and the S4 security review's F8.
//
// @loadTier deployed-capable — MORE meaningful deployed: its premise is that the shared ALB APPENDS the address it
//   saw to X-Forwarded-For, which a runner-local container cannot do
//
// WHY THIS NEEDS A TIMED TIER AND NOT ANOTHER UNIT TEST. `AuthLoadShedder` defends a networkless verifier by
// counting `401`s per source and shedding a source that crosses the cap before any signature work runs. The ALB
// (ADR-0003) APPENDS to `X-Forwarded-For`, so a client writes every entry to the left of the one the ALB adds. The
// shedder keys on the entry its trusted hop count (`FOOD_TRUSTED_PROXY_HOPS`) names, so rotating the
// client-written part does not move the bucket: the whole flood shares this runner's address and is shed once it
// passes the cap.
//
// What has to hold under that load, and is not observable from a single request: rejection stays cheap and fails
// CLOSED. Every flood request answers `401`, or `503 SERVICE_UNAVAILABLE` once the shedder sheds the source, and
// never any other status. Before the cap the p95 stays inside the read budget, because a rejection that costs more
// than a served read IS the amplification.
//
// ⚠️ One runner has one address, so this script cannot also prove that a DIFFERENT client is served during the
// flood: every request it sends lands in the flood's bucket. That per-source isolation is proved by
// `tests/e2e/authDos.e2e.test.ts`, which plays the ALB. The bucket-cardinality bound is asserted in
// `src/auth/__tests__/AuthLoadShedder.test.ts`.
//
//   npm run test:load:tokens
//   DATABASE_URL=… npm run test:load:fixture
//   k6 run tests/load/authFlood.load.js
//
// A threshold breach exits k6 non-zero and fails the invoking job.

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

import {
    BASE_URL,
    PEAK_VUS,
    READ_P95_MS,
    SUMMARY_TREND_STATS,
    authHeaders,
    rampStages,
    whenSubstrate,
} from './lib/common.js';

const rejectTrend = new Trend('food_auth_flood_reject_duration', true);

/**
 * A client-written source key no other iteration repeats. It no longer moves the bucket, which is what the run
 * proves: a fixed key and a rotating one are shed alike.
 */
function rotatingSourceKey() {
    return `198.51.100.${__VU % 256}-${__ITER}-${Date.now()}`;
}

/** The shedder's answer once a source is shed. */
function isShed(res) {
    if (res.status !== 503) {
        return false;
    }

    try {
        return res.json('code') === 'SERVICE_UNAVAILABLE';
    } catch {
        return false;
    }
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
    },
    thresholds: {
        // Held at rate>0.99 rather than 1.0 so one transport hiccup is not indistinguishable from a fail-open; a
        // real bypass, or a 5xx other than the shedder's own 503, moves this far below the bar.
        'checks{op:flood}': ['rate>0.99'],
        // ⚠️ REPORTED, not gated, on the deployed profile — see `whenSubstrate` in lib/common.js.
        ...whenSubstrate({
            dropped_iterations: ['count<1'],
            // A rejection does signature work and NO database work, so it must beat the warm read.
            'http_req_duration{operation:floodRejected}': [`p(95)<${READ_P95_MS}`],
        }),
    },
};

export function rotatingRejectPath() {
    const res = http.get(`${BASE_URL}/api/v1/foods/search?query=broccoli`, {
        headers: { ...authHeaders('not-a-valid-jwt'), 'X-Forwarded-For': rotatingSourceKey() },
        tags: { operation: 'floodRejected' },
    });

    rejectTrend.add(res.timings.duration);
    check(res, {
        'flood fails closed: 401, or 503 SERVICE_UNAVAILABLE once shed': (r) => r.status === 401 || isShed(r),
    });
    sleep(1);
}
