// Identity's two authenticated WRITE paths, under load together.
//
//   `provision` — the first authenticated request for a NEVER-SEEN Clerk `sub`. `AuthMiddleware` runs
//                 read-through `resolveOrCreateFromClaims`, which finds nothing and executes
//                 `provisionCompleteUser`: a transaction inserting users + accounts + profiles, BEFORE the
//                 route body runs. This is the path every new user pays on their very first request, it
//                 runs inside the auth middleware (so a stall here 500s the request and locks the user out
//                 of every route), and it is the path with a recorded production incident — a
//                 webhook/read-through dedup race dropped a `user.created` and left Clerk and the DB
//                 disagreeing. It is also the only identity path whose cost is a multi-statement
//                 transaction, so it is where lock ordering and unique-index contention show up.
//
//   `rename`    — `PATCH /api/v1/users/me`. A select + an update + two selects, and then an `await`ed SNS
//                 publish to the handle-sync topic INSIDE the request. That last part is the reason this
//                 scenario exists separately from the read path: a slow or throttled topic inflates
//                 user-visible rename latency directly, and no unit test can show that.
//
// ⚠️ A cold token may be presented EXACTLY ONCE. A second presentation of the same `sub` takes the
// `existing` branch — a single indexed SELECT — so a wrapped pool would silently stop measuring
// provisioning and start reporting the warm read's numbers as if they were the write's. The pool is
// therefore sized generously and its exhaustion is a THRESHOLD FAILURE (`identity_cold_pool_exhausted`),
// not a wrap. If it trips, raise `IDENTITY_COLD_POOL_SIZE` and re-run the prepare step; do not shorten
// the run to hide it.
//
//   IDENTITY_COLD_POOL_SIZE=6000 npm run test:load:tokens
//   npm run test:load:db                     # DATABASE_URL=…
//   k6 run -e IDENTITY_API_BASE_URL=http://localhost:3001 tests/load/provisioning-and-rename.load.js
//
// A threshold breach exits k6 non-zero and fails the invoking job.

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import { SharedArray } from 'k6/data';
import exec from 'k6/execution';

import {
    BASE_URL,
    PEAK_VUS,
    PROVISION_P95_MS,
    RENAME_P95_MS,
    SUMMARY_TREND_STATS,
    TOKENS,
    authHeaders,
    jsonHeaders,
    rampStages,
    warmTokenForIteration,
} from './lib/common.js';

const coldTokens = new SharedArray('cold-tokens', () => TOKENS.cold);
const warmTokens = new SharedArray('warm-tokens', () => TOKENS.warm);

const provisionTrend = new Trend('identity_provision_duration', true);
const renameTrend = new Trend('identity_rename_duration', true);
// Increments once per iteration that could not obtain an unused cold token. Thresholded at zero: it is a
// measurement-validity failure, not a service failure, and it must be impossible to overlook.
const coldExhausted = new Counter('identity_cold_pool_exhausted');
// Increments when a "cold" sub turns out to have been created BEFORE this run started — i.e. the load DB
// was not re-prepared, so the request took the cheap `existing` branch and its sample is not provisioning.
const coldAlreadyExisted = new Counter('identity_cold_already_existed');

// Renames ride at half the provisioning peak: in the real workload a rename is far rarer than a first
// sign-in, and this keeps the two write paths from competing for the same connections symmetrically.
const renamePeak = Math.max(1, Math.ceil(PEAK_VUS / 2));

export const options = {
    summaryTrendStats: SUMMARY_TREND_STATS,
    scenarios: {
        provision: {
            executor: 'ramping-vus',
            exec: 'provisionPath',
            startVUs: 0,
            stages: rampStages(PEAK_VUS),
            tags: { op: 'provision' },
        },
        rename: {
            executor: 'ramping-vus',
            exec: 'renamePath',
            startVUs: 0,
            stages: rampStages(renamePeak),
            tags: { op: 'rename' },
        },
    },
    thresholds: {
        'http_req_duration{operation:provisionOnFirstRequest}': [`p(95)<${PROVISION_P95_MS}`],
        'http_req_duration{operation:patchUserMe}': [`p(95)<${RENAME_P95_MS}`],
        'http_req_failed{op:provision}': [{ threshold: 'rate<0.01', abortOnFail: true, delayAbortEval: '30s' }],
        'http_req_failed{op:rename}': ['rate<0.01'],
        'checks{op:provision}': ['rate>0.99'],
        'checks{op:rename}': ['rate>0.99'],
        // Measurement validity: a single reused cold token invalidates the provisioning percentile.
        identity_cold_pool_exhausted: ['count<1'],
        // Measurement validity: a cold sub that ALREADY existed in the database was not provisioned by
        // this request, so its sample belongs to the warm read path. See `identity_cold_already_existed`.
        identity_cold_already_existed: ['count<1'],
        dropped_iterations: ['count<1'],
    },
};

