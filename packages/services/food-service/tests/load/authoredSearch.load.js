// The caller's own authored foods under load — `GET /api/v1/foods/authored/search` (plan 002 R40, S3).
//
// @loadTier deployed-capable — it only READS each pool user's own authored foods, and asserts nothing about what
//   they hold, so any stage serves it
//
// WHY THIS NEEDS A TIMED TIER. The picker asks this route on every settled keystroke, beside the shared catalog search,
// and nothing caches it: every request is one statement over the author's own rows (`FoodSearchDao.searchAuthored`,
// served by `idx_food_user_id`). `tests/e2e/catalogSearchPrivacy.e2e.test.ts` proves what it returns one request at a
// time and can say nothing about its cost under the concurrency the catalog search sees.
//
// ⛔ THE ROUTE IS CAPPED PER USER, `SEARCH_PER_USER_LIMIT` a minute (`src/common/throttle/throttle.config.ts`). The run
// holds no more VUs than the token pool has users, one search a second each, so one user is asked about sixty times a
// minute, half the cap; more VUs than users would measure the limiter, not the search.
//
// ⚠️ NO SUCCESS CRITERION NAMES THIS ROUTE, so the bar is SC-007's search budget (`SEARCH_P95_MS`), gated only on the
// calibrated substrate (`whenSubstrate`). What gates on EVERY profile is correctness a slow machine cannot cause:
// `200`, `private, no-store`, no rate-limit counter on the answer, and no hit saying anything about visibility.
//
//   npm run test:load:tokens
//   k6 run tests/load/authoredSearch.load.js
//
// A threshold breach exits k6 non-zero and fails the invoking job.

import http from 'k6/http';
import exec from 'k6/execution';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';

import {
    BASE_URL,
    PEAK_VUS,
    SEARCH_P95_MS,
    SUMMARY_TREND_STATS,
    authHeaders,
    forIteration,
    loadTokens,
    rampStages,
    whenSubstrate,
} from './lib/common.js';

const sessionTokens = new SharedArray('session-tokens', () => loadTokens().users);

/** One VU per pool user at most — see the header for why. */
const peak = Math.min(PEAK_VUS, sessionTokens.length);

/** Terms a cook types, rotated so no single statement shape dominates the sample. */
const PROBES = ['chicken breast', 'beef brisket', 'flour', 'grandma spice mix'];

export const options = {
    summaryTrendStats: SUMMARY_TREND_STATS,
    scenarios: {
        authored: {
            executor: 'ramping-vus',
            exec: 'authoredPath',
            startVUs: 0,
            stages: rampStages(peak),
            tags: { op: 'authoredSearch' },
        },
    },
    thresholds: {
        // Correctness — carried on every profile.
        'checks{op:authoredSearch}': ['rate>0.99'],
        'http_req_failed{op:authoredSearch}': ['rate<0.01'],
        // Latency — SC-007's search budget, in force only on the calibrated substrate (see the header).
        ...whenSubstrate({ 'http_req_duration{op:authoredSearch}': [`p(95)<${SEARCH_P95_MS}`] }),
    },
};

/**
 * Whether an answer is a private, uncounted list of the caller's own foods.
 *
 * ⚠️ Asserts the HEADERS and the BODY, not only the status: a `200` a shared cache could keep, or one carrying another
 * caller's counter, is still a `200`.
 */
function answersPrivately(res) {
    if (res.status !== 200 || res.headers['Cache-Control'] !== 'private, no-store') {
        return false;
    }

    if (Object.keys(res.headers).some((name) => name.toLowerCase().startsWith('x-ratelimit'))) {
        return false;
    }

    const results = res.json('results');

    return (
        Array.isArray(results) &&
        results.every(
            (result) => typeof result.id === 'string' && result.id.length === 26 && result.visibility === undefined,
        )
    );
}

/** One authored search, rotating through the probes. */
export function authoredPath() {
    const probe = PROBES[exec.scenario.iterationInTest % PROBES.length];
    const res = http.get(`${BASE_URL}/api/v1/foods/authored/search?query=${encodeURIComponent(probe)}`, {
        headers: authHeaders(forIteration(sessionTokens)),
        tags: { operation: 'authoredSearch' },
    });

    check(res, { 'authored search answers privately': (r) => answersPrivately(r) });
    sleep(1);
}
