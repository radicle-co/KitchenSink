// SC-009 read/write load scenario.
//
// @loadTier deployed-capable — self-seeding setup() over the API, and its recipes are public so a pooled reader can
//   fetch them
//
// Ramps concurrent VUs against the core recipe read (list + get-by-id) and write (create) paths and
// asserts, via `options.thresholds`, that http_req_duration p95 stays <= 500ms per operation. A
// threshold breach exits k6 non-zero, failing the run (and any CI job invoking it).
//
//   k6 run \
//     -e RECIPE_API_BASE_URL=https://recipe.commise.app \
//     -e RECIPE_LOAD_TEST_TOKEN=$TOKEN \
//     packages/services/recipe-service/tests/load/sc009ReadWrite.load.js

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

import {
    BASE_URL,
    authHeaders,
    jsonHeaders,
    makeRecipePayload,
    rampStages,
    PEAK_VUS,
    SC009_P95_MS,
} from './lib/common.js';

const listTrend = new Trend('recipe_list_duration', true);
const getTrend = new Trend('recipe_get_duration', true);
const createTrend = new Trend('recipe_create_duration', true);

// Reads carry the bulk of the load; writes ramp to half the peak.
const writePeak = Math.max(1, Math.ceil(PEAK_VUS / 2));

export const options = {
    scenarios: {
        reads: {
            executor: 'ramping-vus',
            exec: 'readPath',
            startVUs: 0,
            stages: rampStages(PEAK_VUS),
            tags: { sc009: 'read' },
        },
        writes: {
            executor: 'ramping-vus',
            exec: 'writePath',
            startVUs: 0,
            stages: rampStages(writePeak),
            tags: { sc009: 'write' },
        },
    },
    thresholds: {
        // SC-009: p95 <= 500ms on recipe read/list/create.
        'http_req_duration{operation:listRecipes}': [`p(95)<${SC009_P95_MS}`],
        'http_req_duration{operation:getRecipe}': [`p(95)<${SC009_P95_MS}`],
        'http_req_duration{operation:createRecipe}': [`p(95)<${SC009_P95_MS}`],
        // Abort early if the service is broadly erroring rather than burning the whole run.
        http_req_failed: [{ threshold: 'rate<0.01', abortOnFail: true, delayAbortEval: '30s' }],
    },
};

// Seed one recipe once so the get-by-id path has a stable target id.
export function setup() {
    const res = http.post(`${BASE_URL}/api/v1/recipes`, JSON.stringify(makeRecipePayload('seed')), {
        headers: jsonHeaders(),
        tags: { operation: 'seedRecipe' },
    });
    let seedId = null;

    if (res.status === 201) {
        try {
            seedId = res.json('id');
        } catch {
            seedId = null;
        }
    }

    return { seedId };
}

export function readPath(data) {
    const list = http.get(`${BASE_URL}/api/v1/recipes?page=1&pageSize=20&sortBy=updatedAt`, {
        headers: authHeaders(),
        tags: { operation: 'listRecipes' },
    });
    listTrend.add(list.timings.duration);
    check(list, { 'listRecipes 200': (r) => r.status === 200 });

    const seedId = data && data.seedId;

    if (seedId) {
        const get = http.get(`${BASE_URL}/api/v1/recipes/${seedId}`, {
            headers: authHeaders(),
            tags: { operation: 'getRecipe' },
        });
        getTrend.add(get.timings.duration);
        check(get, { 'getRecipe 200': (r) => r.status === 200 });
    }

    sleep(1);
}

export function writePath() {
    const res = http.post(`${BASE_URL}/api/v1/recipes`, JSON.stringify(makeRecipePayload(`${__VU}-${__ITER}`)), {
        headers: jsonHeaders(),
        tags: { operation: 'createRecipe' },
    });
    createTrend.add(res.timings.duration);
    check(res, { 'createRecipe 201': (r) => r.status === 201 });
    sleep(1);
}
