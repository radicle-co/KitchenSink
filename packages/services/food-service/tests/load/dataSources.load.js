// The Data sources read under load — `GET /api/v1/foods/sources` (curated plan R55, U25).
//
// @loadTier deployed-capable — it only READS, needs no fixture a preview lacks, and an empty catalog is a valid answer
//
// WHY THIS NEEDS A TIMED TIER. The route aggregates over the whole citation table on every request (one GROUP BY with
// a semi-join into the value table, `src/foods/dao/citedSources.dao.ts`), and nothing caches it at the origin. Its cost
// therefore grows with the catalog, not with the request. `tests/e2e/dataSources.e2e.test.ts` proves the rule one
// request at a time and can say nothing about that. If the read ever went per-dataset (an `await` in a loop) or lost
// its semi-join to a full join, this scenario is where it shows.
//
// ⚠️ NO SUCCESS CRITERION NAMES THIS ROUTE, so the latency bar is DERIVED, not quoted: it is one read, so it must beat
// SC-001's single-read budget (`READ_P95_MS`), and it is gated only on the calibrated substrate (`whenSubstrate`). What
// gates on EVERY profile is correctness a slow machine cannot cause: `200`, the published shape, no source listed
// twice, every entry carrying the words the page shows, and a request without a token answered `401`, never `2xx`.
//
//   npm run test:load:tokens
//   k6 run tests/load/dataSources.load.js
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
    whenSubstrate,
} from './lib/common.js';

const sessionTokens = new SharedArray('session-tokens', () => loadTokens().users);

const listTrend = new Trend('food_sources_list_duration', true);

// The unauthenticated probe is a correctness check, not load; a few VUs keep it from dominating the run.
const anonymousPeak = Math.max(1, Math.ceil(PEAK_VUS / 10));

export const options = {
    summaryTrendStats: SUMMARY_TREND_STATS,
    scenarios: {
        list: {
            executor: 'ramping-vus',
            exec: 'listPath',
            startVUs: 0,
            stages: rampStages(PEAK_VUS),
            tags: { op: 'list' },
        },
        anonymous: {
            executor: 'ramping-vus',
            exec: 'anonymousPath',
            startVUs: 0,
            stages: rampStages(anonymousPeak),
            tags: { op: 'anonymous' },
        },
    },
    thresholds: {
        // Correctness — carried on every profile.
        'checks{op:list}': ['rate>0.99'],
        'checks{op:anonymous}': ['rate>0.99'],
        'http_req_failed{op:list}': ['rate<0.01'],
        // Latency — the derived bar (see the header), in force only on the calibrated substrate.
        ...whenSubstrate({
            'http_req_duration{operation:listSources}': [`p(95)<${READ_P95_MS}`],
        }),
    },
};

/** The fields every listed source must carry, because the page shows each one and maps no id to anything. */
const REQUIRED_FIELDS = ['id', 'name', 'publisher', 'edition', 'licenceName', 'licenceUrl', 'attribution', 'homepage'];

/**
 * Whether `res` is a well-formed listing.
 *
 * ⚠️ Asserts the BODY, not only the status: a `200` that lists a source twice, or drops the licence of one, is still a
 * `200`, and the latency of a wrong answer says nothing.
 */
function isListing(res) {
    if (res.status !== 200) {
        return false;
    }

    const sources = res.json('sources');

    if (!Array.isArray(sources)) {
        return false;
    }

    const ids = new Set(sources.map((source) => source.id));

    return (
        ids.size === sources.length &&
        sources.every(
            (source) =>
                REQUIRED_FIELDS.every((field) => typeof source[field] === 'string' && source[field].length > 0) &&
                typeof source.attributionLanguage === 'string' &&
                typeof source.converted === 'boolean',
        )
    );
}

/** One signed-in read, as the Data sources page makes it. */
export function listPath() {
    const res = http.get(`${BASE_URL}/api/v1/foods/sources`, {
        headers: authHeaders(forIteration(sessionTokens)),
        tags: { operation: 'listSources' },
    });

    listTrend.add(res.timings.duration);
    check(res, { 'the listing is well-formed': (r) => isListing(r) });
    sleep(1);
}

/** A read with no token: the route is authenticated like every food route (FR-035), so it must answer `401`. */
export function anonymousPath() {
    // `401` is the expected answer, so it must not count toward `http_req_failed`.
    const res = http.get(`${BASE_URL}/api/v1/foods/sources`, {
        headers: { Accept: 'application/json' },
        tags: { operation: 'listSourcesAnonymous' },
        responseCallback: http.expectedStatuses(401),
    });

    check(res, { 'a request without a token is refused with 401': (r) => r.status === 401 });
    sleep(1);
}
