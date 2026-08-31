/**
 * The SC-007 load fixture's head-term distribution, against a REAL Postgres (plan U30).
 *
 * ## ⛔ What only this tier can prove
 *
 * `perfFixtureDistribution.test.ts` measures the corpus the TypeScript generator produces. Three of the
 * four things that decide what SC-007 actually measures live on the other side of a boundary it cannot
 * cross:
 *
 *  1. **The SQL rendering.** `perfFoodNameSql` is a second implementation of `perfFoodName`. Nothing in the
 *     type system links them, and the seed runs entirely in Postgres — a wrong modulus, a wrong bound array
 *     or an off-by-one in the `[...]` subscript produces names nobody in this process ever sees.
 *  2. **`food.rank_tokens`.** It is a STORED GENERATED column whose expression is Postgres' mirror of
 *     `rankingTokens`, written in a different regex dialect. `rank_tokens @> ARRAY[head]` is the branch this
 *     whole unit is about, so if the two folds disagreed on ONE word — `flakes`, `halves`, anything the
 *     plural arms touch — that word's probe would retrieve nothing and its selectivity would read zero,
 *     while the unit suite reported a perfect ladder.
 *  3. **The retrieval itself.** A probe is only a measurement if the real statement returns rows for it.
 *     `search.load.js` asserts that at run time through `expectHits`, hours later, behind the `heavy-e2e`
 *     label; asserted here it fails in the ordinary integration run instead.
 *
 * ## What it deliberately does NOT do
 *
 * It does not run `preparePerfFixture.ts` — that script resolves a disposable `DATABASE_URL` and opens a
 * pool at module scope, so importing it would terminate this process. It re-issues the ONE rendering under
 * test (`perfFoodNameSql`, bound to the same draw tables the seeder binds) rather than the whole 14-column
 * INSERT, and seeds {@link POPULATION} rows rather than 50,000 — every head term's count is compared to the
 * TypeScript prediction FOR THAT SAME POPULATION, exactly, so a smaller corpus loses no signal.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { describeRankingQuery } from '@kitchensink/recipe-core/resolution/ranking-terms';

import { FoodSearchDao } from '../src/foods/dao/foodSearch.dao.js';
import {
    HEAD_TERM_REGIMES,
    HEAD_TERM_REGIME_FLOOR,
    HEAD_TERM_SELECTIVITY_P50,
    HEAD_TERM_SELECTIVITY_TAIL,
    countHeadTermOccurrences,
    profileHeadTerms,
} from './load/headTermSelectivity.js';
import {
    BRAND_AXIS,
    CUT_AXIS,
    HEAD_TERM_AXES,
    INGREDIENT_AXIS,
    PREPARATIONS,
    SHAPE_HEAD_AXIS,
    buildSearchProbes,
    perfFoodIdSql,
    perfFoodName,
    perfFoodNameSql,
    perfNormalizedName,
    type PerfSearchProbes,
    type PerfWordParams,
} from './load/perfFixture.js';
import { DATABASE_URL, makeDb, makePool, resetSchema } from './support/db.js';

/**
 * How many rows to seed.
 *
 * ⚠️ Not 50,000, and not a token handful. The narrowest head term takes ~1.2% of the corpus, so this must
 * stay large enough that EVERY one of the 108 head terms lands on rows — otherwise a term reading zero
 * would be indistinguishable from the fold disagreement this suite exists to detect. At 10,000 the
 * narrowest term still carries ~118 rows.
 */
const POPULATION = 10_000;

/** Placeholder numbers after `$1` (the row count) — the seeder's own ordering. */
const WORD_PARAMS: PerfWordParams = { preparations: 2, ingredients: 3, cuts: 4, brands: 5 };

/** The draw TABLES, not the vocabularies — see `preparePerfFixture.ts`'s note on `vocabValues`. */
const WORD_VALUES = [[...PREPARATIONS], [...INGREDIENT_AXIS.draw], [...CUT_AXIS.draw], [...BRAND_AXIS.draw]];

/** The corpus the TypeScript generator predicts for {@link POPULATION}. */
const PREDICTED_NAMES = Array.from({ length: POPULATION }, (_unused, index) => perfFoodName('resolved', index));

/** Token counts over that predicted corpus. */
const PREDICTED_COUNTS = countHeadTermOccurrences(PREDICTED_NAMES);

