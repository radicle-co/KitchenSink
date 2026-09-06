// U14 — ingredient-correction write scenario (plan U14 / R19, R20).
//
// @loadTier deployed-capable — phrases are literals and food ids are opaque; its subject is a row lock, which only a
//   real database has
//
// Drives POST /api/v1/ingredients/corrections under ramping concurrency. This route earns its own scenario
// rather than a case inside `sc009ReadWrite.load.js` because the property under load is not a query cost —
// it is a CONTENTION property, and it is the one thing about this design that can only fail at concurrency:
//
//   * Each request opens a transaction, takes a row lock on the phrase's live mappings (`findWriteFacts`),
//     decides, and writes. The lock is what makes corroboration safe — two users correcting the same phrase
//     concurrently must not both read "nobody else agrees" — so every VU aiming at the SAME phrase is exactly
//     the pile-up that lock is for, and a p95 that degrades super-linearly means the critical section has
//     grown beyond the decision it is supposed to cover.
//   * Two unique partial indexes police the outcome (`idx_resolution_mappings_live_author`,
//     `idx_resolution_mappings_live_global`). A loser of that race must come back `200 recorded:false`, NOT a
//     500 from a constraint violation surfacing as an unhandled error — the DAL's `ON CONFLICT DO NOTHING` +
//     re-read shape is what guarantees that, and only concurrency can test it.
//
// ⛔ THE FAILURE-RATE THRESHOLD IS THE POINT OF THIS FILE. A rising `http_req_failed` here means a losing
// writer is leaking a database constraint to a cook fixing an ingredient line. `recorded: false` is a
// SUCCESS and must stay a 200.
//
// ⚠️ Two contention shapes are driven deliberately. `hotPhrase` puts every VU on ONE phrase (maximum lock
// contention, the corroboration race); `spreadPhrases` spreads across many (the ordinary case, and the one
// that would expose an index-wide rather than row-wide lock).
//
//   k6 run \
//     -e RECIPE_API_BASE_URL=https://recipe.commise.app \
//     -e RECIPE_LOAD_TEST_TOKEN=$TOKEN \
//     packages/services/recipe-service/tests/load/ingredientCorrection.load.js

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

import { BASE_URL, authHeaders, rampStages, PEAK_VUS, SC009_P95_MS } from './lib/common.js';

const correctionTrend = new Trend('ingredient_correction_duration', true);

/** The p95 budget for a correction. Shares the SAVE budget: both are one short transaction plus a write. */
const CORRECTION_P95_MS = Number(__ENV['RECIPE_CORRECTION_P95_MS'] || SC009_P95_MS);

/**
 * The ONE phrase the contention scenario aims at.
 *
 * Prefixed so a load run is identifiable and removable in the mapping table afterwards — this scenario
 * writes durable rows into a knowledge base that RESOLVES REAL INGREDIENTS, so its residue must be
 * recognisable rather than indistinguishable from a cook's correction.
 */
const HOT_PHRASE = 'k6-load hot phrase';

/** Distinct phrases for the spread scenario, same identifiable prefix. */
const SPREAD_PHRASES = Array.from({ length: 64 }, (_, index) => `k6-load spread phrase ${index}`);

/** Opaque food ids. Never verified against the food service (by design), so any stable value serves. */
const FOOD_IDS = ['k6-load-food-a', 'k6-load-food-b', 'k6-load-food-c'];

export const options = {
    scenarios: {
        hotPhrase: {
            executor: 'ramping-vus',
            exec: 'hotPhrase',
            startVUs: 0,
            stages: rampStages(PEAK_VUS),
            tags: { scenario: 'hotPhrase' },
        },
        spreadPhrases: {
            executor: 'ramping-vus',
            exec: 'spreadPhrases',
            startVUs: 0,
            stages: rampStages(PEAK_VUS),
            tags: { scenario: 'spreadPhrases' },
        },
    },
    thresholds: {
        'http_req_duration{operation:recordIngredientCorrection}': [`p(95)<${CORRECTION_P95_MS}`],
        // ⛔ The load-bearing threshold: a lost write race must be a 200 `recorded: false`, never a 5xx.
        http_req_failed: ['rate<0.01'],
    },
};

/**
 * Issue one correction and assert the contract that must hold under contention.
 *
 * @param {string} phrase - The phrase being corrected.
 * @param {string} foodId - The food it should mean.
 * @returns {void}
 */
function correct(phrase, foodId) {
    const res = http.post(
        `${BASE_URL}/api/v1/ingredients/corrections`,
        JSON.stringify({ phrase, foodId, surfacing: 'ingredient_picker' }),
        {
            headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
            tags: { operation: 'recordIngredientCorrection' },
        },
    );

    correctionTrend.add(res.timings.duration);

    check(res, {
        // ⛔ 200 for BOTH outcomes. A losing writer is a legitimate, expected answer — not an error.
        'correction 200': (r) => r.status === 200,
        // The response discriminant is present and well-formed, and a recorded write always states its
        // REACH: a client cannot tell a personal binding from one that covers every user without it.
        'correction answers a well-formed outcome': (r) => {
            if (r.status !== 200) {
                return false;
            }

            let body;

            try {
                body = r.json();
            } catch {
                return false;
            }

            if (body === null || typeof body.recorded !== 'boolean') {
                return false;
            }

            return body.recorded
                ? typeof body.mappingId === 'string' && ['author', 'global'].indexOf(body.scope) !== -1
                : ['already_in_force', 'superseded'].indexOf(body.outcome) !== -1;
        },
    });

    // A human cadence: a correction is a deliberate act, not a keystroke.
    sleep(1);
}

/** Maximum lock contention: every VU corrects the SAME phrase, which is the corroboration race. */
export function hotPhrase() {
    correct(HOT_PHRASE, FOOD_IDS[(__ITER + __VU) % FOOD_IDS.length]);
}

/** The ordinary shape: corrections spread across many phrases, so contention is per row rather than global. */
export function spreadPhrases() {
    correct(SPREAD_PHRASES[(__ITER + __VU) % SPREAD_PHRASES.length], FOOD_IDS[__VU % FOOD_IDS.length]);
}
