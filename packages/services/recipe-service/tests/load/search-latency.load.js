// Search-latency load scenario.
//
// Drives the full-text recipe search endpoint (GET /api/v1/search/recipes) under ramping concurrency with
// a mix of queries, cuisines, and repeated dietary-flag filters, and asserts search p95 < 2s via
// `options.thresholds`. A breach exits k6 non-zero and fails the run.
//
//   k6 run \
//     -e RECIPE_API_BASE_URL=https://recipe.commise.app \
//     -e RECIPE_LOAD_TEST_TOKEN=$TOKEN \
//     packages/services/recipe-service/tests/load/search-latency.load.js

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

import { BASE_URL, authHeaders, rampStages, PEAK_VUS, SEARCH_P95_MS } from './lib/common.js';

const searchTrend = new Trend('recipe_search_duration', true);

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
    },
    thresholds: {
        // Search must return in < 2s.
        'http_req_duration{operation:searchRecipes}': [`p(95)<${SEARCH_P95_MS}`],
        http_req_failed: ['rate<0.01'],
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
    sleep(1);
}
