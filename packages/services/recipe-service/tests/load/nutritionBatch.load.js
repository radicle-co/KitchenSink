// Deferred-nutrition batch load scenario (`POST /api/v1/recipes/nutrition-batch`).
//
// This endpoint is the one read whose cost is a FAN-OUT rather than a query: it resolves N recipes' lines
// in one database round trip and then asks the food service for their distinct foods, splitting at food's
// 100-id per-request cap into SEQUENTIAL sub-requests. So the thing to measure is not "is a batch read
// fast" — it is whether the batch stays inside a card grid's budget as the id list grows toward the
// published `MAX_NUTRITION_RECIPE_IDS` cap, which is exactly where the sequential chunking starts to bite.
//
// Two scenarios, deliberately, because they fail differently:
//   - `pageBatch` — a realistic page (20 ids). This is what every list/search surface will actually send,
//     and it must be comfortably inside the standard read budget.
//   - `capBatch` — the PUBLISHED cap. If the cap cannot be served inside its budget, the cap is a promise
//     the service does not keep, and a client that chunked at it gets a timeout instead of an answer.
//
// ⛔ WHAT `capBatch` DOES **NOT** MEASURE, stated so nobody reads it as broader proof than it is. It pads to
// the cap with ids that resolve to no recipe, so it measures REQUEST WIDTH (body size, the `IN (…)` read,
// the response map) at the cap — not FAN-OUT WIDTH. The endpoint's real tail is the number of DISTINCT
// FOODS a batch names: the gateway splits at food's 100-id cap and issues those chunks SEQUENTIALLY, so the
// food time is `ceil(distinctFoods / 100) × food latency`. Measured locally against a 20 ms stub: 20 ids /
// 20 foods → 1 call ≈ 53 ms; 100 ids / 100 foods → 2 calls ≈ 32 ms; 250 ids / 250 foods → 3 calls ≈ 76 ms.
// The seeded catalog here has only a handful of ingredients, so this script cannot manufacture hundreds of
// distinct foods; widening it to do so (or making the gateway's chunk loop concurrent) is recorded as
// follow-up work rather than silently implied by a green run.
//
// ⚠️ The CI job points `FOOD_SERVICE_URL` at a port with nothing listening, so this measures the DEGRADED
// path (cold cache, food unreachable) — the honest worst case for a card grid during a food outage, and
// the one where the endpoint must still answer rather than hang. A run against a reachable food service
// measures the warm path instead; both must satisfy the same threshold, which is why the budget is stated
// as a bound rather than derived from a happy-path measurement.
//
//   k6 run \
//     -e RECIPE_API_BASE_URL=https://recipe.commise.app \
//     -e RECIPE_LOAD_TEST_TOKEN=$TOKEN \
//     packages/services/recipe-service/tests/load/nutritionBatch.load.js

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

import {
    BASE_URL,
    jsonHeaders,
    makeRecipePayload,
    rampStages,
    MAX_NUTRITION_RECIPE_IDS,
    NUTRITION_BATCH_P95_MS,
    NUTRITION_PAGE_SIZE,
    PEAK_VUS,
} from './lib/common.js';

const pageTrend = new Trend('recipe_nutrition_page_duration', true);
const capTrend = new Trend('recipe_nutrition_cap_duration', true);

// The cap scenario is deliberately a fraction of the peak: it is a tail-behaviour probe, not a
// steady-state one, and running it at full concurrency would measure the runner rather than the service.
const capPeak = Math.max(1, Math.ceil(PEAK_VUS / 10));

export const options = {
    scenarios: {
        pageBatch: {
            executor: 'ramping-vus',
            exec: 'pageBatchPath',
            startVUs: 0,
            stages: rampStages(PEAK_VUS),
            tags: { scenario: 'nutrition-page' },
        },
        capBatch: {
            executor: 'ramping-vus',
            exec: 'capBatchPath',
            startVUs: 0,
            stages: rampStages(capPeak),
            tags: { scenario: 'nutrition-cap' },
        },
    },
    thresholds: {
        'http_req_duration{operation:nutritionBatchPage}': [`p(95)<${NUTRITION_BATCH_P95_MS}`],
        'http_req_duration{operation:nutritionBatchCap}': [`p(95)<${NUTRITION_BATCH_P95_MS}`],
        // ⛔ The strictest assertion in this file. A food outage must DEGRADE this endpoint (every recipe
        // answers `unaccounted`), never FAIL it — the wire union has no `pending` member precisely so a
        // card can always stop waiting. A non-2xx here means the dependency's failure reached the caller.
        http_req_failed: ['rate<0.01'],
    },
};

// Seed a handful of real recipes once, so the batch asks about ids that actually resolve to lines. The
// ids are reused (and padded with unknown ids for the cap scenario), because an id the caller may not read
// is OMITTED rather than rejected — that is the endpoint's contract, and it keeps the cap probe honest
// without seeding 500 recipes.
export function setup() {
    const ids = [];

    for (let index = 0; index < NUTRITION_PAGE_SIZE; index += 1) {
        const res = http.post(`${BASE_URL}/api/v1/recipes`, JSON.stringify(makeRecipePayload(`nutrition-${index}`)), {
            headers: jsonHeaders(),
            tags: { operation: 'seedNutritionRecipe' },
        });

        if (res.status === 201) {
            try {
                ids.push(res.json('id'));
            } catch {
                // A malformed body here is not this scenario's subject; the batch below simply asks about
                // fewer ids, and `http_req_failed` still governs whether the run is meaningful.
            }
        }
    }

    return { ids };
}

/** Ask for the seeded page — the request shape every card grid will actually send. */
export function pageBatchPath(data) {
    const res = http.post(`${BASE_URL}/api/v1/recipes/nutrition-batch`, JSON.stringify({ recipeIds: data.ids }), {
        headers: jsonHeaders(),
        tags: { operation: 'nutritionBatchPage' },
    });

    pageTrend.add(res.timings.duration);
    check(res, {
        'nutritionBatchPage 200': (r) => r.status === 200,
        'nutritionBatchPage answers every readable id': (r) => {
            try {
                return Object.keys(r.json('nutrition') || {}).length === data.ids.length;
            } catch {
                return false;
            }
        },
    });
    sleep(1);
}

/** Ask at the published cap — the id list a client that chunked at `MAX_NUTRITION_RECIPE_IDS` would send. */
export function capBatchPath(data) {
    const recipeIds = data.ids.slice();

    // Pad to the cap with well-formed ids that resolve to nothing. They are OMITTED from the response, so
    // this measures the read + fan-out at full width without needing 500 seeded recipes.
    for (let index = recipeIds.length; index < MAX_NUTRITION_RECIPE_IDS; index += 1) {
        recipeIds.push(`00000000-0000-4000-8000-${String(index).padStart(12, '0')}`);
    }

    const res = http.post(`${BASE_URL}/api/v1/recipes/nutrition-batch`, JSON.stringify({ recipeIds }), {
        headers: jsonHeaders(),
        tags: { operation: 'nutritionBatchCap' },
    });

    capTrend.add(res.timings.duration);
    check(res, {
        'nutritionBatchCap 200': (r) => r.status === 200,
        // The cap is the published limit, so exactly-at-the-cap must be ACCEPTED. A 400 here would mean
        // the service rejects the list length its own contract tells clients to chunk to.
        'nutritionBatchCap accepts the published cap': (r) => r.status !== 400,
    });
    sleep(1);
}
