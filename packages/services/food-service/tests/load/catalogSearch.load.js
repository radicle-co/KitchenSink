// Catalog search over the curated roots and their variants under load — `GET /api/v1/foods/catalog/search`, the
// shared route the production edge caches (curated plan U8, requirements AE2 and AE3; plan 002 R40, S3).
//
// @loadTier deployed-capable — it only READS, and every probe is a root, synonym or variant of the committed seed,
//   which each preview applies on deploy (curated plan U7)
//
// WHY THIS NEEDS A TIMED TIER. `search.load.js` measures SC-007 over the perf fixture, which holds no curated root, no
// synonym and no variant, so the variant rule never runs there. Here it does: after retrieval, every catalog hit the
// query leaves words over is handed to ONE live-variant read (`FoodsService.namedVariantsOf`), and
// `variantQueryMatch.ts` picks the variant those words name. `tests/e2e/catalogSearch.e2e.test.ts` proves the rule one
// request at a time over two seeded roots and can say nothing about its cost. If the variant read ever went per hit
// (an `await` in a loop), this scenario is where it shows.
//
// The shapes, each a path through the rule (its module doc numbers them), and what the probed root comes back as:
//
//   synonym      AE2   a synonym of beef brisket          the synonym absorbs the query: the root alone
//   oneVariant   AE3   a word exactly one variant holds   the root, carrying that variant
//   twoVariants  AE3   words of two different variants    no variant holds both: the root alone
//   sharedWord   AE3   a word two variants hold           two match: the root alone
//   rootAlone    AE3   the root's own name                nothing left over: the root alone
//
// ⚠️ `sharedWord` is AE3's own example. "grilled" is held by two live variants of boneless skinless chicken breasts
// in the committed seed (`grilled`, and `with added solution · grilled`), so the requirements' "the line binds that
// variant" does not hold for it; the rule answers the root alone, and this scenario measures what the rule answers.
//
// ⛔ THE ROUTE IS CAPPED PER USER, `SEARCH_PER_USER_LIMIT` a minute (`src/common/throttle/throttle.config.ts`), and
// a preview has no edge, so every request reaches the origin. The run therefore holds no more VUs than the token pool
// has users: each VU searches once a second and iterations rotate through the pool, so one user is asked about sixty
// times a minute, half the cap. More VUs than users would measure the limiter, not the search.
//
// The probes are SEED FACTS. setup() reads the stage's own live variants and fails the run, naming the probe, when the
// seed no longer has the shape a probe claims. The fix is to choose another word, not to loosen the check.
//
// ⚠️ NO SUCCESS CRITERION NAMES THE VARIANT RULE, so the bar is SC-007's search budget (`SEARCH_P95_MS`), per shape,
// and it is gated only on the calibrated substrate (`whenSubstrate`): a local service booted over a database the
// committed seed was applied to (`npm run local:up` applies it). The perf fixture alone is NOT that substrate, and
// setup() says so. What gates on EVERY profile is correctness a slow machine cannot cause: `200`, canonical ids, the
// probed root present, and the variant attached exactly when the rule says.
//
//   npm run test:load:tokens
//   k6 run tests/load/catalogSearch.load.js
//
// A threshold breach exits k6 non-zero and fails the invoking job.

import http from 'k6/http';
import exec from 'k6/execution';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';
import { SharedArray } from 'k6/data';

import {
    BASE_URL,
    PEAK_VUS,
    SEARCH_P95_MS,
    SUMMARY_TREND_STATS,
    authHeaders,
    forIteration,
    loadTokens,
    rampStages,
    setupBearer,
    whenSubstrate,
} from './lib/common.js';

const sessionTokens = new SharedArray('session-tokens', () => loadTokens().users);

/** One VU per pool user at most — see the header for why. */
const peak = Math.min(PEAK_VUS, sessionTokens.length);

const searchTrend = new Trend('food_catalog_search_duration', true);

/** The two KTD-16 test roots of the committed seed (`src/foods/seed/data/curatedCatalog.jsonl`). */
const BRISKET = 'beef brisket';
const CHICKEN = 'boneless skinless chicken breasts';

/**
 * The measured shapes, in rotation order. Each probe names its root and the variant words it adds to the root's name.
 * `holders` is the claim about the stage's live variants that makes the probe the shape it is named for: how many of
 * the root's live variants state every one of those words. `null` when the probe adds no words.
 */
const SHAPES = [
    {
        name: 'synonym',
        probes: [{ root: BRISKET, query: 'first cut brisket', words: [] }],
        holders: null,
    },
    {
        name: 'oneVariant',
        probes: ['fried', 'roasted', 'stewed'].map((word) => ({
            root: CHICKEN,
            query: `${word} ${CHICKEN}`,
            words: [word],
        })),
        holders: (count) => count === 1,
    },
    {
        name: 'twoVariants',
        probes: [{ root: CHICKEN, query: `fried roasted ${CHICKEN}`, words: ['fried', 'roasted'] }],
        holders: (count) => count === 0,
    },
    {
        name: 'sharedWord',
        probes: [{ root: CHICKEN, query: `grilled ${CHICKEN}`, words: ['grilled'] }],
        holders: (count) => count > 1,
    },
    {
        name: 'rootAlone',
        probes: [{ root: CHICKEN, query: CHICKEN, words: [] }],
        holders: null,
    },
];

