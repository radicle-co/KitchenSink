/**
 * A-017 — the total-time facet and the time bounds against REAL Postgres (LOCAL e2e tier,
 * `docs/CODING_STANDARDS.md` §7.1a): the editor stores 0 for "no time stated", so an untimed recipe must not count
 * as "Under 30 min", must fall in no facet bucket, and must sort AFTER every stated time under Quickest.
 * `search.dal.test.ts` pins the emitted SQL; only a database can show that the SQL means this.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';

import { RecipeSearchSortBy } from '@kitchensink/recipe-core';
import { createRecipeDrizzle } from '../../../src/database/client.js';
// Aliased: this file already has a local `seed()` that inserts ONE corpus row.
import { seed as reseedDeterministicWorld } from '../../../src/database/seed.js';
import { SearchDal, type RecipeSearchFilters } from '../../../src/search/dal/search.dal.js';
import { recipeDb } from '../../support/roleDb.js';

/** The tier's database, provisioned by the global setup under the production role model (ADR-0039). */
const roleDb = recipeDb();

const OWNER = '01JTIMEFACET0OWNER00000A';

describe('SearchDal time facet (e2e: 0 means no time stated)', () => {
    let pool: pg.Pool;
    let dal: SearchDal;

    /** Insert one public recipe with the given times. */
    async function seed(title: string, prep: number, cook: number, total: number): Promise<void> {
        await pool.query(
            `INSERT INTO recipes
                (owner_id, title, description, visibility, dietary_flags, tags,
                 prep_time_minutes, cook_time_minutes, total_time_minutes, servings, ingredient_names_text)
             VALUES ($1, $2, '', 'public', '{}'::text[], '{}'::text[], $3, $4, $5, 4, 'x')`,
            [OWNER, title, prep, cook, total],
        );
    }

    /** Base filters for OWNER (newest-first, first page) with per-test overrides. */
    function filters(overrides: Partial<RecipeSearchFilters> = {}): RecipeSearchFilters {
        return { ownerId: OWNER, page: 1, pageSize: 20, sortBy: RecipeSearchSortBy.RECENT, ...overrides };
    }

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: roleDb.appUrl });
        dal = new SearchDal(createRecipeDrizzle(pool));
    });

    afterAll(async () => {
        // Restore the seeded world the next file expects (see search.e2e.test.ts).
        await reseedDeterministicWorld(pool);
        await pool.end();
    });

    beforeEach(async () => {
        await pool.query('DELETE FROM recipes');
        await seed('Untimed', 0, 0, 0);
        await seed('Ten', 5, 5, 10);
        await seed('Twenty', 10, 10, 20);
        await seed('Thirty', 15, 15, 30);
        await seed('Forty five', 20, 25, 45);
        await seed('Ninety', 30, 60, 90);
    });

    it('maxTotalTime excludes the untimed recipe and includes the boundary', async () => {
        const { results } = await dal.search(filters({ maxTotalTime: 30 }));

        expect(results.map((r) => r.recipe.title).sort()).toEqual(['Ten', 'Thirty', 'Twenty']);
    });

    it('maxPrepTime and maxCookTime exclude the untimed recipe too', async () => {
        const prep = await dal.search(filters({ maxPrepTime: 15 }));
        const cook = await dal.search(filters({ maxCookTime: 15 }));

        expect(prep.results.map((r) => r.recipe.title).sort()).toEqual(['Ten', 'Thirty', 'Twenty']);
        expect(cook.results.map((r) => r.recipe.title).sort()).toEqual(['Ten', 'Thirty', 'Twenty']);
    });

    it('a search with no bound still returns the untimed recipe', async () => {
        const { results, total } = await dal.search(filters());

        expect(total).toBe(6);
        expect(results.map((r) => r.recipe.title)).toContain('Untimed');
    });

    it('the total-time buckets count stated times only, and sum to the stated-time recipes', async () => {
        const { facets } = await dal.search(filters());
        const byBucket = Object.fromEntries(facets.totalTime.map((b) => [b.value, b.count]));

        expect(byBucket).toEqual({ '0-15': 1, '16-30': 2, '31-60': 1, '61+': 1 });
        expect(facets.totalTime.reduce((sum, b) => sum + b.count, 0)).toBe(5);
    });

    it('Quickest lists the stated times ascending and the untimed recipe last', async () => {
        const { results } = await dal.search(filters({ sortBy: RecipeSearchSortBy.QUICKEST }));

        expect(results.map((r) => r.recipe.title)).toEqual([
            'Ten',
            'Twenty',
            'Thirty',
            'Forty five',
            'Ninety',
            'Untimed',
        ]);
    });

    it('Quickest pages across the timed/untimed boundary without losing or repeating a row', async () => {
        const first = await dal.search(filters({ sortBy: RecipeSearchSortBy.QUICKEST, pageSize: 5 }));
        const second = await dal.search(filters({ sortBy: RecipeSearchSortBy.QUICKEST, pageSize: 5, page: 2 }));

        expect(first.results.map((r) => r.recipe.title)).toEqual(['Ten', 'Twenty', 'Thirty', 'Forty five', 'Ninety']);
        expect(second.results.map((r) => r.recipe.title)).toEqual(['Untimed']);
    });
});