/**
 * Record the wall clock at run start so `provisionPath` can prove each cold user was created BY THIS RUN.
 *
 * WHY. A cold token is only "cold" against a database that has never seen its `sub`. `prepare-db.ts`
 * wipes the schema, so a fresh prepare makes every cold token cold again — but re-running this script
 * WITHOUT re-preparing leaves the previous run's users in place, and every request then takes the
 * `existing` branch: a single indexed SELECT, reported under the provisioning threshold. That failure is
 * invisible (it makes the numbers BETTER), so it is checked rather than documented.
 */
export function setup() {
    return { startedAtMs: Date.now() };
}

/**
 * Claim a cold token no iteration has used yet.
 *
 * `exec.scenario.iterationInTest` is unique, zero-based and monotonic PER SCENARIO across all its VUs, so
 * it maps one-to-one onto the pool with no arithmetic and no possibility of two VUs claiming the same
 * token. Deliberately NOT a modulo: wrapping is the exact failure this guards against, so running past the
 * end returns `null` and trips `identity_cold_pool_exhausted`.
 *
 * (The obvious `(__VU - 1) * stride + __ITER` form is WRONG and was caught by that threshold on the first
 * real run: `__VU` is the VU id across the WHOLE TEST, so this scenario's VUs carry ids offset past the
 * sibling scenario's block and every index overflowed the pool.)
 */
function claimColdToken() {
    const index = exec.scenario.iterationInTest;

    if (index >= coldTokens.length) {
        coldExhausted.add(1);

        return null;
    }

    return coldTokens[index];
}

export function provisionPath(data) {
    const token = claimColdToken();

    if (token === null) {
        // Stop issuing requests rather than re-presenting a used token: the threshold above has already
        // recorded the failure, and continuing would pollute the percentile with warm-path samples.
        sleep(1);

        return;
    }

    // `GET /users/me` is the cheapest authenticated route, so the measured duration is dominated by the
    // middleware's provisioning transaction rather than by the route body — which is the intent.
    const res = http.get(`${BASE_URL}/api/v1/users/me`, {
        headers: authHeaders(token),
        tags: { operation: 'provisionOnFirstRequest' },
    });

    provisionTrend.add(res.timings.duration);
    check(res, {
        'first request 200': (r) => r.status === 200,
        // Proves the transaction actually COMMITTED all three rows: `getUserMe` reads the account through
        // `resolveUser`, which throws 500 (`Account not yet provisioned`) if provisioning was partial. A
        // status-only check would pass on a half-provisioned user right up until it didn't.
        'first request provisioned user + account': (r) => {
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

    // The stale-database guard described on `setup()`. 5s of slack absorbs clock granularity between the
    // k6 host and Postgres without admitting a user left over from a previous run.
    if (res.status === 200) {
        try {
            const createdAtMs = Date.parse(res.json().user?.createdAt);

            if (Number.isFinite(createdAtMs) && createdAtMs < data.startedAtMs - 5000) {
                coldAlreadyExisted.add(1);
            }
        } catch {
            coldAlreadyExisted.add(1);
        }
    }

    sleep(1);
}

export function renamePath() {
    const token = warmTokenForIteration(warmTokens);
    // A fresh value every iteration so the UPDATE always writes (an unchanged value would still issue the
    // statement, but a distinct one also proves the read-back reflects the write).
    const displayName = `Warmload rename ${__VU}-${__ITER}`;
    const res = http.patch(`${BASE_URL}/api/v1/users/me`, JSON.stringify({ displayName }), {
        headers: jsonHeaders(token),
        tags: { operation: 'patchUserMe' },
    });

    renameTrend.add(res.timings.duration);
    check(res, {
        'patchUserMe 200': (r) => r.status === 200,
        'patchUserMe reflects the new displayName': (r) => {
            if (r.status !== 200) {
                return false;
            }

            try {
                return r.json().user?.displayName === displayName;
            } catch {
                return false;
            }
        },
    });
    sleep(1);
}
