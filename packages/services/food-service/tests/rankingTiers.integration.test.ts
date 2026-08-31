/**
 * Plan U5 — the CATALOG surface's tiered ranking, against a REAL Postgres.
 *
 * ## Why a unit test cannot stand in for this file
 *
 * The tier is computed IN SQL, by a `CASE` over a lateral that folds, tokenizes and singularizes the row's
 * name — a second implementation, in a second language, of `@kitchensink/recipe-core`'s ranking vocabulary.
 * `src/foods/dao/__tests__/foodRelevance.test.ts` can assert that the rendered statement has the SHAPE of a
 * ladder; it cannot assert that PostgreSQL's ARE regex, its `normalize(…, NFD)`, its `[[:alnum:]]` class
 * under a UTF-8 ctype and its collation agree with JavaScript's. Only a database can.
 *
 * ## The defect being closed, reproduced here before it is fixed
 *
 * Measured on `postgres:16` with `pg_trgm`, 2026-08-22 — the corrected attribution, not the plan's original
 * sentence:
 *
 * | expression                                                            | value |
 * | --------------------------------------------------------------------- | ----- |
 * | `similarity('Carob flour', 'flour')`                                  | 0.50  |
 * | `similarity('Flour, wheat, all-purpose, enriched, bleached', 'flour')` | 0.15  |
 * | `similarity('Crackers, milk', 'milk')`                                | 0.36  |
 * | `similarity('Milk, whole, 3.25% milkfat', 'milk')`                    | 0.25  |
 *
 * There is no TIE on this surface — there is a length PENALTY, and on a realistic USDA catalog it points at
 * the attractor. KTD-1 keeps the penalty (swapping in `word_similarity` measured 4 regressions / 0 fixes),
 * so the fix is a rung above it, not a different metric.
 *
 * ## Mutation lens
 *
 * Each case below fails if the ladder is removed, if a rung's predicate is inverted, if the head rule is
 * applied to the NAME the way it is applied to the query (which re-ties `Carob flour` with the real flour
 * row), if the plural or diacritic fold is dropped from the SQL, or if the tier stops being part of the sort
 * key. The `flor` case fails if a rung starts overriding the base metric for a typo, which is the way an
 * over-eager ladder would regress KTD-1's 0.600 case.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { registerRankingConformance } from '@kitchensink/service-test-harness';
import type { ConformanceRow } from '@kitchensink/service-test-harness';

import { FoodSearchDao } from '../src/foods/dao/foodSearch.dao.js';
import { DATABASE_URL, makeDb, makePool, resetSchema, type TestDb } from './support/db.js';

/** A catalog row for a ranking case, with the reason it is in the fixture. */
interface RankingFixtureRow {
    readonly id: string;
    readonly name: string;
}

/** Insert `RESOLVED` catalog rows — search only surfaces golden records. */
async function seedFoods(
    pool: pg.Pool,
    rows: readonly (RankingFixtureRow & { readonly priorFraction?: number })[],
): Promise<void> {
    for (const row of rows) {
        await pool.query(
            `INSERT INTO food (id, name, normalized_name, description, status)
             VALUES ($1, $2, lower($2), $2, 'RESOLVED')`,
            [row.id, row.name],
        );

        if (row.priorFraction !== undefined) {
            // U5: the conformance corpus's prior-carrying rows exercise the ladder guarantee against the
            // REAL popularity join.
            await pool.query(
                `INSERT INTO food_popularity (food_id, consumption_weight, prior_fraction, source)
                 VALUES ($1, 0, $2, 'conformance-fixture')`,
                [row.id, row.priorFraction],
            );
        }
    }
}

