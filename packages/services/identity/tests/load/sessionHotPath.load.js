// The authenticated session hot path, plus the readiness probe that runs beside it.
//
// @loadTier deployed-capable — needs only a valid bearer; the 503-under-load property it guards is about a real ALB
//   draining real tasks
//
// WHY THIS IS THE FIRST SCENARIO. `GET /api/v1/users/me` is the platform's single hottest authenticated
// route, and identity is the ONE identity provider every preview and both stages sign in against (the
// shared persistent `identity.sandbox.commise.app`). Every authenticated request to this service — not
// just this route — pays the same two costs first: networkless Clerk token verification, then the
// read-through `resolveOrCreateFromClaims` lookup in `AuthMiddleware`. So this scenario measures the tax
// every route in the service shares, with the profile read on top.
//
// The `ready` scenario is co-resident ON PURPOSE and must not be split into its own run: `GET /health/ready`
// only tells you anything WHILE the service is saturated. It shares the same 20-connection `pg` pool as
// request traffic, so pool exhaustion under load makes the probe slow, then time out (2s), then answer 503
// — at which point the ALB drains tasks that are merely busy. That is identity's widest-blast-radius
// failure mode, and it is invisible to an idle health check. It runs at a fixed low arrival rate (like a
// real prober) rather than as a VU share, so it never contributes to the load it is measuring.
//
//   npm run test:load:tokens
//   npm run test:load:db                     # DATABASE_URL=…
//   k6 run -e IDENTITY_API_BASE_URL=http://localhost:3001 tests/load/sessionHotPath.load.js
//
// A threshold breach exits k6 non-zero and fails the invoking job.

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';
import { SharedArray } from 'k6/data';

import {
    BASE_URL,
    ME_P95_MS,
    ME_P99_MS,
    PEAK_VUS,
    READY_P95_MS,
    SUMMARY_TREND_STATS,
    TOKENS,
    authHeaders,
    rampStages,
    totalRampDuration,
    warmTokenForIteration,
    whenSubstrate,
} from './lib/common.js';

// One copy across all VUs.
const warmTokens = new SharedArray('warm-tokens', () => TOKENS.warm);

const meTrend = new Trend('identity_users_me_duration', true);
const readyTrend = new Trend('identity_readiness_duration', true);

// Probe cadence: 2/s, i.e. faster than the ECS/ALB health check's 30s interval, so a degradation window
// shorter than one real check interval is still sampled.
const READY_RATE_PER_SECOND = Number(__ENV['IDENTITY_READY_RATE'] || 2);

export const options = {
    summaryTrendStats: SUMMARY_TREND_STATS,
    scenarios: {
        session: {
            executor: 'ramping-vus',
            exec: 'sessionPath',
            startVUs: 0,
            stages: rampStages(PEAK_VUS),
            tags: { op: 'session' },
        },
        ready: {
            executor: 'constant-arrival-rate',
            exec: 'readinessPath',
            rate: READY_RATE_PER_SECOND,
            timeUnit: '1s',
            // Derived, never hardcoded: cover the WHOLE session shape so the probe samples ramp-up, hold
            // AND ramp-down even when the shape is retuned via IDENTITY_LOAD_HOLD et al.
            duration: totalRampDuration(),
            preAllocatedVUs: 2,
            maxVUs: 5,
            tags: { op: 'ready' },
        },
    },
    thresholds: {
        // Scoped per scenario: an untagged global rate would let a healthy majority mask the other's failure.
        'http_req_failed{op:session}': [{ threshold: 'rate<0.01', abortOnFail: true, delayAbortEval: '30s' }],
        'http_req_failed{op:ready}': ['rate<0.01'],
        // The probe answering 503 under load is the drain-healthy-tasks failure — never acceptable.
        'checks{op:ready}': ['rate>0.99'],
        'checks{op:session}': ['rate>0.99'],
        // ⚠️ REPORTED, not gated, on the deployed profile — see `whenSubstrate` in lib/common.js.
        ...whenSubstrate({
            // Silent VU starvation would otherwise shrink the sample until the percentiles are meaningless.
            dropped_iterations: ['count<1'],
            // The plan's profile target (NFR-011a): <= 1s P99, with the SC-009 read budget as the p95.
            'http_req_duration{operation:getUserMe}': [`p(95)<${ME_P95_MS}`, `p(99)<${ME_P99_MS}`],
            // Readiness must stay fast WHILE the above saturates the service.
            'http_req_duration{operation:readiness}': [`p(95)<${READY_P95_MS}`],
        }),
    },
};

export function sessionPath() {
    const token = warmTokenForIteration(warmTokens);
    const res = http.get(`${BASE_URL}/api/v1/users/me`, {
        headers: authHeaders(token),
        tags: { operation: 'getUserMe' },
    });

    meTrend.add(res.timings.duration);
    check(res, {
        'getUserMe 200': (r) => r.status === 200,
        // A 200 carrying an empty/absent body would satisfy the status check while proving nothing. The
        // warm principals are pre-seeded with an account, so both objects MUST be present — this is what
        // makes the scenario fail if the read silently degrades to a half-user.
        'getUserMe returns user + account': (r) => {
            if (r.status !== 200) {
                return false;
            }

            try {
                const body = r.json();

                return typeof body.user?.id === 'string' && typeof body.account?.id === 'string';
            } catch {
                return false;
            }
        },
    });
    sleep(1);
}

export function readinessPath() {
    const res = http.get(`${BASE_URL}/health/ready`, {
        headers: { Accept: 'application/json' },
        tags: { operation: 'readiness' },
    });

    readyTrend.add(res.timings.duration);
    // 503 is the documented failure signal (`NOT_READY`), so assert the 200 explicitly rather than "not 5xx".
    check(res, { 'readiness 200 under load': (r) => r.status === 200 });
}
