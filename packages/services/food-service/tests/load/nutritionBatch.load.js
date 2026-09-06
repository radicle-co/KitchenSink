// The batch nutrition endpoint under load — plan U8, and the per-request id cap as a DoS bound.
//
// @loadTier substrate-bound — same fixture; the over-cap scenario needs 101 DISTINCT resolved ids, more than a seeded preview catalog holds
//
// WHY THIS NEEDS A TIMED TIER AND NOT ANOTHER e2e. `GET /api/v1/foods/nutrition?ids=…` is the one route
// whose cost is chosen by the CALLER: `FoodsService.getNutritionBatch` fans out over `ids.length`
// concurrent `readGoldenRecord` calls, each of which is the six-round-trip SC-001 read. One request is
// therefore up to 100 of the most expensive reads this service serves, against a 20-connection pool.
// `tests/e2e/foodsNutrition.e2e.test.ts` proves the endpoint's CONTRACT exhaustively and can say nothing
// about that, because a correctness suite issues one request at a time.
//
// Three properties, and none is observable from a single request:
//
//   1. **The batch amortizes.** The threshold is `READ_P95_MS × NUTRITION_BATCH_IDS` — the line at which
//      one batched id costs as much as a whole standalone read, i.e. where the endpoint stops being worth
//      having. See the derivation on `NUTRITION_BATCH_P95_MS` in `lib/common.js`.
//   2. **It does not starve the single-read path.** A `singleRead` control scenario reads the SAME
//      fixture ids one at a time, in the SAME contention window, against its own SC-001 budget. That is
//      what makes (1) interpretable: a red batch beside a green control is the fan-out; both red is the
//      pool or the host. `localStoreRead.load.js` measures the control shape ALONE, minutes earlier —
//      which is a different question.
//   3. **The cap is enforced BEFORE any database work.** An over-cap request is rejected by
//      `canonicalizeNutritionIds` at the boundary, so it must be CHEAPER than a single read. If the cap
//      were ever removed or moved behind the query, that one request becomes 101 golden-record reads and
//      this scenario reports it in both latency and its status check — which is exactly the
//      unbounded-read vector the cap exists to close.
//
// ⚠️ SAMPLE COUNT. The batch scenario runs at `PEAK_VUS / NUTRITION_BATCH_IDS` VUs on purpose: it holds
// the offered DATABASE work equal to the control's rather than the request rate, which is the only way
// the two numbers compare. At the default peak that is a handful of VUs and a few hundred iterations, so
// the p95 is a nearest-rank estimate over ~n=300 — same footing as the drain probe, and read it as such.
//
//   npm run test:load:tokens
//   DATABASE_URL=… npm run test:load:fixture
//   k6 run tests/load/nutritionBatch.load.js
//
// A threshold breach exits k6 non-zero and fails the invoking job.

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';
import { SharedArray } from 'k6/data';

import {
    BASE_URL,
    NUTRITION_BATCH_IDS,
    NUTRITION_BATCH_P95_MS,
    PEAK_VUS,
    READ_P95_MS,
    SUMMARY_TREND_STATS,
    authHeaders,
    forIteration,
    loadFixture,
    loadTokens,
    rampStages,
} from './lib/common.js';

const fixture = loadFixture();
const tokens = loadTokens();

const resolvedIds = new SharedArray('resolved-ids', () => fixture.resolvedIds);
const sessionTokens = new SharedArray('session-tokens', () => tokens.users);

const batchTrend = new Trend('food_nutrition_batch_duration', true);
const controlTrend = new Trend('food_nutrition_single_read_duration', true);

// The published per-request cap (`MAX_NUTRITION_IDS`). Restated here rather than imported because k6 runs
// this file with its own module loader and cannot resolve a TypeScript source; the over-cap scenario asks
// for one MORE than this, and the service's `details.maxNames` is checked against it on every response, so
// a drift between the two fails the run instead of silently measuring nothing.
const MAX_NUTRITION_IDS = Number(__ENV['FOOD_MAX_NUTRITION_IDS'] || 100);

// Equal DATABASE work, not equal request rate — see the sample-count note above.
const batchPeak = Math.max(1, Math.ceil(PEAK_VUS / NUTRITION_BATCH_IDS));
// The control rides at half the single-read suite's peak: enough for a real percentile without becoming
// the dominant load and turning this into a second `localStoreRead` run.
const controlPeak = Math.max(1, Math.ceil(PEAK_VUS / 2));
// The rejection path does no database work; a couple of VUs is enough to characterize it.
const capPeak = Math.max(1, Math.ceil(PEAK_VUS / 25));

/**
 * `count` DISTINCT fixture ids starting at `offset`, in the caller's arbitrary order.
 *
 * DISTINCT matters for the over-cap scenario specifically: the cap counts UNIQUE ids, so a list padded
 * with duplicates de-duplicates back under the cap and the request would be served instead of rejected —
 * measuring the opposite of what that scenario claims.
 */
function distinctIds(offset, count) {
    const ids = [];

    for (let i = 0; i < count; i += 1) {
        ids.push(resolvedIds[(offset + i) % resolvedIds.length]);
    }

    return ids;
}

