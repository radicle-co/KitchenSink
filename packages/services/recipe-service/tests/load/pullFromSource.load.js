// Pull-from-source load scenario (W8-a.8 / FR-011).
//
// @loadTier deployed-capable — setup() builds its whole world over HTTP, so a deployed stage can present it
//
// ⛔ EVERY WRITE IS PRIVATE (owner ruling 2026-09-13, `k6WriteContainment.test.ts`). The source collection, its
// recipes and the clone all stay inside the VU's own pool user's library: a PUBLIC source was discoverable by
// real users for as long as it existed. Cloning a private source is allowed for its OWNER
// (`collections.service.ts` `cloneCollection`), and the pull reads the source through the owner's eyes, so the
// subject — a clone with genuine pending content — is unchanged.
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
import { Counter, Trend } from 'k6/metrics';

import {
    BASE_URL,
    authHeaders,
    jsonHeaders,
    makeRecipePayload,
    resolveSeedIngredients,
    rampStages,
    PEAK_VUS,
    SC009_P95_MS,
    whenSubstrate,
    PACE_SECONDS,
} from './lib/common.js';
// ⛔ Relative across the package boundary for the reason `lib/common.js` gives for `session.js`: k6 resolves
// modules on the filesystem and rejects bare specifiers.
// eslint-disable-next-line import-x/no-relative-packages
import { reusableClonePair } from '../../../../tools/loadtest/k6/collectionFixture.js';

const previewTrend = new Trend('pull_preview_duration', true);
const commitTrend = new Trend('pull_commit_duration', true);
/**
 * Commits the per-USER write limiter refused.
 *
 * ⛔ COUNTED AND SURFACED, NEVER THRESHOLDED — the posture `deployedOrigin.load.js` sets out. `commitPath`
 * issues three writes per iteration, so at the deployed pace it offers ~60 writes/min/user against a
 * `RATE_LIMIT_WRITE` default of 300 — the limiter is not expected to engage, but when a stage's configured
 * limit is lower it will, and a 429 is the service working. What would be a defect is a 5xx, which still fails.
 */
const commitThrottled = new Counter('pull_commit_throttled_429');

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
        http_req_failed: [{ threshold: 'rate<0.01', abortOnFail: true, delayAbortEval: '30s' }],
        // ⛔ A CORRECTNESS gate, carried on every profile: a VU whose fixture could not be built records a FAILED
        // check (see `vuFixture`), so a scenario that measured neither preview nor commit cannot report green.
        // `http_req_failed` alone could not see that: the fixture build's refused requests are a handful against
        // a whole run of healthy ones.
        checks: ['rate>0.99'],
        // ⚠️ REPORTED, not gated, on the deployed profile — see `whenSubstrate` in lib/common.js.
        ...whenSubstrate({
            // Preview is read-only (a diff over two membership id sets, in a read-only transaction).
            'http_req_duration{operation:previewPull}': [`p(95)<${SC009_P95_MS}`],
            // Commit applies the diff — the same write budget save-under-archive holds recipe saves to.
            'http_req_duration{operation:commitPull}': [`p(95)<${SC009_P95_MS}`],
        }),
    },
};

// ⛔ THE FIXTURE IS PER-VU, AND OWNERSHIP IS WHY.
//
// `setup()` runs at `__VU === 0`, so `vuToken()` resolves it to ONE pool identity while the VUs run as
// DIFFERENT ones — and every write on this path is owner-scoped. Measured against a live stage:
//
//   * `POST /collections/{id}/pull-from-source/preview` by a non-owner -> 403 NOT_OWNER
//   * `POST /collections/{id}/recipes`                  by a non-owner -> 403
//   * cloning a PUBLIC collection                        by anyone     -> 201, and the caller owns the clone
//
// So a single setup-owned source+clone is usable by exactly one VU: with the 10-identity pool, nine of
// ten VUs 403'd and the scenario reported `http_req_failed 83.43%` (run 34045472743). That is not a
// service defect and never was — it is the distinct-user pool meeting a fixture owned by one user. Before
// the pool every VU shared one token, so setup and the VUs were the same person and this could not arise.
//
// Each VU therefore builds its OWN source + clone, once, and measures against that. The scenario's
// subject is unchanged — a clone with genuinely pending content, previewed and committed under load — and
// the per-identity spread that keeps the per-USER rate limiter out of the measurement is preserved.
export function setup() {
    return { ingredients: resolveSeedIngredients() };
}

// This VU's own source + clone, cached once BUILT. Module scope is per-VU in k6, so each VU gets one.
let fixture = null;

/**
 * This VU's own source + clone — cached only when both exist.
 *
 * ⛔ AN UNBUILT FIXTURE IS NEVER CACHED, AND IT IS A FAILED CHECK. This used to cache `{ sourceId: null,
 * cloneId: null }` the first time a build step was refused, after which the VU slept through every iteration
 * of the run measuring nothing — and nothing counted that: the refused request was one sample against a run of
 * healthy ones, so `http_req_failed` stayed under its threshold and the scenario reported green. Now the failure
 * is a check the `checks` threshold gates, and the next iteration tries again — which is safe, because
 * `buildFixture` FINDS what an earlier attempt created before it creates anything.
 *
 * @param data - The setup payload, for the resolved catalog ids.
 * @returns `{ sourceId, cloneId }`, either of which may be null when this attempt could not build it.
 */
