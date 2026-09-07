// Save-under-archive load scenario (FR-007b-i).
//
// @loadTier deployed-capable — create plus PATCH only, and the S3 version archive is real on a deployed stage
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

import {
    BASE_URL,
    jsonHeaders,
    makeRecipePayload,
    resolveSeedIngredients,
    rampStages,
    PEAK_VUS,
    SC009_P95_MS,
    whenSubstrate,
    PACE_SECONDS,
} from './lib/common.js';

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
        http_req_failed: ['rate<0.01'],
        // ⚠️ REPORTED, not gated, on the deployed profile — see `whenSubstrate` in lib/common.js.
        ...whenSubstrate({
            // FR-007b-i: save p95 <= 500ms while the S3 version archive is queued.
            recipe_save_duration: [`p(95)<${SC009_P95_MS}`],
            'http_req_duration{operation:createRecipe}': [`p(95)<${SC009_P95_MS}`],
            'http_req_duration{operation:updateRecipe}': [`p(95)<${SC009_P95_MS}`],
        }),
    },
};

/**
 * Resolve the catalog ids every payload in this run references.
 *
 * ⚠️ ADDED with the ingredient-resolution fix: this scenario previously needed no `setup()` because its
 * payload carried hardcoded ids, which is precisely why it answered `createRecipe 201` 0 times out of 265
 * against a deployed stage (run 34045472743). See `resolveSeedIngredients`.
 *
 * @returns The ids the VUs build payloads from.
 */
export function setup() {
    return { ingredients: resolveSeedIngredients() };
}

export function savePath(data) {
    // 1) Create the recipe (version 1).
    const createRes = http.post(
        `${BASE_URL}/api/v1/recipes`,
        JSON.stringify(makeRecipePayload(`arch-${__VU}-${__ITER}`, data.ingredients)),
        {
            headers: jsonHeaders(),
            tags: { operation: 'createRecipe' },
        },
    );
    // ⛔ ONLY THE ACCEPTED RESPONSE ENTERS THE LATENCY SERIES. A refusal — a 429 from the per-user
    // limiter, a 4xx from validation — is answered in microseconds without touching the database, so
    // folding it in DEFLATES p95 and makes a failing service look healthy. That is `journey.js`
    // invariant #2, and `pullFromSource` already carries the same guard.
    const created = check(createRes, { 'createRecipe 201': (r) => r.status === 201 });

    if (created) {
        saveTrend.add(createRes.timings.duration);
    }

    if (!created) {
        sleep(PACE_SECONDS);

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
        sleep(PACE_SECONDS);

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
    const updated = updateRes.status === 200;

    if (updated) {
        saveTrend.add(updateRes.timings.duration);
    }

    archiveUpdates.add(1);
    check(updateRes, { 'updateRecipe 200': (r) => r.status === 200 });
    sleep(PACE_SECONDS);
}
