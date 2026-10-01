// The reference resolver under load — `POST /api/v1/foods/refs/resolve` (curated plan U8, roots slice).
//
// @loadTier deployed-capable — it only READS, and harvests its catalog ids in setup() through the ordinary search route,
//   so any seeded catalog serves it; there is no fixture a preview lacks
//
// WHY THIS NEEDS A TIMED TIER. Recipe-service calls this route on every recipe detail read and every save that
// carries ingredients, to learn what the caller may be told about each line's food (plan 002, blueprint step 2).
// Its cost therefore rides on recipe's hottest read path. `tests/e2e/foodRefsResolve.e2e.test.ts` proves the
// contract one request at a time and can say nothing about that. Two properties need concurrency:
//
//   1. **A recipe-shaped batch stays cheap.** The route is ONE `id = ANY($1)` primary-key read of the distinct root
//      ids plus a pure projection. It must beat a single standalone golden-record read (SC-001's `READ_P95_MS`),
//      which is six round trips; a resolve that costs more has lost its reason to be batched.
//   2. **The cap bounds the worst request.** A full `MAX_FOOD_REFS` batch is still one statement. If the read ever
//      went per-ref (an `await` in a loop, `readGoldenRecord` per id), this scenario is where it shows.
//
// ⚠️ NO SUCCESS CRITERION NAMES THIS ROUTE, so the latency bar is DERIVED (point 1), not quoted, and it is gated
// only on the calibrated substrate (`whenSubstrate`). What gates on EVERY profile is correctness a slow machine
// cannot cause: `200`, one entry per DISTINCT ref sent in first-appearance order, every harvested catalog id
// `found`, and every synthetic unknown id and every `variant` ref `absent` — a resolver that started answering
// those would be fabricating foods.
//
// ⛔ AN EMPTY HARVEST FAILS THE RUN in setup(). Without catalog ids every ref is `absent`, which is the cheap path;
// a green run over it would claim the resolver is fast having never read a row.
//
//   npm run test:load:tokens
//   DATABASE_URL=… npm run test:load:fixture
//   k6 run tests/load/catalogResolve.load.js
//
// A threshold breach exits k6 non-zero and fails the invoking job.

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';
import { SharedArray } from 'k6/data';

import {
    BASE_URL,
    PEAK_VUS,
    READ_P95_MS,
    SUMMARY_TREND_STATS,
    authHeaders,
    forIteration,
    loadTokens,
    rampStages,
    setupBearer,
    whenSubstrate,
} from './lib/common.js';

const sessionTokens = new SharedArray('session-tokens', () => loadTokens().users);

const recipeTrend = new Trend('food_resolve_recipe_duration', true);
const capTrend = new Trend('food_resolve_cap_duration', true);

// The published cap (`MAX_FOOD_REFS` in `src/foods/foods.schema.ts`). Restated because k6 cannot load a TypeScript
// module; the cap scenario sends exactly this many distinct refs, and the service refuses one more with a 400,
// so a drift between the two turns every cap iteration red rather than silently measuring a smaller batch.
const MAX_FOOD_REFS = 100;

// A recipe's ingredient list, as recipe-service sends it: most lines bound to catalog foods, a few whose food is
// unknown to this caller, a couple of variant refs (none exist yet), and one repeated line.
const RECIPE_FOUND = 14;
const RECIPE_UNKNOWN = 3;
const RECIPE_VARIANTS = 2;

// Words both a USDA-synced preview catalog and the substrate fixture (`perfFixture.ts` INGREDIENTS) hold.
const HARVEST_TERMS = ['chicken', 'rice', 'onion', 'apple', 'broccoli', 'garlic', 'potato', 'tomato', 'carrot'];

// The cap scenario is the expensive request; a few VUs characterize it without becoming the dominant load.
const capPeak = Math.max(1, Math.ceil(PEAK_VUS / 10));

export const options = {
    summaryTrendStats: SUMMARY_TREND_STATS,
    scenarios: {
        recipe: {
            executor: 'ramping-vus',
            exec: 'recipePath',
            startVUs: 0,
            stages: rampStages(PEAK_VUS),
            tags: { op: 'recipe' },
        },
        cap: {
            executor: 'ramping-vus',
            exec: 'capPath',
            startVUs: 0,
            stages: rampStages(capPeak),
            tags: { op: 'cap' },
        },
    },
    thresholds: {
        // Correctness — carried on every profile. Scoped per scenario so setup()'s harvest cannot dilute them.
        'checks{op:recipe}': ['rate>0.99'],
        'checks{op:cap}': ['rate>0.99'],
        'http_req_failed{op:recipe}': ['rate<0.01'],
        'http_req_failed{op:cap}': ['rate<0.01'],
        // Latency — the derived bar (see the header), in force only on the calibrated substrate.
        ...whenSubstrate({
            'http_req_duration{operation:resolveRecipe}': [`p(95)<${READ_P95_MS}`],
            'http_req_duration{operation:resolveCap}': [`p(95)<${READ_P95_MS}`],
        }),
    },
};