function vuFixture(data) {
    if (fixture !== null) {
        return fixture;
    }

    const built = buildFixture(data);
    const complete = Boolean(built.sourceId) && Boolean(built.cloneId);

    check(built, { 'vu fixture built': () => complete });

    if (complete) {
        fixture = built;
    }

    return built;
}

/**
 * This VU's own source collection and its clone — FOUND if an earlier run left them, created otherwise.
 *
 * ⛔ FIND BEFORE CREATE. The pool identities persist across runs and nothing reclaims their collections, so
 * creating a fresh pair every run walked each pool user to `MAX_COLLECTIONS_PER_OWNER` (50): on run
 * 34782454327 the service answered 18 `409 COLLECTION_LIMIT_REACHED`, those were the 18 `http_req_failed`
 * of 58, and `abortOnFail` stopped the scenario at 30 s. `reusableClonePair` owns the matching rule and is
 * unit-tested in `packages/tools/loadtest`. Neither widening `expectedStatuses` to 409 nor raising the cap
 * (REQ-049b) is the fix — the first hides a scenario that measured nothing, the second edits a product rule.
 *
 * ⚠️ Tagged `seed*` so the build cost lands OUTSIDE the `previewPull` / `commitPull` trends the
 * thresholds gate. It is one extra iteration's work per VU, not per iteration.
 *
 * @param data - The setup payload, for the resolved catalog ids.
 * @returns `{ sourceId, cloneId }`, or nulls for whatever this attempt could not build.
 */
function buildFixture(data) {
    const name = `Pull load source ${__VU}`;
    // The cap is 50 and the listing pages to 100, so one page is the whole library.
    const library = http.get(`${BASE_URL}/api/v1/collections?pageSize=100`, {
        headers: authHeaders(),
        tags: { operation: 'seedFindCollections' },
    });
    // A refused listing leaves nothing to reuse, and creating blind is how the cap was reached — so the VU
    // measures nothing this iteration rather than walking its user further toward it — and `vuFixture` records
    // that as a failed check.
    const existing = library.status === 200 ? reusableClonePair(library.json(), name) : null;

    if (existing === null) {
        return { sourceId: null, cloneId: null };
    }

    let sourceId = existing.sourceId;

    if (sourceId === null) {
        const recipe = http.post(
            `${BASE_URL}/api/v1/recipes`,
            JSON.stringify(makeRecipePayload(`pull-seed-${__VU}`, data.ingredients)),
            { headers: jsonHeaders(), tags: { operation: 'seedRecipe' } },
        );
        const recipeId = recipe.status === 201 ? recipe.json('id') : null;

        const source = http.post(`${BASE_URL}/api/v1/collections`, JSON.stringify({ name, visibility: 'private' }), {
            headers: jsonHeaders(),
            tags: { operation: 'seedSourceCollection' },
        });
        sourceId = source.status === 201 ? source.json('id') : null;

        if (sourceId && recipeId) {
            http.post(`${BASE_URL}/api/v1/collections/${sourceId}/recipes`, JSON.stringify({ recipeId }), {
                headers: jsonHeaders(),
                tags: { operation: 'seedSourceMembership' },
            });
        }
    }

    let cloneId = existing.cloneId;

    if (sourceId && cloneId === null) {
        // The clone starts in sync (FR-011 `clone_seed`); `commitPath` then adds to the source, so there
        // is always a genuine pending pull.
        const clone = http.post(`${BASE_URL}/api/v1/collections/${sourceId}/clone`, null, {
            headers: authHeaders(),
            tags: { operation: 'seedClone' },
        });
        cloneId = clone.status === 201 ? clone.json('id') : null;
    }

    return { sourceId, cloneId };
}

export function previewPath(data) {
    const { cloneId } = vuFixture(data);

    if (!cloneId) {
        sleep(PACE_SECONDS);

        return;
    }

    const res = http.post(`${BASE_URL}/api/v1/collections/${cloneId}/pull-from-source/preview`, null, {
        headers: authHeaders(),
        tags: { operation: 'previewPull' },
    });
    previewTrend.add(res.timings.duration);
    check(res, { 'previewPull 200': (r) => r.status === 200 });
    sleep(PACE_SECONDS);
}

export function commitPath(data) {
    const { sourceId, cloneId } = vuFixture(data);

    if (!sourceId || !cloneId) {
        sleep(PACE_SECONDS);

        return;
    }

    // Give this commit something genuine to pull: a fresh recipe added to the source that the clone
    // does not have yet.
    const recipe = http.post(
        `${BASE_URL}/api/v1/recipes`,
        JSON.stringify(makeRecipePayload(`pull-${__VU}-${__ITER}`, data.ingredients)),
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

    // ⛔ THE TREND RECORDS ONLY THE ACCEPTED COMMIT. A 429 is refused in microseconds without touching the
    // database, so folding it into the latency series DEFLATES p95 — the failure `journey.js` invariant #2
    // was written against ("recording a fast rejection would make a failing service look healthy"). The
    // throttles are not lost; they are counted beside the percentile.
    if (commit.status === 429) {
        commitThrottled.add(1);
    } else {
        commitTrend.add(commit.timings.duration);
    }

    check(commit, { 'commitPull accepted or throttled': (r) => r.status === 200 || r.status === 429 });
    sleep(PACE_SECONDS);
}
