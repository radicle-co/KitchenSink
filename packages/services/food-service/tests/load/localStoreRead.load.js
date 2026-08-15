// Local-store golden-record read scenario — SC-001 (read latency) and SC-004 (local-store serve rate).
//
// Exercises `GET /api/v1/foods/{id}` against a store seeded by `preparePerfFixture.ts`, behind the REAL
// `FoodAuthGuard` (a networkless RS256 Clerk verification against a throwaway key). NO source call is made
// on this path by construction — `FoodsService.getFood` reads the golden record and nothing else — which is
// exactly the "local-store reads, no source call" condition T-195 requires.
//
// The read mix is 9 RESOLVED ids to 1 not-yet-resolvable id (alternating PENDING -> 202 and NOT_FOUND ->
// 404), which is what makes SC-004 a real ratio instead of a tautology: a request that returns no food data
// was not served from the local store. The two classes are TAGGED SEPARATELY so the cheap 202/404 reads
// cannot flatter the SC-001 p95 — that threshold is scoped to `operation:localStoreRead` only.
//
//   npm run test:load:tokens
//   DATABASE_URL=… npm run test:load:fixture
//   k6 run tests/load/localStoreRead.load.js
//
// A threshold breach exits k6 non-zero and fails the invoking job.

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';
import { SharedArray } from 'k6/data';

import {
    BASE_URL,
    PEAK_VUS,
    READ_P95_MS,
    SERVE_RATE_MIN,
    SUMMARY_TREND_STATS,
    authHeaders,
    forIteration,
    loadFixture,
    loadTokens,
    rampStages,
} from './lib/common.js';

const fixture = loadFixture();
const tokens = loadTokens();

// SharedArray keeps ONE copy of each list across all VUs (a 5,000-id array per VU would multiply the
// runner's memory by the VU count for no benefit — the lists are read-only).
const resolvedIds = new SharedArray('resolved-ids', () => fixture.resolvedIds);
const pendingIds = new SharedArray('pending-ids', () => fixture.pendingIds);
const notFoundIds = new SharedArray('not-found-ids', () => fixture.notFoundIds);
const sessionTokens = new SharedArray('session-tokens', () => tokens.users);

// One in every `UNSERVED_EVERY` reads targets a food the local store cannot serve. 10 puts the ACHIEVABLE
// serve rate at 90% against an 80% threshold, i.e. the run fails once the system loses more than 1 in 9 of
// its local serves. Env-tunable so a stricter mix can be dialled in, but note that raising it above 5
// (80% achievable) would make the SC-004 threshold unsatisfiable by construction.
const UNSERVED_EVERY = Number(__ENV['FOOD_UNSERVED_EVERY'] || 10);

const readTrend = new Trend('food_local_store_read_duration', true);
// SC-004: `true` for every read the local store answered with a golden record, `false` otherwise.
const serveRate = new Rate('food_local_store_serve_rate');

export const options = {
    summaryTrendStats: SUMMARY_TREND_STATS,
    scenarios: {
        read: {
            executor: 'ramping-vus',
            exec: 'readPath',
            startVUs: 0,
            stages: rampStages(PEAK_VUS),
            tags: { op: 'read' },
        },
    },
    thresholds: {
        // SC-001 — RESOLVED reads only.
        'http_req_duration{operation:localStoreRead}': [`p(95)<${READ_P95_MS}`],
        // SC-004 — the share of reads answered from the local store.
        food_local_store_serve_rate: [`rate>${SERVE_RATE_MIN}`],
        // Every response must be one of the THREE expected lifecycle codes. Without this a run in which the
        // service 500s on every request would still satisfy the serve-rate threshold's arithmetic only by
        // failing it — but a run where the fixture ids are wrong (every read a 404) would look like a
        // legitimate "store not warm" result. The check distinguishes "not served" from "broken".
        checks: ['rate>0.99'],
        // `http_req_failed` counts 4xx/5xx as failures, and 202/404 are EXPECTED here — so the failure-rate
        // bar is scoped to the served class, where anything but 200 is a genuine fault.
        'http_req_failed{operation:localStoreRead}': ['rate<0.01'],
    },
};

/**
 * One read. 9 of every 10 iterations read a RESOLVED food; the tenth alternates between a PENDING food
 * (202) and a tombstoned NOT_FOUND food (404).
 */
export function readPath() {
    const cursor = __ITER * 1000 + __VU;
    const unserved = cursor % UNSERVED_EVERY === UNSERVED_EVERY - 1;
    const token = forIteration(sessionTokens);

    const id = unserved
        ? Math.floor(cursor / UNSERVED_EVERY) % 2 === 0
            ? pendingIds[cursor % pendingIds.length]
            : notFoundIds[cursor % notFoundIds.length]
        : resolvedIds[cursor % resolvedIds.length];

    const operation = unserved ? 'unservedRead' : 'localStoreRead';
    const res = http.get(`${BASE_URL}/api/v1/foods/${id}`, {
        headers: authHeaders(token),
        tags: { operation },
    });

    // SC-004: only a 200 carried a golden record out of the local store.
    serveRate.add(res.status === 200);

    if (operation === 'localStoreRead') {
        readTrend.add(res.timings.duration);
        check(res, {
            // Assert the BODY, not just the status: a 200 whose payload lost its nutrients would still be
            // a 200, and the SC-001 latency of a truncated read is meaningless.
            'RESOLVED read returns a golden record': (r) => {
                if (r.status !== 200) {
                    return false;
                }

                const body = r.json();

                return body !== null && body.id === id && Array.isArray(body.nutrients) && body.nutrients.length > 0;
            },
        });
    } else {
        check(res, {
            'unresolvable read answers 202 or 404': (r) => r.status === 202 || r.status === 404,
        });
    }

    sleep(1);
}