/**
 * Harvest real catalog ids through the search route.
 *
 * Only CATALOG hits are kept: a hit carrying `visibility` is the harvesting user's own authored food, which every
 * other pool user must see as `absent` — keeping it would make the `found` check fail for the right reason.
 */
export function setup() {
    const headers = authHeaders(setupBearer(sessionTokens));
    const ids = new Set();

    for (const term of HARVEST_TERMS) {
        const res = http.get(`${BASE_URL}/api/v1/foods/search?query=${encodeURIComponent(term)}`, {
            headers,
            tags: { operation: 'harvest' },
        });

        if (res.status !== 200) {
            throw new Error(`catalogResolve: harvest search '${term}' answered ${res.status} at ${BASE_URL}`);
        }

        for (const hit of res.json('results') || []) {
            if (hit.visibility === undefined) {
                ids.add(hit.id);
            }
        }
    }

    if (ids.size === 0) {
        throw new Error(
            `catalogResolve: search harvested no catalog ids at ${BASE_URL} — every ref would be absent, the cheap ` +
                'path. Seed the catalog (substrate: `npm run test:load:fixture`) before measuring.',
        );
    }

    return { ids: [...ids] };
}

/** `count` harvested ids starting at a per-iteration offset, so iterations spread across the catalog. */
function harvested(ids, count) {
    const offset = (__VU * 7919 + __ITER * 104729) % ids.length;
    const picked = [];

    for (let index = 0; index < Math.min(count, ids.length); index += 1) {
        picked.push(ids[(offset + index) % ids.length]);
    }

    return picked;
}

/** An id no food has — distinct per VU, iteration and position, so no two refs collapse. */
function unknownId(index) {
    return `k6-unknown-${__VU}-${__ITER}-${index}`;
}

/**
 * The distinct refs of a request, in first-appearance order — what the answer must list, and in that order.
 */
function distinctOf(refs) {
    const seen = new Set();

    return refs.filter((ref) => {
        const key = `${ref.kind}:${ref.id}`;

        if (seen.has(key)) {
            return false;
        }

        seen.add(key);

        return true;
    });
}

/**
 * Whether `res` is the resolver's full, correct answer to `refs`.
 *
 * ⚠️ Asserts the BODY, not the status: a `200` that dropped an entry, reordered them, or answered a synthetic id as
 * `found` is still a `200`, and the latency of a wrong answer says nothing.
 */
function answersEveryRef(res, refs, foundIds) {
    if (res.status !== 200) {
        return false;
    }

    const entries = res.json('entries');
    const expected = distinctOf(refs);

    if (!Array.isArray(entries) || entries.length !== expected.length) {
        return false;
    }

    return expected.every((ref, index) => {
        const entry = entries[index];

        if (entry.ref.kind !== ref.kind || entry.ref.id !== ref.id) {
            return false;
        }

        return entry.outcome === (ref.kind === 'root' && foundIds.has(ref.id) ? 'found' : 'absent');
    });
}

/** POST `refs` as this iteration's user, tagged for the scenario's latency bar. */
function resolve(refs, operation) {
    return http.post(`${BASE_URL}/api/v1/foods/refs/resolve`, JSON.stringify({ refs }), {
        headers: { ...authHeaders(forIteration(sessionTokens)), 'Content-Type': 'application/json' },
        tags: { operation },
    });
}

/** A recipe-shaped batch: found lines, unknown lines, variant refs, and one repeated line. */
export function recipePath(data) {
    const found = harvested(data.ids, RECIPE_FOUND);
    const refs = [
        ...found.map((id) => ({ kind: 'root', id })),
        ...Array.from({ length: RECIPE_UNKNOWN }, (_, index) => ({ kind: 'root', id: unknownId(index) })),
        ...Array.from({ length: RECIPE_VARIANTS }, (_, index) => ({
            kind: 'variant',
            id: found[index] || unknownId(9),
        })),
        { kind: 'root', id: found[0] },
    ];

    const res = resolve(refs, 'resolveRecipe');

    recipeTrend.add(res.timings.duration);
    check(res, {
        'recipe batch answers every distinct ref correctly': (r) => answersEveryRef(r, refs, new Set(found)),
    });
    sleep(1);
}

/** The worst request the contract admits: `MAX_FOOD_REFS` distinct root refs. */
export function capPath(data) {
    const found = harvested(data.ids, MAX_FOOD_REFS - 10);
    const refs = [
        ...found.map((id) => ({ kind: 'root', id })),
        ...Array.from({ length: MAX_FOOD_REFS - found.length }, (_, index) => ({ kind: 'root', id: unknownId(index) })),
    ];

    const res = resolve(refs, 'resolveCap');

    capTrend.add(res.timings.duration);
    check(res, { 'cap batch answers every ref correctly': (r) => answersEveryRef(r, refs, new Set(found)) });
    sleep(1);
}
