// Food-nutrition batch read scenario (`POST /api/v1/ingredients/food-nutrition`, plan 002 U9).
//
// @loadTier deployed-capable — its refs are synthetic ids no stage knows, so it needs no fixture, and it accepts found,
//   absent and unavailable alike
//
// Drives the per-100 g nutrition read the ingredient details dialog uses, under ramping concurrency. The route is a
// READ sent as a POST: it writes nothing, answers 200, and carries the read rate limit. Its cost is one indexed read of
// `food_lookups` beside one read of food, run concurrently.
//
// ⚠️ THE REFS ARE UNKNOWN ON PURPOSE, AND THAT IS NOT THE CHEAP CASE. A deployed stage holds no fixture this script
// could name, so every id is synthetic (`makeFoodNutritionRequest` in lib/common.js). Food's shared read misses an
// unknown root, so the gateway then asks food's per-caller authored read as well. Every request therefore pays both
// food round trips, which is the most food work one request can cost. A known food would cost one.
//
// Each entry must come back `found`, `absent` or `unavailable`. An unknown root is `absent` when food answered and
// `unavailable` when food could not be asked, and both are correct. The run reports the share of roots food answered
// (`ingredient_food_nutrition_food_answered`) without gating it, because food may be down during a run. A share near
// zero means the run measured the degraded path, not food.
//
// ⛔ A FOOD OUTAGE MUST NOT FAIL THIS READ. Food being down gives `unavailable` entries inside a 200, so the failure
// rate is gated strictly: a rising `http_req_failed` means food's failure reached the caller.
//
// ⚠️ THE REQUEST MUST CARRY A BEARER, OR FOOD IS NEVER ASKED. `FoodNutritionGateway` answers from its cache alone when
// it has no caller credential to forward, so every root would come back `unavailable` in microseconds. A deployed run
// sends each pool user's own bearer. A hand run under the dev-auth bypass has none, so it sends
// NUTRITION_FORWARD_BEARER instead (see lib/common.js).
//
//   k6 run \
//     -e RECIPE_API_BASE_URL=https://recipe.commise.app \
//     -e RECIPE_LOAD_TEST_TOKEN=$TOKEN \
//     packages/services/recipe-service/tests/load/ingredientFoodNutrition.load.js

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

import {
    BASE_URL,
    jsonHeaders,
    makeFoodNutritionRequest,
    rampStages,
    NUTRITION_BATCH_P95_MS,
    NUTRITION_FORWARD_BEARER,
    PACE_SECONDS,
    PEAK_VUS,
    SUMMARY_TREND_STATS,
    whenSubstrate,
} from './lib/common.js';

/**
 * The p95 budget, on the calibrated profile only. Shares the nutrition batch's budget: both are one read of food
 * through `FoodNutritionGateway` under the READ deadline, and this one costs at most two food requests where the
 * batch at its cap costs nine waves.
 *
 * ⚠️ It is a health bound, not a degradation bound. The READ deadline (`FOOD_NUTRITION_READ_DEADLINE_MS`) is longer
 * than this budget, so a food service that HANGS breaches it, while one that refuses does not. The failure-rate
 * threshold and the contract checks carry the degradation property.
 */
const FOOD_NUTRITION_P95_MS = Number(__ENV['RECIPE_FOOD_NUTRITION_P95_MS'] || NUTRITION_BATCH_P95_MS);

const REQUEST = makeFoodNutritionRequest();

// Serialized ONCE, in the init context, so the runner's own string building stays out of the measurement.
const BODY = JSON.stringify(REQUEST);

/** The key the service de-duplicates on. Tolerates a malformed entry, so a bad body fails a check, not the VU. */
function keyOf(ref) {
    return ref && typeof ref === 'object' ? `${ref.kind}:${ref.id}` : '';
}

