// Pull-from-source load scenario (W8-a.8 / FR-011).
//
// Load-tests the collection pull-from-source pair: the READ-ONLY preview
// (`POST …/pull-from-source/preview`, which computes the `{added,removed,unchanged}` diff and mutates
// nothing) and the COMMIT (`POST …/pull-from-source`, which applies it). `setup()` seeds a SOURCE
// collection and CLONES it (FR-011 clone semantics) — mirroring tests/e2e/pullFromSource.e2e.test.ts's
// fixture, where a source with pending recipes the clone doesn't have yet is what preview/commit act on.
// Each commit iteration then adds a fresh recipe to the source first, so the clone always has a genuine
// pending update to pull rather than measuring an already-converged (empty-diff) pair.
//
// The commit calls WITHOUT an echoed `previewedDiff` — the endpoint's documented "apply directly, no
// drift guard" mode (collections.schemas.ts's `pullCommitSchema`: "Absent → apply directly, no drift
// guard, back-compatible"). Echoing a previewed diff under concurrent VUs hitting the SAME clone would
// race into spurious 409 PULL_DRIFT responses (decision 7's own-clone-drift guard); omitting it avoids
// that entirely, and `addRecipes` is ON CONFLICT DO NOTHING so concurrent commits stay safe.
//
// Preview and commit both budget against SC009_P95_MS, per sc009ReadWrite.load.js's precedent of
// holding one core-CRUD 500ms p95 bar across both read and write recipe/collection endpoints.
//
//   k6 run \
//     -e RECIPE_API_BASE_URL=https://recipe.commise.app \
//     -e RECIPE_LOAD_TEST_TOKEN=$TOKEN \
//     packages/services/recipe-service/tests/load/pullFromSource.load.js

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

const previewTrend = new Trend('pull_preview_duration', true);
const commitTrend = new Trend('pull_commit_duration', true);

// Commits do more work per iteration (create a recipe + add it to the source, THEN commit) than a bare
// preview read, so — mirroring sc009-read-write's read/write split — they ramp to half the peak.
const commitPeak = Math.max(1, Math.ceil(PEAK_VUS / 2));

export const options = {
    scenarios: {
        preview: {
            executor: 'ramping-vus',
            exec: 'previewPath',
            startVUs: 0,
            stages: rampStages(PEAK_VUS),
            tags: { pull: 'preview' },
        },
        commit: {
            executor: 'ramping-vus',
            exec: 'commitPath',
            startVUs: 0,
            stages: rampStages(commitPeak),
            tags: { pull: 'commit' },
        },
    },
    thresholds: {
        // Preview is read-only (a diff over two membership id sets, in a read-only transaction).
        'http_req_duration{operation:previewPull}': [`p(95)<${SC009_P95_MS}`],
        // Commit applies the diff — the same write budget save-under-archive holds recipe saves to.
        'http_req_duration{operation:commitPull}': [`p(95)<${SC009_P95_MS}`],
        http_req_failed: [{ threshold: 'rate<0.01', abortOnFail: true, delayAbortEval: '30s' }],
    },
};

// Seed one SOURCE collection (public, so any caller can clone it) with a starting recipe, then CLONE it —
// the clone starts in sync (FR-011 `clone_seed`). Every commit iteration adds a fresh recipe to the
// source afterwards, so there is always a genuine pending pull for both scenarios to exercise.
export function setup() {
    const seedRecipe = http.post(
        `${BASE_URL}/api/v1/recipes`,
        JSON.stringify({ ...makeRecipePayload('pull-seed'), visibility: 'public' }),
        { headers: jsonHeaders(), tags: { operation: 'seedRecipe' } },
    );
    const seedRecipeId = seedRecipe.status === 201 ? seedRecipe.json('id') : null;

    const source = http.post(
        `${BASE_URL}/api/v1/collections`,
        JSON.stringify({ name: 'Pull load source', visibility: 'public' }),
        { headers: jsonHeaders(), tags: { operation: 'seedSourceCollection' } },
    );
    const sourceId = source.status === 201 ? source.json('id') : null;

    if (sourceId && seedRecipeId) {
        http.post(`${BASE_URL}/api/v1/collections/${sourceId}/recipes`, JSON.stringify({ recipeId: seedRecipeId }), {
            headers: jsonHeaders(),
            tags: { operation: 'seedSourceMembership' },
        });
    }

    let cloneId = null;

    if (sourceId) {
        const clone = http.post(`${BASE_URL}/api/v1/collections/${sourceId}/clone`, null, {
            headers: authHeaders(),
            tags: { operation: 'seedClone' },
        });
        cloneId = clone.status === 201 ? clone.json('id') : null;
    }

    return { sourceId, cloneId };
}

export function previewPath(data) {
    const cloneId = data && data.cloneId;

    if (!cloneId) {
        sleep(1);

        return;
    }

    const res = http.post(`${BASE_URL}/api/v1/collections/${cloneId}/pull-from-source/preview`, null, {
        headers: authHeaders(),
        tags: { operation: 'previewPull' },
    });
    previewTrend.add(res.timings.duration);
    check(res, { 'previewPull 200': (r) => r.status === 200 });
    sleep(1);
}

export function commitPath(data) {
    const sourceId = data && data.sourceId;
    const cloneId = data && data.cloneId;

    if (!sourceId || !cloneId) {
        sleep(1);

        return;
    }

    // Give this commit something genuine to pull: a fresh recipe added to the source that the clone
    // does not have yet.
    const recipe = http.post(
        `${BASE_URL}/api/v1/recipes`,
        JSON.stringify({ ...makeRecipePayload(`pull-${__VU}-${__ITER}`), visibility: 'public' }),
        { headers: jsonHeaders(), tags: { operation: 'createPendingRecipe' } },
    );
    const recipeId = recipe.status === 201 ? recipe.json('id') : null;

    if (recipeId) {
        http.post(`${BASE_URL}/api/v1/collections/${sourceId}/recipes`, JSON.stringify({ recipeId }), {
            headers: jsonHeaders(),
            tags: { operation: 'addPendingRecipe' },
        });
    }

    // No `previewedDiff` echoed — apply directly (the documented back-compatible mode), so concurrent
    // commits against the same clone never race into a 409 PULL_DRIFT.
    const commit = http.post(`${BASE_URL}/api/v1/collections/${cloneId}/pull-from-source`, JSON.stringify({}), {
        headers: jsonHeaders(),
        tags: { operation: 'commitPull' },
    });
    commitTrend.add(commit.timings.duration);
    check(commit, { 'commitPull 200': (r) => r.status === 200 });
    sleep(1);
}
