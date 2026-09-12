// U4 — analytics ingest scenario (analytics plan U4 / origin R13, SC4's load half).
//
// @loadTier deployed-capable — every input is minted per iteration; its only substrate need was the raised per-user
//   rate cap, which a pool removes
// @loadExcludeTarget prod — ADR-0040 contains a test principal's analytics on an enforcing stage, so nothing can land
//
// Drives POST /ingest/v1/events under ramping concurrency. This route earns a scenario because its load
// properties are exactly what the design promises and only concurrency can test:
//
//   * The landing is ONE multi-row INSERT with a partial-index ON CONFLICT — the cheapest write in the
//     service — so its p95 must hold comfortably inside the ordinary write budget. A p95 approaching the
//     save budget means the events store's indexes have grown pathological or the fold trigger is doing
//     more than a delta.
//   * The per-instance in-flight bound (KTD4) sheds CLIENT-DOOR load first. Under this scenario's
//     pressure a shed answers 202 with `landed: 0` — a SUCCESS, never an error — so `http_req_failed`
//     rising here means the isolation contract broke, not that the cap engaged.
//   * ⛔ …AND A RUN MUST STILL LAND SOMETHING. `202 { landed: 0 }` is also what a batch refused for any other
//     reason answers, so a run that checked only statuses passed while storing nothing (staff-architect REVIEW,
//     LOW-7). Every response feeds `analytics_ingest_events_landed`, thresholded `count>0` in EVERY profile: a
//     shed batch still passes, a run in which no batch landed fails.
//
// ⛔ NOT RUN AGAINST PRODUCTION, and that is a property of the scenario, not of today's job gate. ADR-0040 CONTAINS
// analytics on an enforcing stage: every event a signed test principal sends answers `landed: 0` by design, so
// against prod this scenario could only ever fail its landing threshold or — without it — measure nothing. The
// exclusion is declared below, where `printLoadTier.ts --target prod` reads it, so it outlives the day the k6
// job's containment gate lifts.
//   * Every iteration mints fresh UUIDs, so this measures the INSERT path; the dedup (conflict) path is
//     covered functionally in the integration tier and is CHEAPER, not dearer, under load.
//
// ⛔ THE CADENCE IS THE PROFILE'S, AND THE LIMIT IS NEVER RAISED. On the calibrated substrate the whole
// load is ONE dev-auth user with the per-user cap lifted, so the scenario keeps its 0.5s cadence there. A
// DEPLOYED stage is not ours to reconfigure: the peak is pinned to the pool (one VU per user) and the live
// `RATE_LIMIT_ANALYTICS` of 60/min applies, so `iterationPause` holds each user to the deployed pace (20/min).
// MEASURED, run 34782454327 on pr-91: at a literal `sleep(0.5)` — 120/min/user — 816 of 1441 ingests
// answered 429 (the service logged exactly 816), the check read 43%, and `http_req_failed` stayed 0%
// because a 429 is expected on that profile. Under the limit a 429 is a REAL finding again (something else
// is throttling), so the check stays 202 unconditionally rather than admitting 429 — and the request's own
// `responseCallback` now counts it in `http_req_failed` too, where before it was silently "expected".
//
//   k6 run \
//     -e RECIPE_API_BASE_URL=https://recipe.commise.app \
//     -e RECIPE_LOAD_TEST_TOKEN=$TOKEN \
//     packages/services/recipe-service/tests/load/analyticsIngest.load.js

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

import {
    BASE_URL,
    authHeaders,
    DEPLOYED_PACE_SECONDS,
    HOLD,
    iterationPause,
    LOAD_PROFILE,
    rampStages,
    PEAK_VUS,
    SC009_P95_MS,
    TOKEN_POOL,
    whenSubstrate,
} from './lib/common.js';
// ⛔ Relative across the package boundary for the reason `lib/common.js` gives for `session.js`: k6 resolves
// modules on the filesystem and rejects bare specifiers.
// eslint-disable-next-line import-x/no-relative-packages
import { landedEvents } from '../../../../tools/loadtest/k6/ingestLanding.js';

const ingestTrend = new Trend('analytics_ingest_duration', true);

/** Events the door reported LANDED, summed over the run — the evidence the run stored anything at all. */
const landedCounter = new Counter('analytics_ingest_events_landed');

/** The p95 budget: shares the SAVE budget — one short INSERT, no fan-out, no external calls. */
const INGEST_P95_MS = Number(__ENV['RECIPE_ANALYTICS_INGEST_P95_MS'] || SC009_P95_MS);

