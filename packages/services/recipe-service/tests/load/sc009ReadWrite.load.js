// SC-009 read/write load scenario.
//
// @loadTier deployed-capable — every VU seeds the one recipe it reads over the API, under its own pool identity
//
// ⛔ ITS RECIPES ARE PRIVATE, SO EACH READER READS ITS OWN (owner ruling 2026-09-13, `k6WriteContainment.test.ts`).
// This used to create ONE public seed in `setup()` — as one pool identity — and have every VU, as other
// identities, read it. A public load-test recipe is served to real users' discovery the moment it lands, so the
// seed is now private and PER VU: a private recipe answers 404 to anyone but its owner, which a shared seed read by
// twenty identities would turn into a 95% failure rate. The operation measured is unchanged — a by-id read of a
// published recipe — and so is the per-identity spread that keeps the per-USER limiter out of the measurement.
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
    resolveSeedIngredients,
    rampStages,
    PEAK_VUS,
    SC009_P95_MS,
    whenSubstrate,
    PACE_SECONDS,
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
        // Abort early if the service is broadly erroring rather than burning the whole run.
        http_req_failed: [{ threshold: 'rate<0.01', abortOnFail: true, delayAbortEval: '30s' }],
        // ⛔ A correctness gate on every profile: a VU whose own seed could not be created records a FAILED
        // check (`vuSeed`), so a run whose readers read nothing cannot report green.
        checks: ['rate>0.99'],
        // ⚠️ REPORTED, not gated, on the deployed profile — see `whenSubstrate` in lib/common.js.
        ...whenSubstrate({
            // SC-009: p95 <= 500ms on recipe read/list/create.
            'http_req_duration{operation:listRecipes}': [`p(95)<${SC009_P95_MS}`],
            'http_req_duration{operation:getRecipe}': [`p(95)<${SC009_P95_MS}`],
            'http_req_duration{operation:createRecipe}': [`p(95)<${SC009_P95_MS}`],
        }),
    },
};

// Seed one recipe once so the get-by-id path has a stable target id.
export function setup() {
    return { ingredients: resolveSeedIngredients() };
}

// This VU's own seed recipe id, once created. Module scope is per-VU in k6.
let seedId = null;

/**
 * The recipe this VU reads — its OWN, created on first use and cached only once it exists.
 *
 * ⚠️ Tagged `seedRecipe`, so the one create per VU lands outside the `getRecipe` trend. A refused create is a
 * FAILED check rather than a silent skip, and the next iteration tries again.
 *
 * @param data - The setup payload, for the resolved catalog ids.
 * @returns The id, or null when this attempt could not create it.
 */
function vuSeed(data) {
    if (seedId !== null) {
        return seedId;
    }

    const res = http.post(
        `${BASE_URL}/api/v1/recipes`,
        JSON.stringify(makeRecipePayload(`seed-${__VU}`, data.ingredients)),
        { headers: jsonHeaders(), tags: { operation: 'seedRecipe' } },
    );
    let created = null;

    if (res.status === 201) {
        try {
            created = res.json('id');
        } catch {
            created = null;
        }
    }

    check(res, { 'vu seed created': () => created !== null });
    seedId = created;

    return seedId;
}

export function readPath(data) {
    const list = http.get(`${BASE_URL}/api/v1/recipes?page=1&pageSize=20&sortBy=updatedAt`, {
        headers: authHeaders(),
        tags: { operation: 'listRecipes' },
    });

    // ⛔ ONLY THE ACCEPTED RESPONSE ENTERS THE LATENCY SERIES. A refusal — a 429 from the per-user
    // limiter, a 4xx from validation — is answered in microseconds without touching the database, so
    // folding it in DEFLATES p95 and makes a failing service look healthy. That is `journey.js`
    // invariant #2, and `pullFromSource` already carries the same guard.
    if (check(list, { 'listRecipes 200': (r) => r.status === 200 })) {
        listTrend.add(list.timings.duration);
    }

    const ownSeed = vuSeed(data);

    if (ownSeed) {
        const get = http.get(`${BASE_URL}/api/v1/recipes/${ownSeed}`, {
            headers: authHeaders(),
            tags: { operation: 'getRecipe' },
        });

        if (check(get, { 'getRecipe 200': (r) => r.status === 200 })) {
            getTrend.add(get.timings.duration);
        }
    }

    sleep(PACE_SECONDS);
}

export function writePath(data) {
    const res = http.post(
        `${BASE_URL}/api/v1/recipes`,
        JSON.stringify(makeRecipePayload(`${__VU}-${__ITER}`, data.ingredients)),
        {
            headers: jsonHeaders(),
            tags: { operation: 'createRecipe' },
        },
    );

    // ⛔ ONLY THE ACCEPTED RESPONSE ENTERS THE LATENCY SERIES. A refusal — a 429 from the per-user
    // limiter, a 4xx from validation — is answered in microseconds without touching the database, so
    // folding it in DEFLATES p95 and makes a failing service look healthy. That is `journey.js`
    // invariant #2, and `pullFromSource` already carries the same guard.
    if (check(res, { 'createRecipe 201': (r) => r.status === 201 })) {
        createTrend.add(res.timings.duration);
    }

    sleep(PACE_SECONDS);
}
