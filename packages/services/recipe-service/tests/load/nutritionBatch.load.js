// Deferred-nutrition batch load scenario (`POST /api/v1/recipes/nutrition-batch`).
//
// @loadTier substrate-bound — the fan-out evidence is a local stub's chunk counters, and it needs a 5,000-food
//   fixture written straight to DATABASE_URL
//
// This endpoint is the one read whose cost is a FAN-OUT rather than a query: it resolves N recipes' lines in
// one database round trip and then asks the food service for their DISTINCT foods, split at food's 100-id
// cap and issued in bounded waves of six (`MAX_CONCURRENT_CHUNKS`, ADR-0021 §4):
//
//     waves = ceil(ceil(distinctFoods / 100) / 6)      cost ≈ readCost + waves × foodLatency
//
// ⛔ WHAT THIS FILE USED TO MEASURE, AND WHY IT WAS WORSE THAN NOTHING. The superseded `capBatch` scenario
// padded a 20-recipe seeded list to the 500-id cap with well-formed ids that resolve to NO recipe. Those ids
// are omitted from the response (REQ-IF-008: absence is the only signal), so the distinct-food count stayed
// at a handful and the fan-out stayed at ONE call however wide the request got. It measured request WIDTH
// while reporting on the cap — a scenario that would go green on precisely the case that cannot fail, which
// is worse than having no scenario, because it reads as proof. ADR-0021 records it as residual risk.
//
// So the ids now come from a SEEDED fixture (`prepareNutritionFanoutFixture.ts`) of two sets with the same
// recipe count and line count, differing ONLY in ingredient overlap. The difference between them is the
// cost of fan-out with everything else held constant:
//
//   | scenario      | ids | distinct foods | chunks | waves | what it answers                              |
//   | ------------- | --- | -------------- | ------ | ----- | -------------------------------------------- |
//   | `degraded`    | 500 | (food is down) |      0 |     0 | a food outage DEGRADES, never fails, the read |
//   | `page`        |  20 |             12 |      1 |     1 | what every card grid actually sends           |
//   | `plan`        | 120 |          1,200 |     12 |     2 | REQ-NF-006's 30-day × 4-slot plan             |
//   | `capOverlap`  | 500 |             12 |      1 |     1 | the cap with a shared pantry — the best case  |
//   | `capFanout`   | 500 |          5,000 |     50 |     9 | the cap with zero overlap — the worst case    |
//
// Neither end is "the" real number: a real list shares staples but is not built from twelve of them, so the
// truth is between them. The pair is the point — one number alone cannot tell a slow endpoint from a wide one.
//
// ⚠️ TWO CONDITIONS, OR THIS MEASURES THE SHORT-CIRCUIT AGAIN.
//   1. The request must carry a BEARER. `FoodNutritionGateway.lookup` degrades without issuing any request
//      when it has no caller credential to forward, so a run with no `Authorization` header measures nothing
//      about fan-out no matter how the fixture is shaped (see NUTRITION_FORWARD_BEARER in lib/common.js).
//   2. The food origin must ANSWER, with latency. Against an unreachable origin every wave is refused in
//      microseconds and the fan-out is free. CI points `FOOD_SERVICE_URL` at `foodNutritionStub.mjs`, which
//      answers food's published shape after a stated delay and enforces the 100-id cap with a 400 — so a
//      gateway that stopped chunking fails loudly instead of getting quietly faster.
//   The `degraded` scenario is the deliberate exception: it sends NO bearer and asserts the endpoint still
//   answers 200 with terminal states, because the wire union has no `pending` member and a card grid must be
//   able to stop waiting.
//
// The scenarios run ONE AFTER ANOTHER (`startTime`), not concurrently: the interesting quantity is the
// difference between two of them, and that difference is only attributable if they do not contend with each
// other on the same runner.
//
//   DATABASE_URL=… npx tsx tests/load/prepareNutritionFanoutFixture.ts       # once, seeds + emits the fixture
//   k6 run \
//     -e RECIPE_API_BASE_URL=https://recipe.commise.app \
//     -e RECIPE_LOAD_TEST_TOKEN=$TOKEN \
//     packages/services/recipe-service/tests/load/nutritionBatch.load.js

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

import {
    BASE_URL,
    loadNutritionFixture,
    rampSeconds,
    rampStages,
    MAX_NUTRITION_RECIPE_IDS,
    NUTRITION_BATCH_P95_MS,
    NUTRITION_FORWARD_BEARER,
    NUTRITION_PAGE_SIZE,
    PEAK_VUS,
    SUMMARY_TREND_STATS,
} from './lib/common.js';

const FIXTURE = loadNutritionFixture();