/**
 * The pool users a deployed run spreads its ingests over — one VU per user, as `rampStages` pins it.
 */
const POOL_USERS = Math.max(1, TOKEN_POOL.length);

/**
 * Ingests per pool user per minute on a deployed stage: the library's deployed pace (20/min), a third of the
 * live `RATE_LIMIT_ANALYTICS` of 60.
 */
const DEPLOYED_INGESTS_PER_USER_PER_MINUTE = 60 / DEPLOYED_PACE_SECONDS;

/**
 * ⛔ ON A DEPLOYED STAGE THE RATE IS FIXED, NOT RAMPED — a constant-arrival-rate below the limiter.
 *
 * A ramping-vus shape with a sleep offers "whatever the VUs manage", which under a slow response ramps the
 * per-user rate UP as iterations compress toward the limit. A constant arrival rate of `POOL_USERS × 20/min`
 * over `POOL_USERS` VUs holds each user at a third of `RATE_LIMIT_ANALYTICS` by construction, which is what makes
 * the per-request 429 rule below a real finding rather than a pacing artefact: nothing this scenario does should
 * reach the limit, so a 429 means something ELSE is throttling this door. The substrate profile keeps its
 * calibrated ramp.
 */
const DEPLOYED_INGEST = {
    executor: 'constant-arrival-rate',
    rate: POOL_USERS * DEPLOYED_INGESTS_PER_USER_PER_MINUTE,
    timeUnit: '1m',
    duration: HOLD,
    preAllocatedVUs: POOL_USERS,
    maxVUs: POOL_USERS,
};

export const options = {
    scenarios: {
        ingest:
            LOAD_PROFILE === 'substrate'
                ? { executor: 'ramping-vus', startVUs: 1, stages: rampStages(PEAK_VUS) }
                : DEPLOYED_INGEST,
    },
    thresholds: {
        // A SHED batch still answers 202 (`landed: 0`) — the isolation contract — so this threshold is
        // exactly "the door stayed up under load", with no shed/cap carve-out to blunt it.
        http_req_failed: ['rate<0.01'],
        // ⛔ Gated in every profile: statuses alone cannot tell a healthy run from one that landed nothing.
        analytics_ingest_events_landed: ['count>0'],
        // ⚠️ REPORTED, not gated, on the deployed profile — see `whenSubstrate` in lib/common.js.
        ...whenSubstrate({ analytics_ingest_duration: [`p(95)<${INGEST_P95_MS}`] }),
    },
};

/** One UUID v4 per event, minted per iteration — the idempotency key contract (KTD5). */
function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;

        return v.toString(16);
    });
}

function batch() {
    return JSON.stringify({
        events: [
            {
                type: 'query_outcome',
                eventId: uuid(),
                occurredAt: new Date().toISOString(),
                query: `load probe ${uuid().slice(0, 8)}`,
                served: [
                    { group: 'local', label: 'Load probe local' },
                    { group: 'catalog', label: 'Load probe catalog', foodId: 'food-load-1' },
                ],
                outcome: { kind: 'no_pick' },
            },
        ],
    });
}

export default function scenario() {
    const res = http.post(`${BASE_URL}/ingest/v1/events`, batch(), {
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        tags: { name: 'analytics_ingest' },
        // ⛔ ON THIS DOOR A 429 IS A FAILURE, overriding the deployed profile's global allowance in
        // `lib/common.js`. That allowance exists because a limiter answering is the service working; here the
        // arrival rate holds every user at a third of the limit, so a 429 is not this scenario's pace meeting the
        // limiter — it is the door refusing ingests it should have taken, and `http_req_failed` must count it.
        // A shed batch still answers 202 (`landed: 0`), so the isolation contract is untouched.
        responseCallback: http.expectedStatuses(202),
    });

    ingestTrend.add(res.timings.duration);

    const landed = res.status === 202 ? landedEvents(res.body) : null;

    // Every response adds a sample, zero included: a Counter that never receives one has no threshold verdict.
    landedCounter.add(landed ?? 0);

    check(res, {
        'ingest answers 202': (r) => r.status === 202,
        'the 202 body reports how many events landed': () => landed !== null,
    });

    // The arrival-rate executor IS the pace on a deployed stage; sleeping there would only idle the VUs the
    // rate needs and turn into dropped iterations.
    if (LOAD_PROFILE === 'substrate') {
        sleep(iterationPause(0.5));
    }
}
