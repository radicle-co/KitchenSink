// ADR-0072 — the bulk import's advance command: POST /api/v1/import/{id}/advance.
//
// @loadTier deployed-capable — every input is minted per iteration (a private import of three small recipes), and its
//   only outside needs are the stage's own parse queue and food service, which a deployed stage has
//
// ⛔ AUTHORED, NEVER RUN BY A PULL REQUEST (owner rulings 2026-09-13): k6 runs only from a dispatch-only workflow, or by
// hand. This script adds no trigger of its own: the loadtest package derives its place from the marker above.
// An iteration spends three allowance units and starts three parse jobs. The pool users are TEST principals, which have no
// allowance limit (owner ruling 2026-11-15), so a long run is not throttled by it.
//
// Why this route earns its own scenario: one request does a BOUNDED STEP of unbounded work (pay up to ten items, start up to
// ten parse jobs, match up to twenty-five finished ones, save up to five recipes) under a single eight-second budget that
// must stay inside the client's ten. Two things can only fail at concurrency:
//
//   * The step's latency is bounded by the budget, not by the import's size. A p95 that grows with the item count means the
//     deadline stopped stopping new work.
//   * A stalled food service must answer `200` with the state in the body, never a 5xx. `http_req_failed` is the tripwire.
//
// Each iteration creates its own small import (private, so a recipe it saves reaches no one), advances it three times, and
// deletes it, and deletes each recipe a save wrote (read from the last view's `recipeId`s), so a run leaves no import and no
// recipe behind (owner ruling 2026-09-13: each run cleans up its own data).
//
//   k6 run \
//     -e RECIPE_API_BASE_URL=http://localhost:3000 \
//     -e RECIPE_LOAD_TEST_TOKEN=$TOKEN \
//     packages/services/recipe-service/tests/load/importAdvance.load.js

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

import { BASE_URL, jsonHeaders, rampStages, PEAK_VUS, whenSubstrate, PACE_SECONDS, uuidv4 } from './lib/common.js';

const advanceTrend = new Trend('import_advance_duration', true);

/** The deadline the service gives one advance (8 s) plus the view's reads: inside the client's 10 s. */
const ADVANCE_P95_MS = Number(__ENV['RECIPE_IMPORT_ADVANCE_P95_MS'] || 9000);

/** How many advances one import gets: enough for pay, parse start, match and save to each have a turn. */
const ADVANCES = 3;

const ITEMS = 3;

export const options = {
    scenarios: {
        advanceImport: {
            executor: 'ramping-vus',
            exec: 'advanceImport',
            startVUs: 0,
            stages: rampStages(PEAK_VUS),
            tags: { scenario: 'advanceImport' },
        },
    },
    thresholds: {
        // ⛔ The load-bearing threshold: a spent allowance or a slow food service is a 200, never a 5xx.
        http_req_failed: ['rate<0.01'],
        ...whenSubstrate({
            'http_req_duration{scenario:advanceImport,operation:advance}': [`p(95)<${ADVANCE_P95_MS}`],
        }),
    },
};

/**
 * One small recipe of the import, private to the cook.
 *
 * @param {number} ordinal - The item's place in the file.
 * @returns {object} An import item.
 */
function item(ordinal) {
    return {
        ordinal,
        recipe: {
            title: `k6 import ${ordinal}`,
            cuisine: 'American',
            servings: 4,
            prepTimeMinutes: 5,
            cookTimeMinutes: 10,
            totalTimeMinutes: 15,
            ingredientLines: ['2 cups whole milk', '1 teaspoon salt', '3 large eggs'],
            steps: [{ instruction: 'Mix and cook.' }],
        },
        statement: { kind: 'authored' },
    };
}

/**
 * Create the import.
 *
 * @returns {string | undefined} The import id, or `undefined` when the create was refused.
 */
function createImport() {
    const id = uuidv4();
    const body = {
        id,
        expectedTotal: ITEMS,
        matchMode: 'bindBest',
        visibility: 'private',
        items: Array.from({ length: ITEMS }, (_unused, ordinal) => item(ordinal)),
    };
    const res = http.post(`${BASE_URL}/api/v1/import`, JSON.stringify(body), {
        headers: jsonHeaders(),
        tags: { operation: 'createImport' },
    });

    check(res, { 'import create answers 201': (r) => r.status === 201 });

    return res.status === 201 ? id : undefined;
}

export function advanceImport() {
    const id = createImport();

    if (id === undefined) {
        sleep(PACE_SECONDS);

        return;
    }

    let saved = [];

    for (let step = 0; step < ADVANCES; step += 1) {
        sleep(PACE_SECONDS);

        const res = http.post(`${BASE_URL}/api/v1/import/${id}/advance`, null, {
            headers: jsonHeaders(),
            tags: { operation: 'advance' },
        });

        check(res, {
            // 200 ALWAYS: the allowance state is in the view, so a spent day is not an error.
            'advance answers 200': (r) => r.status === 200,
            'the view carries the allowance': (r) => 'allowance' in JSON.parse(r.body || '{}'),
        });

        advanceTrend.add(res.timings.duration);
        saved = (JSON.parse(res.body || '{}').items || []).map((row) => row.recipeId).filter((recipeId) => recipeId);
    }

    for (const recipeId of saved) {
        http.del(`${BASE_URL}/api/v1/recipes/${recipeId}`, null, {
            headers: jsonHeaders(),
            tags: { operation: 'deleteRecipe' },
        });
    }

    http.del(`${BASE_URL}/api/v1/import/${id}`, null, { headers: jsonHeaders(), tags: { operation: 'deleteImport' } });
    sleep(PACE_SECONDS);
}
