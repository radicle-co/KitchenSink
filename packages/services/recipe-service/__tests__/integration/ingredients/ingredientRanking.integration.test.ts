/**
 * Plan U5 + U6 — the LOCAL surface's tiered ranking and widened retrieval, against a REAL Postgres.
 *
 * ## Why this surface, and why a unit test cannot stand in for this file
 *
 * **92.8% of the 448-recipe import's lines were decided here**, before the food catalog was consulted, and
 * the plan's corrected Problem frame calls the local table "the likely whole story". The defect is a TIE,
 * measured on `postgres:16` with `pg_trgm`, 2026-08-22:
 *
 * | expression                                | value |
 * | ----------------------------------------- | ----- |
 * | `word_similarity('flour', 'Flour')`       | 1.00  |
 * | `word_similarity('flour', 'Carob flour')` | 1.00  |
 *
 * Both maximal, because `word_similarity` scores the best matching word EXTENT and does not penalise extra
 * words. `name ASC` then decides, and `'Carob flour' < 'Flour'`. The attractor won by the alphabet.
 *
 * The tier is computed IN SQL — a second implementation, in a second language, of `recipe-core`'s ranking
 * vocabulary — and the retrieval predicate is SQL too. `src/ingredients/dal/__tests__/` can assert the
 * statement's shape; only a database can assert that PostgreSQL's regex engine, `normalize(…, NFD)`,
 * `[[:alnum:]]` under a UTF-8 ctype and the collation agree with JavaScript's. And the pre-U5 DAL test is
 * mock-only — the plan notes it "passes with the `WHERE` clause arbitrarily broken".
 *
 * ## Mutation lens
 *
 * Each case fails if the ladder is removed, if a rung's predicate is inverted, if the head rule is applied
 * to the name the way it is applied to the query, if the SQL fold stops mirroring `rankingTerms.ts`, if the
 * head-term retrieval branch is dropped (the `sifted flour` case), if `raw` injection stops firing or starts
 * firing on a suppressed head, or if the base metric is swapped for `similarity` (the `flor` case, which
 * would stop being RETRIEVED at all, not merely re-ranked).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { registerRankingConformance } from '@kitchensink/service-test-harness';
import type { ConformanceRow } from '@kitchensink/service-test-harness';

import { createRecipeDrizzle, type RecipeDrizzle } from '../../../src/database/client.js';
import { IngredientsDal } from '../../../src/ingredients/dal/ingredients.dal.js';
import { makeCanonicalName } from '../../../src/ingredients/__fixtures__/ingredients.fixtures.js';
import { seed } from '../../../src/database/seed.js';

/** The harness Postgres connection string. Unset → the suite skips entirely. */
const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];

/** Whether a test database is configured. */
const hasDatabaseUrl = Boolean(DATABASE_URL);