describe.skipIf(!DATABASE_URL)('catalog tiered ranking (integration)', () => {
    let pool: pg.Pool;
    let db: TestDb;
    let dao: FoodSearchDao;

    beforeAll(async () => {
        pool = makePool();
        await resetSchema(pool);
        db = makeDb(pool);
        dao = new FoodSearchDao(db);
    });

    afterAll(async () => {
        await pool?.end();
    });

    beforeEach(async () => {
        await pool.query('TRUNCATE food CASCADE');
    });

    /** Rank a query and return the display names in the order the statement produced. */
    async function rank(query: string): Promise<readonly string[]> {
        const hits = await dao.search(query);

        return hits.map((hit) => hit.name ?? '');
    }

    describe('the three attractors the 448-recipe import collapsed onto', () => {
        it('`flour` returns the flour row, not `Carob flour`', async () => {
            await seedFoods(pool, [
                { id: 'f-carob', name: 'Carob flour' },
                { id: 'f-wheat', name: 'Flour, wheat, all-purpose, enriched, bleached' },
            ]);

            const ranked = await rank('flour');

            expect(ranked[0]).toBe('Flour, wheat, all-purpose, enriched, bleached');
            // The attractor is still RETURNED — the fix is a ranking fix, not a retrieval filter, and a
            // carob-flour recipe must still be able to find carob flour.
            expect(ranked).toContain('Carob flour');
        });

        it('`milk` returns a milk, not `Crackers, milk`', async () => {
            await seedFoods(pool, [
                { id: 'f-crackers', name: 'Crackers, milk' },
                { id: 'f-milk', name: 'Milk, whole, 3.25% milkfat' },
            ]);

            expect((await rank('milk'))[0]).toBe('Milk, whole, 3.25% milkfat');
        });

        it('`sugar` returns a sugar, not the sugar-coated candy', async () => {
            await seedFoods(pool, [
                { id: 'f-candy', name: 'Candies, sugar-coated almonds' },
                { id: 'f-sugar', name: 'Sugars, granulated' },
            ]);

            expect((await rank('sugar'))[0]).toBe('Sugars, granulated');
        });

        it('⛔ the base metric alone still prefers every attractor — the ladder is what moves them', async () => {
            // Proves the cases above are not passing for some unrelated reason. If this query ever returns
            // the "right" answer, the premise of this whole unit has changed and the fixture is stale.
            const { rows } = await pool.query<{ attractor: string; wanted: string }>(
                `SELECT similarity('Carob flour', 'flour')::text AS attractor,
                        similarity('Flour, wheat, all-purpose, enriched, bleached', 'flour')::text AS wanted`,
            );

            expect(Number(rows[0]!.attractor)).toBeGreaterThan(Number(rows[0]!.wanted));
        });
    });

    describe('the judgement-set entries the plan names outright', () => {
        it('`brown sugar` reaches the comma-inverted USDA name', async () => {
            await seedFoods(pool, [
                { id: 'f-brownsugar', name: 'Sugars, brown' },
                { id: 'f-sugar', name: 'Sugars, granulated' },
                { id: 'f-candy', name: 'Candies, sugar-coated almonds' },
            ]);

            expect((await rank('brown sugar'))[0]).toBe('Sugars, brown');
        });

        it('`red wine vinegar` reaches `Vinegar, red wine` past two decoys sharing its tokens', async () => {
            await seedFoods(pool, [
                { id: 'f-wine', name: 'Wine, table, red' },
                { id: 'f-vinegar-rw', name: 'Vinegar, red wine' },
                { id: 'f-vinegar-c', name: 'Vinegar, cider' },
            ]);

            expect((await rank('red wine vinegar'))[0]).toBe('Vinegar, red wine');
        });
    });

    describe('the handoffs `representativeUserInput.test.ts` records against ranking (U5/U6)', () => {
        it('bridges a PLURAL: `eggs` reaches the singular catalog name', async () => {
            await seedFoods(pool, [
                { id: 'f-eggnog', name: 'Eggnog' },
                { id: 'f-egg', name: 'Egg, whole, raw, fresh' },
            ]);

            expect((await rank('eggs'))[0]).toBe('Egg, whole, raw, fresh');
        });

        it('bridges a DIACRITIC: `jalapeño` reaches the row the catalog spells without one', async () => {
            await seedFoods(pool, [
                { id: 'f-pepper-sweet', name: 'Peppers, sweet, green, raw' },
                { id: 'f-jalapeno', name: 'Jalapeno peppers' },
            ]);

            const ranked = await rank('jalapeño peppers');

            expect(ranked[0]).toBe('Jalapeno peppers');
        });

        it('bridges COMMA INVERSION both ways: `flour, all purpose` and `all purpose flour` agree', async () => {
            await seedFoods(pool, [
                { id: 'f-carob', name: 'Carob flour' },
                { id: 'f-ap', name: 'Flour, all purpose' },
            ]);

            expect((await rank('flour, all purpose'))[0]).toBe('Flour, all purpose');
            expect((await rank('all purpose flour'))[0]).toBe('Flour, all purpose');
        });
    });

    describe('what the ladder must NOT do', () => {
        it('leaves a typo to the base metric — a misspelling still reaches its row', async () => {
            // ⛔ NOT `flor` → `All-purpose flour`. Measured 2026-08-22: that pair scores 0.600 by
            // `word_similarity` and only **0.15** by `similarity`, which is below the `%` operator's 0.3
            // threshold — so the CATALOG cannot retrieve it at all and never could. KTD-1's 0.600 sentence
            // is about recipe-service's LOCAL table, and the `flor` case is asserted there
            // (`tests/ingredientRanking.integration.test.ts`). Putting it here would have been a test
            // asserting the wrong surface's contract.
            await seedFoods(pool, [
                { id: 'f-cheddar', name: 'Cheddar cheese' },
                { id: 'f-cheese', name: 'Cheese, cottage' },
            ]);

            expect(await rank('chedar')).toContain('Cheddar cheese');
        });

        it('keeps the length penalty INSIDE a rung, which is what KTD-1 preserved it for', async () => {
            // Both rows head on `chive`, so the rung cannot separate them and `similarity`'s penalty decides
            // — exactly the behaviour the plan calls a virtue.
            await seedFoods(pool, [
                { id: 'f-chives-fd', name: 'Chives, freeze-dried' },
                { id: 'f-chives-raw', name: 'Chives, raw' },
            ]);

            expect((await rank('chives'))[0]).toBe('Chives, raw');
        });

        it('keeps every score below 1, so a crosswalk hit still sorts first', async () => {
            // `FoodsService.search` unshifts a barcode / external-key crosswalk hit at score exactly 1, and
            // recipe-service's `FoodCatalogGateway` then re-sorts the page by score. An un-normalized tiered
            // score would reach 9 and silently demote an exact identifier match below a lexical one.
            await seedFoods(pool, [{ id: 'f-flour', name: 'Flour' }]);

            const hits = await dao.search('flour');

            expect(hits[0]!.score).toBeLessThan(1);
            expect(hits[0]!.score).toBeGreaterThan(0);
        });

        it('is never consulted below the FR-010a minimum, because nothing is searched there', async () => {
            // ⚠️ REWRITTEN, not deleted (plan U37). It used to assert that the tier ladder left the
            // separate 1–2 character prefix statement and its own score alone. That statement is gone, so
            // the invariant underneath it — the ladder cannot change what a short query returns — is now
            // the stronger claim that a short query returns nothing at all. The rows below are the ones
            // the prefix statement used to rank.
            await seedFoods(pool, [
                { id: 'f-chicken', name: 'Chicken, broilers or fryers, breast' },
                { id: 'f-cheddar', name: 'Cheddar cheese' },
            ]);

            expect(await rank('ch')).toEqual([]);
            // …and one character longer the ladder ranks as usual, so the case above is not passing
            // because the seed failed. ('che' is a substring of `Cheddar cheese` only — `Chicken` has no
            // `che` — which is itself the point: at three characters retrieval discriminates.)
            expect(await rank('che')).toEqual(['Cheddar cheese']);
            expect(await rank('chi')).toEqual(['Chicken, broilers or fryers, breast']);
        });
    });

    describe('the FNDDS consumption prior — the within-rung tiebreak (plan U5)', () => {
        it('the canonical staple beats a same-rung sibling once it carries the prior — the max-fusion case', async () => {
            // The REAL extreme pair, unfudged: on this database `Rye flour, dark` scores base 0.40 for
            // `flour` while the full canonical name scores 0.14 — a 0.26 gap NO ladder-safe additive bonus
            // could close (that was measured, and is why the fusion is a max). With max-fusion the
            // canonical row's captured fraction (0.80, its real log-normalized weight) stands in for its
            // length-penalized similarity and wins the rung.
            await seedFoods(pool, [
                { id: 'f-rye', name: 'Rye flour, dark' },
                {
                    id: 'f-ap',
                    name: 'Wheat flour, white, all-purpose, enriched, bleached',
                    priorFraction: 0.8,
                },
            ]);

            const ranked = await rank('flour');

            expect(ranked[0]).toBe('Wheat flour, white, all-purpose, enriched, bleached');
        });

        it('⛔ a FULL prior still cannot cross a rung — the ladder guarantee, against the real join', async () => {
            await seedFoods(pool, [
                { id: 'f-attractor', name: 'Cookies, butter, commercially prepared', priorFraction: 1 },
                { id: 'f-butter', name: 'Butter, salted' },
            ]);

            const ranked = await rank('butter');

            expect(ranked[0]).toBe('Butter, salted');
        });

        it('foods without a prior rank exactly as before — absent joins as zero, never as a penalty', async () => {
            await seedFoods(pool, [
                { id: 'f-carob', name: 'Carob flour' },
                { id: 'f-wheat', name: 'Flour, wheat, all-purpose, enriched, bleached' },
            ]);

            const ranked = await rank('flour');

            expect(ranked[0]).toBe('Flour, wheat, all-purpose, enriched, bleached');
        });
    });

    describe('the shared ranking conformance contract', () => {
        registerRankingConformance({
            surface: 'food catalog',
            seed: async (rows: readonly ConformanceRow[]): Promise<void> => {
                await pool.query('TRUNCATE food CASCADE');
                await seedFoods(pool, rows);
            },
            search: async (query: string): Promise<readonly ConformanceRow[]> => {
                const hits = await dao.search(query);

                return hits.map((hit) => ({ id: hit.id, name: hit.name ?? '' }));
            },
        });
    });
});