// Bodies are serialized ONCE, in the init context. Rebuilding a 500-id JSON body per iteration puts the
// runner's own CPU inside the measurement window — at the cap that is 18 KB of string building per request,
// on the same thread that is timing the response.
const BODY = {
    page: JSON.stringify({ recipeIds: FIXTURE.page.recipeIds }),
    plan: JSON.stringify({ recipeIds: FIXTURE.plan.recipeIds }),
    capOverlap: JSON.stringify({ recipeIds: FIXTURE.overlap.recipeIds }),
    capFanout: JSON.stringify({ recipeIds: FIXTURE.fanout.recipeIds }),
};

const pageTrend = new Trend('recipe_nutrition_page_duration', true);
const planTrend = new Trend('recipe_nutrition_plan_duration', true);
const capOverlapTrend = new Trend('recipe_nutrition_cap_overlap_duration', true);
const capFanoutTrend = new Trend('recipe_nutrition_cap_fanout_duration', true);
const degradedTrend = new Trend('recipe_nutrition_degraded_duration', true);

// The cap scenarios are deliberately a fraction of the peak: they are tail-behaviour probes, not
// steady-state ones, and running a 500-recipe/5,000-food batch at full concurrency would measure the runner
// (and the stub) rather than the service.
const capPeak = Math.max(1, Math.ceil(PEAK_VUS / 10));
const planPeak = Math.max(1, Math.ceil(PEAK_VUS / 5));

/** One scenario window, so the next starts only after this one has fully drained. */
const WINDOW = rampSeconds();

/** Scenario N's start offset. Sequential by construction — see the header note on attribution. */
function startAt(index) {
    return `${index * WINDOW}s`;
}

export const options = {
    summaryTrendStats: SUMMARY_TREND_STATS,
    scenarios: {
        // FIRST, on a COLD gateway cache: with nothing cached, a credential-less lookup recovers nothing and
        // every recipe must answer `unaccounted{food_unavailable}` — the honest worst case of a food outage.
        // Running it after the warm scenarios would find their entries in the LRU and measure a cache hit.
        degradedBatch: {
            executor: 'ramping-vus',
            exec: 'degradedBatchPath',
            startVUs: 0,
            stages: rampStages(capPeak),
            startTime: startAt(0),
            tags: { scenario: 'nutrition-degraded' },
        },
        pageBatch: {
            executor: 'ramping-vus',
            exec: 'pageBatchPath',
            startVUs: 0,
            stages: rampStages(PEAK_VUS),
            startTime: startAt(1),
            tags: { scenario: 'nutrition-page' },
        },
        planBatch: {
            executor: 'ramping-vus',
            exec: 'planBatchPath',
            startVUs: 0,
            stages: rampStages(planPeak),
            startTime: startAt(2),
            tags: { scenario: 'nutrition-plan' },
        },
        capOverlapBatch: {
            executor: 'ramping-vus',
            exec: 'capOverlapBatchPath',
            startVUs: 0,
            stages: rampStages(capPeak),
            startTime: startAt(3),
            tags: { scenario: 'nutrition-cap-overlap' },
        },
        capFanoutBatch: {
            executor: 'ramping-vus',
            exec: 'capFanoutBatchPath',
            startVUs: 0,
            stages: rampStages(capPeak),
            startTime: startAt(4),
            tags: { scenario: 'nutrition-cap-fanout' },
        },
    },
    thresholds: {
        'http_req_duration{operation:nutritionPage}': [`p(95)<${NUTRITION_BATCH_P95_MS}`],
        'http_req_duration{operation:nutritionPlan}': [`p(95)<${NUTRITION_BATCH_P95_MS}`],
        'http_req_duration{operation:nutritionCapOverlap}': [`p(95)<${NUTRITION_BATCH_P95_MS}`],
        // The scenario this file exists for: the published cap with no ingredient overlap, i.e. the most
        // sequential food waves a single request can cost. If THIS breaches, the cap is a promise the
        // service does not keep, and the fix is bounded-concurrency tuning or a documented cap reduction —
        // never silent truncation (REQ-IF-008).
        'http_req_duration{operation:nutritionCapFanout}': [`p(95)<${NUTRITION_BATCH_P95_MS}`],
        // A degraded lookup must be FASTER than a served one, not slower: it issues no request at all. A
        // breach here means a food outage is being absorbed by a timeout on the caller's thread.
        'http_req_duration{operation:nutritionDegraded}': [`p(95)<${NUTRITION_BATCH_P95_MS}`],
        // ⛔ THE ASSERTION THAT KEEPS THIS SCENARIO HONEST. Latency thresholds cannot tell a fast answer
        // from an empty one — the superseded scenario's whole failure mode. These make "the batch actually
        // resolved its recipes, and the food data actually reached the response" a PASS CONDITION.
        'checks{assertion:resolved}': ['rate>0.99'],
        'checks{assertion:fanout}': ['rate>0.99'],
        // ⛔ A food outage must DEGRADE this endpoint, never FAIL it — the wire union has no `pending`
        // member precisely so a card can always stop waiting. A non-2xx means the dependency's failure
        // reached the caller.
        http_req_failed: ['rate<0.01'],
    },
};

