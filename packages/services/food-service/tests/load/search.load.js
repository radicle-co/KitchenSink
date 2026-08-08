// Local search scenario — SC-007 ("Food search queries against a local store of up to 50,000 foods MUST
// return results (canonical ids) within 200ms at p95").
//
// Exercises `GET /api/v1/foods/search?query=` against the 50,000-food population `prepare-perf-fixture.ts`
// seeds. Search is LOCAL-ONLY by requirement (FR-009) — `FoodsService.search` never reaches an adapter — so
// this is a no-source-call measurement by construction, not by configuration.
//
// ## Why SEVEN query shapes, each separately gated
//
// `FoodSearchDao.search` ORs four predicates and then RANKS every match before applying `LIMIT 20`, so the
// cost is driven by how many rows match, not by how many are returned. A single query string would measure
// one point on that curve and report it as "search". The shapes below are the points that matter:
//
//   broad    one ingredient word            ~n/23 rows must all be scored (the widest realistic match)
//   phrase   preparation + ingredient       ~n/161 rows — a two-lexeme AND
//   narrow   preparation + ingredient + cut a three-lexeme AND, the cheapest FTS shape
//   brand    a brand token                  ~n/17 rows on an axis independent of the ingredient
//   miss     a nonsense token               ZERO matches: every branch runs to completion, and the limit
//                                           can never short-circuit the scan
//   short    two characters                 too short for trigram extraction, so `ILIKE '%ch%'` cannot use
//                                           `food_name_trgm_idx` — the sequential-scan case a real user
//                                           produces after two keystrokes
//   barcode  a seeded GTIN-13               drives the crosswalk branch (`findFoodIdByBarcode`), which runs
//                                           on EVERY search regardless of the text predicate
//
// Each shape carries its own threshold at the SAME 200ms budget (SC-007 grants no per-shape exemption), so
// a fast narrow query can never hide a slow broad or short one. `short` is separately overridable only so a
// finding can be quantified without deleting the gate — see the README's SC-007 note.
//
//   npm run test:load:tokens
//   DATABASE_URL=… npm run test:load:fixture
//   k6 run tests/load/search.load.js
//
// A threshold breach exits k6 non-zero and fails the invoking job.

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';
import { SharedArray } from 'k6/data';

import {
    BASE_URL,
    PEAK_VUS,
    SEARCH_P95_MS,
    SEARCH_SHORT_P95_MS,
    SUMMARY_TREND_STATS,
    authHeaders,
    forIteration,
    loadFixture,
    loadTokens,
    rampStages,
} from './lib/common.js';

const fixture = loadFixture();
const tokens = loadTokens();

const sessionTokens = new SharedArray('session-tokens', () => tokens.users);

/**
 * The measured shapes, in rotation order. `expectHits` is asserted per response: a shape that should
 * return rows and returns none is measuring a query that found nothing (a mis-seeded store or a lost
 * index), and reporting its latency as SC-007 would be reporting the speed of doing no work.
 */
const SHAPES = [
    { name: 'broad', probes: new SharedArray('probes-broad', () => fixture.search.broad), expectHits: true },
    { name: 'phrase', probes: new SharedArray('probes-phrase', () => fixture.search.phrase), expectHits: true },
    { name: 'narrow', probes: new SharedArray('probes-narrow', () => fixture.search.narrow), expectHits: true },
    { name: 'brand', probes: new SharedArray('probes-brand', () => fixture.search.brand), expectHits: true },
    { name: 'miss', probes: new SharedArray('probes-miss', () => fixture.search.miss), expectHits: false },
    { name: 'short', probes: new SharedArray('probes-short', () => fixture.search.short), expectHits: true },
    { name: 'barcode', probes: new SharedArray('probes-barcode', () => fixture.search.barcode), expectHits: true },
];

const searchTrend = new Trend('food_search_duration', true);

/** Per-shape p95 thresholds, all at the SC-007 budget except the separately-overridable short-query case. */
const shapeThresholds = {};

for (const shape of SHAPES) {
    const budget = shape.name === 'short' ? SEARCH_SHORT_P95_MS : SEARCH_P95_MS;
    shapeThresholds[`http_req_duration{shape:${shape.name}}`] = [`p(95)<${budget}`];
}

export const options = {
    summaryTrendStats: SUMMARY_TREND_STATS,
    scenarios: {
        search: {
            executor: 'ramping-vus',
            exec: 'searchPath',
            startVUs: 0,
            stages: rampStages(PEAK_VUS),
            tags: { op: 'search' },
        },
    },
    thresholds: {
        ...shapeThresholds,
        // The aggregate is kept as well as the per-shape bars: it is the number SC-007 is written about,
        // and it stays meaningful if a shape is ever added or removed.
        'http_req_duration{operation:search}': [`p(95)<${SEARCH_P95_MS}`],
        'http_req_failed{operation:search}': ['rate<0.01'],
        checks: ['rate>0.99'],
    },
};

/** One search, rotating through the shapes so every shape is sampled evenly across the whole run. */
export function searchPath() {
    const cursor = __ITER * 1000 + __VU;
    const shape = SHAPES[cursor % SHAPES.length];
    const query = forIteration(shape.probes);

    const res = http.get(`${BASE_URL}/api/v1/foods/search?query=${encodeURIComponent(query)}`, {
        headers: authHeaders(forIteration(sessionTokens)),
        tags: { operation: 'search', shape: shape.name },
    });

    searchTrend.add(res.timings.duration);

    check(res, {
        // One check name per shape would fragment the rate; the shape is in the failure message instead.
        'search returns the expected result set': (r) => {
            if (r.status !== 200) {
                return false;
            }

            const body = r.json();

            if (body === null || !Array.isArray(body.results)) {
                return false;
            }

            // Canonical ids only — SC-013/FR-IDN-1: no source-native key may appear in a search result.
            for (const result of body.results) {
                if (typeof result.id !== 'string' || result.id.length !== 26) {
                    return false;
                }
            }

            return shape.expectHits ? body.results.length > 0 : body.results.length === 0;
        },
    });

    sleep(1);
}