export const options = {
    summaryTrendStats: SUMMARY_TREND_STATS,
    scenarios: {
        search: {
            executor: 'ramping-vus',
            exec: 'searchPath',
            startVUs: 0,
            stages: rampStages(peak),
            tags: { op: 'search' },
        },
    },
    thresholds: {
        // Correctness — carried on every profile. Scoped to the scenario so setup()'s reads cannot dilute them, and
        // per shape so a shape that always fails is named rather than averaged away.
        'checks{op:search}': ['rate>0.99'],
        'http_req_failed{op:search}': ['rate<0.01'],
        ...Object.fromEntries(SHAPES.map((shape) => [`checks{shape:${shape.name}}`, ['rate>0.99']])),
        // Latency — SC-007's budget per shape, in force only on the calibrated substrate (see the header).
        ...whenSubstrate(
            Object.fromEntries(
                SHAPES.map((shape) => [`http_req_duration{shape:${shape.name}}`, [`p(95)<${SEARCH_P95_MS}`]]),
            ),
        ),
    },
};

/** Search the shared catalog, tagged with what the request is for. */
function search(query, headers, tags) {
    return http.get(`${BASE_URL}/api/v1/foods/catalog/search?query=${encodeURIComponent(query)}`, { headers, tags });
}

/** The lower-cased words a variant's parts state. */
function wordsOf(variant) {
    return new Set(variant.parts.flatMap((part) => part.text.toLowerCase().split(/\s+/u)));
}

/**
 * Find each root, read its live variants, and work out what every probe must be answered with.
 *
 * ⛔ FAILS THE RUN when a root is missing or a probe no longer has its shape. Without the roots every check fails for
 * a reason the summary cannot name; with a drifted probe the shape would measure a different path under its name.
 */
export function setup() {
    const headers = authHeaders(setupBearer(sessionTokens));
    const roots = {};

    for (const name of [BRISKET, CHICKEN]) {
        const res = search(name, headers, { operation: 'setupFindRoot' });

        if (res.status !== 200) {
            throw new Error(`catalogSearch: finding '${name}' answered ${res.status} at ${BASE_URL}`);
        }

        const hit = (res.json('results') || []).find((result) => result.name === name);

        if (hit === undefined) {
            throw new Error(
                `catalogSearch: no root named '${name}' at ${BASE_URL} — the committed seed is not applied there ` +
                    '(the perf fixture holds no curated root; run against a seeded catalog, e.g. `npm run local:up`).',
            );
        }

        const food = http.get(`${BASE_URL}/api/v1/foods/${encodeURIComponent(hit.id)}`, {
            headers,
            tags: { operation: 'setupReadRoot' },
        });

        if (food.status !== 200) {
            throw new Error(`catalogSearch: reading '${name}' (${hit.id}) answered ${food.status} at ${BASE_URL}`);
        }

        roots[name] = { id: hit.id, variants: food.json('variants') || [] };
    }

    const expected = {};

    for (const shape of SHAPES) {
        for (const probe of shape.probes) {
            const holders = roots[probe.root].variants.filter((variant) => {
                const stated = wordsOf(variant);

                return probe.words.every((word) => stated.has(word));
            });

            if (shape.holders !== null && !shape.holders(holders.length)) {
                throw new Error(
                    `catalogSearch: the '${shape.name}' probe '${probe.query}' finds ${holders.length} live variant(s) ` +
                        `of '${probe.root}' stating [${probe.words.join(', ')}], which is not the shape it is named ` +
                        'for. The seed moved; choose another word.',
                );
            }

            expected[probe.query] = {
                rootId: roots[probe.root].id,
                variantId: shape.name === 'oneVariant' ? holders[0].id : null,
            };
        }
    }

    return { expected };
}

/**
 * Whether `res` answers `probe` as the variant rule says.
 *
 * ⚠️ Asserts the BODY, not only the status: a `200` that lost the root, or attached a variant the query did not name,
 * is still a `200`, and the latency of a wrong answer says nothing.
 */
function answersProbe(res, probe, expected) {
    if (res.status !== 200) {
        return false;
    }

    // Plan 002 S3: a body the edge shares across callers carries no caller's rate-limit counter.
    if (Object.keys(res.headers).some((name) => name.toLowerCase().startsWith('x-ratelimit'))) {
        return false;
    }

    const results = res.json('results');

    // Canonical ids only — SC-013/FR-IDN-1: no source-native key may appear in a search result. And never a
    // `visibility`: the shared route answers catalog roots only (plan 002 S3, property 7).
    if (
        !Array.isArray(results) ||
        !results.every(
            (result) => typeof result.id === 'string' && result.id.length === 26 && result.visibility === undefined,
        )
    ) {
        return false;
    }

    const hit = results.find((result) => result.id === expected.rootId);

    if (hit === undefined || hit.name !== probe.root) {
        return false;
    }

    if (expected.variantId === null) {
        return hit.variant === undefined;
    }

    return (
        hit.variant !== undefined &&
        hit.variant.id === expected.variantId &&
        probe.words.every((word) => wordsOf(hit.variant).has(word))
    );
}

/** One search, rotating through the shapes and their probes so each is sampled evenly across the run. */
export function searchPath(data) {
    const iteration = exec.scenario.iterationInTest;
    const shape = SHAPES[iteration % SHAPES.length];
    const probe = shape.probes[Math.floor(iteration / SHAPES.length) % shape.probes.length];

    const res = search(probe.query, authHeaders(forIteration(sessionTokens)), {
        operation: 'catalogSearch',
        shape: shape.name,
    });

    searchTrend.add(res.timings.duration, { shape: shape.name });
    // One check name across the shapes keeps one rate; the shape tag carries the attribution.
    check(
        res,
        {
            'search answers the probe as the variant rule says': (r) =>
                answersProbe(r, probe, data.expected[probe.query]),
        },
        { shape: shape.name },
    );
    sleep(1);
}