describe.skipIf(!hasDatabaseUrl)('IngredientsDal tiered ranking (integration)', () => {
    let pool: pg.Pool;
    let db: RecipeDrizzle;
    let dal: IngredientsDal;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: DATABASE_URL });
        db = createRecipeDrizzle(pool);
        dal = new IngredientsDal(db);
    });

    afterAll(async () => {
        // This suite wipes `ingredients` per test, which destroys the baseline catalog every other
        // integration spec validates recipe lines against (T043b). `seed` restores the whole seeded world
        // and is idempotent; `fileParallelism: false` makes that enough for any spec running after us.
        //
        // ⛔ WIPE FIRST, then seed — the order is load-bearing and getting it wrong took nine other suites
        // down. The seed's `ON CONFLICT DO NOTHING` is keyed on `id`, but `idx_ingredients_freeform_name` is
        // a UNIQUE index on `lower(name)`: a fixture row named `Flour` under this suite's own id collides
        // with the seed's `Flour` under the seed's id, which is a conflict the `ON CONFLICT (id)` clause
        // does not cover, so the INSERT raises rather than skipping. Leaving ANY fixture row behind here
        // therefore breaks the seeded world for every spec that runs later.
        await pool.query('DELETE FROM recipe_ingredients');
        await pool.query('DELETE FROM ingredients');
        await seed(pool);
        await pool.end();
    });

    beforeEach(async () => {
        await pool.query('DELETE FROM recipe_ingredients');
        await pool.query('DELETE FROM ingredients');
    });

    /** Seed freeform rows and return the ranked names for a query. */
    async function rank(names: readonly string[], query: string, limit?: number): Promise<readonly string[]> {
        for (const name of names) {
            await dal.createFreeform(makeCanonicalName(name));
        }

        const results = await dal.search(query, undefined, limit);

        return results.map((row) => row.name);
    }

    describe('the tie that decided 92.8% of the import (U5)', () => {
        it('`flour` returns `Flour`, not the alphabetically-earlier `Carob flour`', async () => {
            const ranked = await rank(['Carob flour', 'Flour'], 'flour');

            expect(ranked[0]).toBe('Flour');
            // Still RETURNED — this is a ranking fix, not a retrieval filter.
            expect(ranked).toContain('Carob flour');
        });

        it('⛔ the base metric alone still TIES, and `name ASC` still prefers the attractor', async () => {
            // Proves the case above passes because of the ladder and not for some unrelated reason. If this
            // ever stops holding, the premise of this whole unit has changed and the fixture is stale.
            const { rows } = await pool.query<{ flour: string; carob: string; carob_first: boolean }>(
                `SELECT word_similarity('flour', 'Flour')::text AS flour,
                        word_similarity('flour', 'Carob flour')::text AS carob,
                        ('Carob flour' < 'Flour') AS carob_first`,
            );

            expect(rows[0]!.flour).toBe(rows[0]!.carob);
            expect(rows[0]!.carob_first).toBe(true);
        });

        it('`milk` returns a milk, not `Crackers, milk`', async () => {
            const ranked = await rank(['Crackers, milk', 'Milk, whole'], 'milk');

            expect(ranked[0]).toBe('Milk, whole');
        });

        it('prefers the HEAD-term row over a longer name that merely contains the query', async () => {
            const ranked = await rank(['Carob flour', 'Flour, wheat, all-purpose, enriched'], 'flour');

            expect(ranked[0]).toBe('Flour, wheat, all-purpose, enriched');
        });
    });

    describe('the handoffs `representativeUserInput.test.ts` records against ranking (U5/U6)', () => {
        it('bridges a PLURAL: `eggs` reaches the singular catalog name', async () => {
            const ranked = await rank(['Eggnog', 'Egg, whole, raw'], 'eggs');

            expect(ranked[0]).toBe('Egg, whole, raw');
        });

        it('bridges a DIACRITIC: `jalapeño` reaches the row spelled without one', async () => {
            const ranked = await rank(['Peppers, sweet, green', 'Jalapeno peppers'], 'jalapeño peppers');

            expect(ranked[0]).toBe('Jalapeno peppers');
        });

        it('bridges COMMA INVERSION both ways', async () => {
            const names = ['Carob flour', 'Flour, all purpose'];

            expect((await rank(names, 'flour, all purpose'))[0]).toBe('Flour, all purpose');

            await pool.query('DELETE FROM ingredients');

            expect((await rank(names, 'all purpose flour'))[0]).toBe('Flour, all purpose');
        });
    });

    describe('the head-term retrieval widening (U6)', () => {
        it('⛔ RETRIEVES the row a multi-token query means even when it shares only the head term', async () => {
            // This is the 268-unmatched-lines case. `plainto_tsquery('english', 'sifted flour')` is
            // `sift & flour`, and `Flour, wheat, all-purpose` carries only one of the two; word similarity
            // for the whole phrase falls under the 0.6 `<%` threshold and the `ILIKE` is a literal
            // substring. Before U6 the row was never in the candidate set at all.
            const ranked = await rank(['Flour, wheat, all-purpose', 'Sugars, granulated'], 'sifted flour');

            expect(ranked).toContain('Flour, wheat, all-purpose');
            expect(ranked[0]).toBe('Flour, wheat, all-purpose');
        });

        it('does not let the widening flood the page — the ladder sorts the extras below the real match', async () => {
            const ranked = await rank(
                ['Flour, wheat, all-purpose', 'Carob flour', 'Bread flour', 'Sugars, granulated'],
                'sifted flour',
            );

            expect(ranked[0]).toBe('Flour, wheat, all-purpose');
            expect(ranked).not.toContain('Sugars, granulated');
        });

        it('leaves the SINGLE-token predicate alone — `flor` still resolves (KTD-1, 0.600)', async () => {
            const ranked = await rank(['All-purpose flour', 'Unsalted butter'], 'flor');

            expect(ranked).toContain('All-purpose flour');
            expect(ranked).not.toContain('Unsalted butter');
        });
    });

    describe('`raw` injection (U6)', () => {
        it('`chives` prefers `Chives, raw` over `Chives, freeze-dried`', async () => {
            const ranked = await rank(['Chives, freeze-dried', 'Chives, raw'], 'chives');

            expect(ranked[0]).toBe('Chives, raw');
        });

        it('`butter` gains no raw affinity — a never-raw head is suppressed', async () => {
            // If the affinity fired here it would prefer a row that says `raw` about a manufactured food.
            const ranked = await rank(['Butter, salted', 'Butter, raw cream'], 'butter');

            expect(ranked[0]).toBe('Butter, raw cream');
            expect(ranked[1]).toBe('Butter, salted');
        });

        it('⛔ can never cross a rung: an exact match beats a raw-carrying head match', async () => {
            const ranked = await rank(['Chives', 'Chives, raw'], 'chives');

            expect(ranked[0]).toBe('Chives');
        });
    });

    describe('the shared ranking conformance contract', () => {
        registerRankingConformance({
            surface: 'local ingredients',
            seed: async (rows: readonly ConformanceRow[]): Promise<void> => {
                await pool.query('DELETE FROM recipe_ingredients');
                await pool.query('DELETE FROM ingredients');

                for (const row of rows) {
                    const created = await dal.createFreeform(makeCanonicalName(row.name));

                    if (row.priorFraction !== undefined) {
                        // U5: seed the CAPTURED prior column the local rendering reads (0038).
                        await pool.query('UPDATE ingredients SET prior_fraction = $1 WHERE id = $2', [
                            row.priorFraction,
                            created.id,
                        ]);
                    }
                }
            },
            search: async (query: string): Promise<readonly ConformanceRow[]> => {
                const results = await dal.search(query, undefined, 50);

                return results.map((row) => ({ id: row.id, name: row.name }));
            },
        });
    });
});
