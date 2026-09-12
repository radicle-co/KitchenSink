// Search-latency load scenario.
//
// @loadTier deployed-capable — read-only with literal queries; it needs a seeded world but no local substrate
//
// Drives the full-text recipe search endpoint (GET /api/v1/search/recipes) under ramping concurrency with
// a mix of queries, cuisines, and repeated dietary-flag filters, and asserts search p95 < 2s via
// `options.thresholds`. A breach exits k6 non-zero and fails the run.
//
// The `foodFilter` scenario runs AFTER the plain search (`startTime`), so neither number contains the other's
// contention. It filters on six roots, the published cap (`MAX_SEARCH_FOOD_FILTERS`), and the service expands each
// root to its live variants with one food read per root, in one wave, as the caller (curated U9). The ids are
// synthetic, so food answers each one unknown: the expansion still costs its six reads, which is the cost measured.
//
// ⚠️ The filter needs a BEARER, or the service refuses it with a 502 rather than run a partial filter. A deployed
// run sends each pool user's own bearer; a hand run under the dev-auth bypass sends NUTRITION_FORWARD_BEARER.
//
//   k6 run \
//     -e RECIPE_API_BASE_URL=https://recipe.commise.app \
//     -e RECIPE_LOAD_TEST_TOKEN=$TOKEN \
//     packages/services/recipe-service/tests/load/searchLatency.load.js

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

import {
    BASE_URL,
    authHeaders,
    rampSeconds,
    rampStages,
    NUTRITION_FORWARD_BEARER,
    PEAK_VUS,
    SEARCH_P95_MS,
    whenSubstrate,
    PACE_SECONDS,
} from './lib/common.js';

const searchTrend = new Trend('recipe_search_duration', true);
const foodFilterTrend = new Trend('recipe_search_food_filter_duration', true);

/** Six roots: the published `MAX_SEARCH_FOOD_FILTERS`, so each request pays the widest expansion wave. */
const FOOD_FILTER_PARAMS = Array.from({ length: 6 }, (_, index) => `foodIds=k6-load-root-${index}`).join('&');

const QUERIES = ['chicken', 'pasta', 'salad', 'soup', 'vegan curry', 'chocolate cake', 'roast'];
const CUISINES = ['italian', 'thai', 'mexican', 'indian', ''];

export const options = {
    scenarios: {
        search: {
            executor: 'ramping-vus',
            exec: 'searchPath',
            startVUs: 0,
            stages: rampStages(PEAK_VUS),
            tags: { scenario: 'search' },
        },
        foodFilter: {
            executor: 'ramping-vus',
            exec: 'foodFilterPath',
            startVUs: 0,
            stages: rampStages(PEAK_VUS),
            startTime: `${rampSeconds()}s`,
            tags: { scenario: 'search-food-filter' },
        },
    },
    thresholds: {
        // One failure gate per scenario: the food filter's expansion depends on food, and a food blip that it refuses
        // with a 502 must not fail the plain search, which never asks food.
        'http_req_failed{operation:searchRecipes}': ['rate<0.01'],
        'http_req_failed{operation:searchRecipesByFood}': ['rate<0.01'],
        // ⚠️ REPORTED, not gated, on the deployed profile — see `whenSubstrate` in lib/common.js.
        ...whenSubstrate({
            // Search must return in < 2s.
            'http_req_duration{operation:searchRecipes}': [`p(95)<${SEARCH_P95_MS}`],
            'http_req_duration{operation:searchRecipesByFood}': [`p(95)<${SEARCH_P95_MS}`],
        }),
    },
};

export function searchPath() {
    const query = QUERIES[(__ITER + __VU) % QUERIES.length];
    const cuisine = CUISINES[__ITER % CUISINES.length];

    const params = [`query=${encodeURIComponent(query)}`, 'page=1', 'pageSize=20', 'sortBy=relevance'];

    if (cuisine) {
        params.push(`cuisine=${encodeURIComponent(cuisine)}`);
    }

    // Repeated (explode) query params, per the contract's array-style filters.
    params.push('dietaryFlags=vegetarian');
    params.push('tags=load-test');

    const res = http.get(`${BASE_URL}/api/v1/search/recipes?${params.join('&')}`, {
        headers: authHeaders(),
        tags: { operation: 'searchRecipes' },
    });
    searchTrend.add(res.timings.duration);
    check(res, {
        'searchRecipes 200': (r) => r.status === 200,
        'searchRecipes < 2s': (r) => r.timings.duration < SEARCH_P95_MS,
    });
    sleep(PACE_SECONDS);
}

/** Headers that always forward a credential, so the expansion can ask food. */
function forwardingHeaders() {
    const headers = authHeaders();

    if (!headers['Authorization']) {
        headers['Authorization'] = `Bearer ${NUTRITION_FORWARD_BEARER}`;
    }

    return headers;
}

export function foodFilterPath() {
    const res = http.get(`${BASE_URL}/api/v1/search/recipes?${FOOD_FILTER_PARAMS}&page=1&pageSize=20`, {
        headers: forwardingHeaders(),
        tags: { operation: 'searchRecipesByFood' },
    });
    foodFilterTrend.add(res.timings.duration);
    check(res, {
        // A 502 here means food could not answer for every root: the filter was refused, never run partially.
        'searchRecipesByFood 200': (r) => r.status === 200,
        'searchRecipesByFood < 2s': (r) => r.timings.duration < SEARCH_P95_MS,
    });
    sleep(PACE_SECONDS);
}
