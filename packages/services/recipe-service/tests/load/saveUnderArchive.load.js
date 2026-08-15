// Save-under-archive load scenario (FR-007b-i).
//
// Each iteration creates a recipe (version 1) and then PATCHes it. Every update supersedes a prior
// version, which the service enqueues to the S3 version-archive asynchronously. The requirement is
// that the *save response* never blocks on that archive: recipe-save p95 must stay <= 500ms even
// while archives are queued. The `recipe_save_duration` trend and the per-operation http_req_duration
// thresholds enforce this — a breach exits k6 non-zero and fails the run.
//
//   k6 run \
//     -e RECIPE_API_BASE_URL=https://recipe.commise.app \
//     -e RECIPE_LOAD_TEST_TOKEN=$TOKEN \
//     packages/services/recipe-service/tests/load/saveUnderArchive.load.js

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Counter } from 'k6/metrics';

import { BASE_URL, jsonHeaders, makeRecipePayload, rampStages, PEAK_VUS, SC009_P95_MS } from './lib/common.js';

// Combined create+update save latency — the metric FR-007b-i is stated against.
const saveTrend = new Trend('recipe_save_duration', true);
const archiveUpdates = new Counter('recipe_archive_updates');

export const options = {
    scenarios: {
        save_under_archive: {
            executor: 'ramping-vus',
            exec: 'savePath',
            startVUs: 0,
            stages: rampStages(PEAK_VUS),
            tags: { scenario: 'save-under-archive' },
        },
    },
    thresholds: {
        // FR-007b-i: save p95 <= 500ms while the S3 version archive is queued.
        recipe_save_duration: [`p(95)<${SC009_P95_MS}`],
        'http_req_duration{operation:createRecipe}': [`p(95)<${SC009_P95_MS}`],
        'http_req_duration{operation:updateRecipe}': [`p(95)<${SC009_P95_MS}`],
        http_req_failed: ['rate<0.01'],
    },
};

export function savePath() {
    // 1) Create the recipe (version 1).
    const createRes = http.post(
        `${BASE_URL}/api/v1/recipes`,
        JSON.stringify(makeRecipePayload(`arch-${__VU}-${__ITER}`)),
        {
            headers: jsonHeaders(),
            tags: { operation: 'createRecipe' },
        },
    );
    saveTrend.add(createRes.timings.duration);
    const created = check(createRes, { 'createRecipe 201': (r) => r.status === 201 });

    if (!created) {
        sleep(1);

        return;
    }

    let id;
    let version = 1;

    try {
        id = createRes.json('id');
        version = createRes.json('version') || 1;
    } catch {
        id = null;
    }

    if (!id) {
        sleep(1);

        return;
    }

    // 2) Update it — supersedes version `version`, enqueuing that snapshot to the S3 archive. The
    //    PATCH response must return without waiting on the archive, keeping save p95 <= 500ms.
    const updateBody = {
        expectedVersion: version,
        title: `Updated Load Test Recipe ${__VU}-${__ITER}`,
        description: 'archive-queued update — measures save latency under async archival',
    };
    const updateRes = http.patch(`${BASE_URL}/api/v1/recipes/${id}`, JSON.stringify(updateBody), {
        headers: jsonHeaders(),
        tags: { operation: 'updateRecipe' },
    });
    saveTrend.add(updateRes.timings.duration);
    archiveUpdates.add(1);
    check(updateRes, { 'updateRecipe 200': (r) => r.status === 200 });
    sleep(1);
}