export const options = {
    summaryTrendStats: SUMMARY_TREND_STATS,
    scenarios: {
        batch: {
            executor: 'ramping-vus',
            exec: 'batchPath',
            startVUs: 0,
            stages: rampStages(batchPeak),
            tags: { op: 'batch' },
        },
        control: {
            executor: 'ramping-vus',
            exec: 'singleReadPath',
            startVUs: 0,
            stages: rampStages(controlPeak),
            tags: { op: 'control' },
        },
        overCap: {
            executor: 'ramping-vus',
            exec: 'overCapPath',
            startVUs: 0,
            stages: rampStages(capPeak),
            tags: { op: 'overCap' },
        },
    },
    thresholds: {
        // (1) The amortization bar — one batched id must cost less than one standalone read.
        'http_req_duration{operation:nutritionBatch}': [`p(95)<${NUTRITION_BATCH_P95_MS}`],
        // (2) The starvation guard — the single-read path keeps SC-001 while the fan-out runs.
        'http_req_duration{operation:singleReadControl}': [`p(95)<${READ_P95_MS}`],
        // (3) A boundary rejection does NO database work, so it must beat a served read outright.
        'http_req_duration{operation:nutritionOverCap}': [`p(95)<${READ_P95_MS}`],
        // `http_req_failed` counts the over-cap scenario's 400s as failures by design, so the failure-rate
        // bars are scoped per scenario — an untagged global one would be permanently red and meaningless.
        'http_req_failed{op:batch}': ['rate<0.01'],
        'http_req_failed{op:control}': ['rate<0.01'],
        // Held at rate>0.99 rather than 1.0 so one transport hiccup is not indistinguishable from a
        // systematic wrong answer; a truncated body or a lifted cap moves these far below the bar.
        'checks{op:batch}': ['rate>0.99'],
        'checks{op:control}': ['rate>0.99'],
        'checks{op:overCap}': ['rate>0.99'],
        dropped_iterations: ['count<1'],
    },
};

/** One `NUTRITION_BATCH_IDS`-wide batch — U8's worked example, a recipe list's ingredients in one call. */
export function batchPath() {
    const ids = distinctIds((__ITER * 1000 + __VU) * NUTRITION_BATCH_IDS, NUTRITION_BATCH_IDS);
    const res = http.get(`${BASE_URL}/api/v1/foods/nutrition?ids=${ids.slice().sort().join(',')}`, {
        headers: authHeaders(forIteration(sessionTokens)),
        tags: { operation: 'nutritionBatch' },
    });

    batchTrend.add(res.timings.duration);
    check(res, {
        // Assert the BODY, not just the status. A 200 that lost its projection is still a 200, and the
        // latency of a response carrying no numbers says nothing — this is the same reason
        // `localStoreRead.load.js` checks `nutrients.length > 0` rather than the status alone.
        'batch returns a full projection for every requested id': (r) => {
            if (r.status !== 200) {
                return false;
            }

            const body = r.json();

            return (
                body !== null &&
                Array.isArray(body.foods) &&
                body.foods.length === NUTRITION_BATCH_IDS &&
                Array.isArray(body.unknownIds) &&
                body.unknownIds.length === 0 &&
                body.foods.every((food) => typeof food.caloriesPer100g === 'number' && Array.isArray(food.portions))
            );
        },
    });
    sleep(1);
}

/** The control: the SAME golden records, one request per id, under the SAME contention. */
export function singleReadPath() {
    const cursor = __ITER * 1000 + __VU;
    const id = resolvedIds[cursor % resolvedIds.length];
    const res = http.get(`${BASE_URL}/api/v1/foods/${id}`, {
        headers: authHeaders(forIteration(sessionTokens)),
        tags: { operation: 'singleReadControl' },
    });

    controlTrend.add(res.timings.duration);
    check(res, {
        'single read still returns a golden record under the batch load': (r) => {
            if (r.status !== 200) {
                return false;
            }

            const body = r.json();

            return body !== null && body.id === id && Array.isArray(body.nutrients) && body.nutrients.length > 0;
        },
    });
    sleep(1);
}

/** One id over the cap — rejected at the boundary, before a single row is read. */
export function overCapPath() {
    const ids = distinctIds((__ITER * 1000 + __VU) * 7, MAX_NUTRITION_IDS + 1);
    const res = http.get(`${BASE_URL}/api/v1/foods/nutrition?ids=${ids.join(',')}`, {
        headers: authHeaders(forIteration(sessionTokens)),
        tags: { operation: 'nutritionOverCap' },
    });

    check(res, {
        // Exactly 400 AND the published code AND the cap it reports. A 200 here means the cap is gone and
        // one request just read 101 golden records; a 5xx means it collapsed instead of rejecting; a bare
        // 400 with no `details.maxNames` is the envelope a client cannot parse.
        'over-cap request is rejected with the published BATCH_TOO_LARGE envelope': (r) => {
            if (r.status !== 400) {
                return false;
            }

            const body = r.json();

            return body !== null && body.code === 'BATCH_TOO_LARGE' && body.details.maxNames === MAX_NUTRITION_IDS;
        },
    });
    sleep(1);
}