describe.skipIf(!DATABASE_URL)('the SC-007 load fixture, seeded into a real Postgres (integration)', () => {
    let pool: pg.Pool;
    let dao: FoodSearchDao;

    beforeAll(async () => {
        pool = makePool();
        await resetSchema(pool);
        dao = new FoodSearchDao(makeDb(pool));

        const name = perfFoodNameSql('resolved', 's.i', WORD_PARAMS);

        await pool.query(
            `INSERT INTO food (id, name, normalized_name, description, status, origin, created_at, updated_at)
             SELECT ${perfFoodIdSql('resolved', 's.i')}, ${name}, lower(${name}), ${name}, 'RESOLVED', 'bulk',
                    now(), now()
               FROM generate_series(0, $1::int - 1) AS s(i)
             ON CONFLICT DO NOTHING`,
            [POPULATION, ...WORD_VALUES],
        );
    }, 120_000);

    afterAll(async () => {
        await pool?.end();
    });

    it('seeds every requested row — no name collided on food_normalized_name_unique', async () => {
        const { rows } = await pool.query<{ total: string }>('SELECT count(*)::text AS total FROM food');

        expect(Number(rows[0]!.total), `food holds ${rows[0]!.total} rows`).toBe(POPULATION);
    });

    it('renders in SQL exactly what the TypeScript renders', async () => {
        // The SAME agreement `preparePerfFixture.ts`'s `assertRenderingsAgree` proves at seed time, asserted
        // here across the whole corpus rather than at one index — the draw tables are strided, so an index
        // that agrees proves nothing about the next one.
        const { rows } = await pool.query<{ id: string; name: string; normalized_name: string }>(
            'SELECT id, name, normalized_name FROM food ORDER BY id',
        );

        expect(rows).toHaveLength(POPULATION);
        expect(rows.map((row) => row.name)).toEqual(PREDICTED_NAMES);
        expect(rows.map((row) => row.normalized_name)).toEqual(
            Array.from({ length: POPULATION }, (_unused, index) => perfNormalizedName('resolved', index)),
        );
    });

    it.each(Object.keys(HEAD_TERM_AXES))(
        'retrieves the predicted number of rows for every %s head term through rank_tokens',
        async (axisName) => {
            // ⛔ The load-bearing case, and the ONE thing no unit test can reach: this compares the
            // TypeScript fold's prediction against the fold Postgres computed in a STORED GENERATED column,
            // in a different regex dialect, for every word — which is exactly the branch
            // `FoodSearchDao.relevanceQuery` retrieves on.
            const axis = HEAD_TERM_AXES[axisName as keyof typeof HEAD_TERM_AXES]!;
            const observed: Record<string, number> = {};
            const predicted: Record<string, number> = {};

            for (const term of axis.terms) {
                const folded = describeRankingQuery(term).head!;
                const { rows } = await pool.query<{ total: string }>(
                    'SELECT count(*)::text AS total FROM food WHERE rank_tokens @> ARRAY[$1]::text[]',
                    [folded],
                );

                observed[folded] = Number(rows[0]!.total);
                predicted[folded] = PREDICTED_COUNTS.get(folded) ?? 0;
            }

            expect(Object.keys(observed), `compared ${Object.keys(observed).length} head terms`).toHaveLength(
                axis.terms.length,
            );
            expect(
                Math.min(...Object.values(observed)),
                `narrowest observed count: ${JSON.stringify(observed)}`,
            ).toBeGreaterThan(0);
            expect(observed).toEqual(predicted);
        },
        120_000,
    );

    it.each(Object.keys(HEAD_TERM_AXES))(
        'lands the %s axis ladder on the catalog anchors in the database',
        async (axisName) => {
            const axis = HEAD_TERM_AXES[axisName as keyof typeof HEAD_TERM_AXES]!;
            const counts = new Map<string, number>();

            for (const term of axis.terms) {
                const folded = describeRankingQuery(term).head!;
                const { rows } = await pool.query<{ total: string }>(
                    'SELECT count(*)::text AS total FROM food WHERE rank_tokens @> ARRAY[$1]::text[]',
                    [folded],
                );

                counts.set(folded, Number(rows[0]!.total));
            }

            const profile = profileHeadTerms(axisName, axis.terms, counts, POPULATION);
            const counted = HEAD_TERM_REGIMES.map((regime) => `${regime}=${profile.regimeCounts[regime]}`).join(' ');

            expect(
                profile.tail,
                `axis '${axisName}' in-database tail ${(profile.tail * 100).toFixed(2)}%, ` +
                    `p50 ${(profile.p50 * 100).toFixed(2)}%, regimes ${counted}`,
            ).toBeGreaterThan(HEAD_TERM_SELECTIVITY_TAIL * 0.8);
            expect(profile.tail).toBeLessThan(HEAD_TERM_SELECTIVITY_TAIL * 1.2);
            expect(profile.p50).toBeGreaterThan(HEAD_TERM_SELECTIVITY_P50 * 0.8);
            expect(profile.p50).toBeLessThan(HEAD_TERM_SELECTIVITY_P50 * 1.2);

            for (const regime of HEAD_TERM_REGIMES) {
                expect(
                    profile.regimeCounts[regime],
                    `axis '${axisName}' counted ${counted} in the database`,
                ).toBeGreaterThanOrEqual(HEAD_TERM_REGIME_FLOOR);
            }
        },
        120_000,
    );

    it('returns rows for every head-bearing probe through the real search statement', async () => {
        // `search.load.js` asserts this as `expectHits` during a k6 run behind the `heavy-e2e` label. A probe
        // that retrieves nothing measures the speed of doing no work, so it is asserted here too, against the
        // statement production runs, where it fails in minutes rather than hours.
        const probes = buildSearchProbes(8);
        const empty: string[] = [];
        let checked = 0;

        for (const [shape, axisName] of Object.entries(SHAPE_HEAD_AXIS)) {
            if (axisName === null) {
                continue;
            }

            for (const probe of probes[shape as keyof PerfSearchProbes]) {
                checked += 1;

                if ((await dao.search(probe, 'search-it-caller')).length === 0) {
                    empty.push(`${shape}:'${probe}'`);
                }
            }
        }

        expect(checked, `ran ${checked} head-bearing probes against FoodSearchDao.search`).toBeGreaterThan(0);
        expect(empty, `probes that retrieved nothing: ${empty.join(', ') || '(none)'}`).toEqual([]);
    }, 120_000);

    it('still returns nothing for the miss probe', async () => {
        // The mirror of the case above: if EVERY probe returned rows the suite above could be passing because
        // the predicate matches everything, which is the other way to make a search benchmark meaningless.
        const misses = buildSearchProbes(4).miss;

        expect(misses.length).toBeGreaterThan(0);

        for (const probe of misses) {
            expect(await dao.search(probe, 'search-it-caller'), `miss probe '${probe}' matched rows`).toEqual([]);
        }
    }, 60_000);
});