/** Headers that FORWARD a credential, so the gateway actually calls food. */
function forwardingHeaders() {
    return {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${NUTRITION_FORWARD_BEARER}`,
    };
}

/** Headers with NO credential — the gateway's degrade-without-calling path. */
function credentiallessHeaders() {
    return { Accept: 'application/json', 'Content-Type': 'application/json' };
}

/** The `nutrition` map, or `{}` when the body is not the shape the contract promises. */
function nutritionMap(res) {
    try {
        return res.json('nutrition') || {};
    } catch {
        return {};
    }
}

/**
 * Issue one batch and assert it RESOLVED — every named recipe answered, and (when food is reachable) with a
 * figure that could only have come from the food round trips.
 *
 * `Object.hasOwn` rather than a bare index, mirroring the client rule in ADR-0021 §3: a `Record` index
 * reaches the prototype chain, so a recipe id of `toString` would hand back a function.
 */
function batch(body, operation, trend, expectedIds) {
    const res = http.post(`${BASE_URL}/api/v1/recipes/nutrition-batch`, body, {
        headers: forwardingHeaders(),
        tags: { operation },
    });

    trend.add(res.timings.duration);

    check(
        res,
        {
            [`${operation} 200`]: (r) => r.status === 200,
            // A seeded id that answers nothing means the fixture is absent or unreadable — and an empty map
            // is FAST, which is how a broken scenario reports a flattering p95.
            [`${operation} answers every seeded recipe`]: (r) => Object.keys(nutritionMap(r)).length === expectedIds,
        },
        { assertion: 'resolved' },
    );

    check(
        res,
        {
            // The food data REACHED the response. `known` requires at least one line to have been accounted
            // for, and every fixture line's only nutrition source is the food service — so this fails if the
            // gateway short-circuited, if the chunks failed, or if the ids resolved to no food.
            [`${operation} reports a food-derived figure`]: (r) => {
                const entries = Object.values(nutritionMap(r));
                const first = entries[0];

                return first !== undefined && first.state === 'known' && first.caloriesPerServing > 0;
            },
        },
        { assertion: 'fanout' },
    );

    sleep(1);
}

/** A card grid's page — 20 recipes over a shared pantry (1 chunk). */
export function pageBatchPath() {
    batch(BODY.page, 'nutritionPage', pageTrend, NUTRITION_PAGE_SIZE);
}

/** REQ-NF-006's shape: a 30-day × 4-slot plan, zero ingredient overlap (12 chunks → 2 waves). */
export function planBatchPath() {
    batch(BODY.plan, 'nutritionPlan', planTrend, FIXTURE.plan.recipeIds.length);
}

/** The published cap over a shared pantry — full request width, minimum fan-out (1 wave). */
export function capOverlapBatchPath() {
    batch(BODY.capOverlap, 'nutritionCapOverlap', capOverlapTrend, MAX_NUTRITION_RECIPE_IDS);
}

/** The published cap with zero overlap — the most sequential waves one request can cost (9). */
export function capFanoutBatchPath() {
    batch(BODY.capFanout, 'nutritionCapFanout', capFanoutTrend, MAX_NUTRITION_RECIPE_IDS);
}

/**
 * The same cap-width request with NO credential to forward: the gateway degrades without calling food.
 *
 * Asserted on OUTCOME, not on latency alone: every recipe must carry a TERMINAL state. `pending` is not a
 * wire state (ADR-0021 §2) precisely so an origin can never pin a skeleton forever, and this is the tier
 * that would catch one appearing.
 */
export function degradedBatchPath() {
    const res = http.post(`${BASE_URL}/api/v1/recipes/nutrition-batch`, BODY.capFanout, {
        headers: credentiallessHeaders(),
        tags: { operation: 'nutritionDegraded' },
    });

    degradedTrend.add(res.timings.duration);

    check(
        res,
        {
            'nutritionDegraded 200': (r) => r.status === 200,
            'nutritionDegraded answers every seeded recipe': (r) =>
                Object.keys(nutritionMap(r)).length === MAX_NUTRITION_RECIPE_IDS,
            'nutritionDegraded states are all TERMINAL': (r) =>
                Object.values(nutritionMap(r)).every(
                    (entry) => entry.state === 'known' || entry.state === 'unaccounted',
                ),
        },
        { assertion: 'resolved' },
    );

    sleep(1);
}