/** One key per distinct ref sent, in order of first appearance: exactly the entries the contract promises. */
const EXPECTED_KEYS = [...new Set(REQUEST.refs.map(keyOf))].join('\n');

const OUTCOMES = ['found', 'absent', 'unavailable'];

const foodNutritionTrend = new Trend('ingredient_food_nutrition_duration', true);

// REPORTED, never gated: food may legitimately be down during a run.
const foodAnswered = new Rate('ingredient_food_nutrition_food_answered');

export const options = {
    summaryTrendStats: SUMMARY_TREND_STATS,
    scenarios: {
        foodNutrition: {
            executor: 'ramping-vus',
            exec: 'foodNutritionPath',
            startVUs: 0,
            stages: rampStages(PEAK_VUS),
            tags: { scenario: 'ingredient-food-nutrition' },
        },
    },
    thresholds: {
        // A food outage gives `unavailable` entries inside a 200. It must never surface as a failed request.
        http_req_failed: ['rate<0.01'],
        // The answer's shape is a fact a slow machine cannot change, so it is gated on every profile.
        'checks{assertion:contract}': ['rate>0.99'],
        // ⚠️ REPORTED, not gated, on the deployed profile — see `whenSubstrate` in lib/common.js.
        ...whenSubstrate({
            'http_req_duration{operation:ingredientFoodNutrition}': [`p(95)<${FOOD_NUTRITION_P95_MS}`],
        }),
    },
};

/** Headers that always forward a credential, so the gateway actually asks food. */
function forwardingHeaders() {
    const headers = jsonHeaders();

    if (!headers['Authorization']) {
        headers['Authorization'] = `Bearer ${NUTRITION_FORWARD_BEARER}`;
    }

    return headers;
}

/** The `entries` array, or `undefined` when the body is not the shape the contract promises. */
function entriesOf(res) {
    try {
        const entries = res.json('entries');

        return Array.isArray(entries) ? entries : undefined;
    } catch {
        return undefined;
    }
}

export function foodNutritionPath() {
    const res = http.post(`${BASE_URL}/api/v1/ingredients/food-nutrition`, BODY, {
        headers: forwardingHeaders(),
        tags: { operation: 'ingredientFoodNutrition' },
    });

    foodNutritionTrend.add(res.timings.duration);

    // REPORTED, never gated. On a deployed stage neither `http_req_failed` nor the contract checks count a 429, so this
    // is the one line of the summary that shows a run spent on the rate limiter (`analyticsIngest` once lost 43% of its
    // requests to it with `http_req_failed` at 0%).
    check(res, { 'food-nutrition not rate-limited': (r) => r.status !== 429 });

    // ⚠️ The rate limiter's 429 is the ONE answer excused from the contract: on a deployed stage it is expected, and it
    // is not the service failing. Every other status is checked, so a route that stopped answering 200 cannot leave
    // the gated checks with no samples and pass.
    if (res.status !== 429) {
        const entries = entriesOf(res);

        check(
            res,
            {
                'food-nutrition 200': (r) => r.status === 200,
                // No shared cache may keep an answer that varies by caller.
                'food-nutrition is private, no-store': (r) => r.headers['Cache-Control'] === 'private, no-store',
                'food-nutrition answers one entry per distinct ref, in order of first appearance': () =>
                    entries !== undefined &&
                    entries.map((entry) => keyOf(entry && entry.ref)).join('\n') === EXPECTED_KEYS,
                'food-nutrition entries are found, absent or unavailable': () =>
                    entries !== undefined && entries.every((entry) => entry && OUTCOMES.indexOf(entry.outcome) !== -1),
            },
            { assertion: 'contract' },
        );

        for (const entry of entries || []) {
            // Only a root is ever asked of food; a variant is answered here without it.
            if (entry && entry.ref && entry.ref.kind === 'root') {
                foodAnswered.add(entry.outcome !== 'unavailable');
            }
        }
    }

    sleep(PACE_SECONDS);
}
