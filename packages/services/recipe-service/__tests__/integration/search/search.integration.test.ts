/**
 * T102 — recipe search integration test (tsvector FTS + facet aggregation + pagination).
 *
 * Exercises {@link SearchDal.search} against REAL Docker Postgres (migrated + seeded by
 * `tests/global-setup.ts`, which creates the `recipes` GIN indexes and the `search_vector` maintenance
 * trigger). It proves the behaviors the discovery surface depends on and which a mocked `db.execute`
 * cannot: the trigger-maintained weighted `search_vector` actually ranks matches, visibility scoping
 * (public + owner-owned, tombstones excluded) really filters, facet counts aggregate over the matched
 * set, and pagination slices the ranked page while reporting the unpaged total.
 *
 * Guarded with `describe.skipIf(!hasDatabaseUrl)` so a machine without the harness up simply skips
 * (matching the service's e2e ethos and the sibling `ingredients/search.integration.test.ts`).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';

import { RecipeSearchSortBy } from '@kitchensink/recipe-core';
import { createRecipeDrizzle, type RecipeDrizzle } from '../../../src/database/client.js';
import { SearchDal, type RecipeSearchFilters } from '../../../src/search/dal/search.dal.js';

/** The harness Postgres connection string. Unset → the suite skips entirely. */
const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];

/** Whether a test database is configured. */
const hasDatabaseUrl = Boolean(DATABASE_URL);

const OWNER = '01JSEARCH0OWNER0000000000A';
const OTHER = '01JSEARCH0OTHER0000000000B';

/** A recipe row to seed. */
interface SeedRecipe {
    ownerId: string;
    title: string;
    description: string;
    visibility: 'public' | 'private';
    dietaryFlags: string[];
    tags: string[];
    prepTimeMinutes: number;
    /** Defaults to `prepTimeMinutes` when omitted (existing corpus rows don't vary cook time). */
    cookTimeMinutes?: number;
    totalTimeMinutes: number;
    ingredientNamesText: string;
    deleted?: boolean;
}

describe.skipIf(!hasDatabaseUrl)('SearchDal search (integration: FTS + facets + pagination)', () => {
    let pool: pg.Pool;
    let db: RecipeDrizzle;
    let dal: SearchDal;

    /** Insert a recipe; the DB trigger builds its weighted `search_vector`. Returns the new id. */
    async function seed(recipe: SeedRecipe): Promise<string> {
        const result = await pool.query<{ id: string }>(
            `INSERT INTO recipes
                (owner_id, title, description, visibility, dietary_flags, tags,
                 prep_time_minutes, cook_time_minutes, total_time_minutes, servings,
                 ingredient_names_text, deleted_at)
             VALUES ($1, $2, $3, $4, $5::text[], $6::text[], $7, $8, $9, $10, $11, $12)
             RETURNING id`,
            [
                recipe.ownerId,
                recipe.title,
                recipe.description,
                recipe.visibility,
                recipe.dietaryFlags,
                recipe.tags,
                recipe.prepTimeMinutes,
                recipe.cookTimeMinutes ?? recipe.prepTimeMinutes,
                recipe.totalTimeMinutes,
                4,
                recipe.ingredientNamesText,
                recipe.deleted === true ? new Date() : null,
            ],
        );

        return result.rows[0]!.id;
    }

    /** Base search filters for OWNER (relevance, first page) with per-test overrides. */
    function filters(overrides: Partial<RecipeSearchFilters> = {}): RecipeSearchFilters {
        return {
            ownerId: OWNER,
            page: 1,
            pageSize: 20,
            sortBy: RecipeSearchSortBy.RELEVANCE,
            ...overrides,
        };
    }

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: DATABASE_URL });
        db = createRecipeDrizzle(pool);
        dal = new SearchDal(db);
    });

    afterAll(async () => {
        await pool.end();
    });

    beforeEach(async () => {
        // recipe_ingredients / steps / collections / versions / photos cascade from recipes.
        await pool.query('DELETE FROM recipes');
    });

    /** Seed a small corpus shared by several assertions. */
    async function seedCorpus(): Promise<void> {
        await seed({
            ownerId: OWNER,
            title: 'Weeknight Pasta',
            description: 'A quick tomato pasta.',
            visibility: 'public',
            dietaryFlags: ['vegetarian'],
            tags: ['dinner', 'quick'],
            prepTimeMinutes: 10,
            totalTimeMinutes: 20,
            ingredientNamesText: 'pasta tomato garlic',
        });
        await seed({
            ownerId: OWNER,
            title: 'Pasta Carbonara',
            description: 'Creamy egg pasta.',
            visibility: 'private',
            dietaryFlags: [],
            tags: ['dinner'],
            prepTimeMinutes: 15,
            totalTimeMinutes: 30,
            ingredientNamesText: 'pasta egg pancetta',
        });
        await seed({
            ownerId: OTHER,
            title: 'Pasta Salad',
            description: 'Cold summer pasta.',
            visibility: 'public',
            dietaryFlags: ['vegan'],
            tags: ['lunch'],
            prepTimeMinutes: 20,
            totalTimeMinutes: 20,
            ingredientNamesText: 'pasta cucumber olive',
        });
        await seed({
            ownerId: OTHER,
            title: 'Secret Pasta',
            description: "Someone else's private pasta.",
            visibility: 'private',
            dietaryFlags: [],
            tags: ['dinner'],
            prepTimeMinutes: 5,
            totalTimeMinutes: 10,
            ingredientNamesText: 'pasta secret sauce',
        });
        await seed({
            ownerId: OWNER,
            title: 'Grilled Chicken',
            description: 'No noodles here.',
            visibility: 'public',
            dietaryFlags: [],
            tags: ['dinner'],
            prepTimeMinutes: 10,
            totalTimeMinutes: 25,
            ingredientNamesText: 'chicken salt pepper',
        });
    }

    it('full-text matches ranked recipes and scopes visibility (public + own, not others private)', async () => {
        await seedCorpus();

        const { results } = await dal.search(filters({ query: 'pasta' }));
        const titles = results.map((r) => r.recipe.title);

        expect(titles).toContain('Weeknight Pasta'); // owner public
        expect(titles).toContain('Pasta Carbonara'); // owner private (visible to owner)
        expect(titles).toContain('Pasta Salad'); // other's public
        expect(titles).not.toContain('Secret Pasta'); // other's private — excluded
        expect(titles).not.toContain('Grilled Chicken'); // no lexeme match
        // Every hit carries a numeric relevance rank.
        expect(results.every((r) => typeof r.rank === 'number')).toBe(true);
    });

    it('excludes tombstoned (soft-deleted) recipes from results', async () => {
        await seed({
            ownerId: OWNER,
            title: 'Deleted Pasta',
            description: 'Tombstoned.',
            visibility: 'public',
            dietaryFlags: [],
            tags: ['dinner'],
            prepTimeMinutes: 10,
            totalTimeMinutes: 20,
            ingredientNamesText: 'pasta',
            deleted: true,
        });

        const { results, total } = await dal.search(filters({ query: 'pasta' }));

        expect(results).toHaveLength(0);
        expect(total).toBe(0);
    });

    it('aggregates facet counts (dietary flags + tags) over the matched set', async () => {
        await seedCorpus();

        const { facets } = await dal.search(filters({ query: 'pasta' }));

        const dietaryByValue = Object.fromEntries(facets.dietaryFlags.map((f) => [f.value, f.count]));
        const tagsByValue = Object.fromEntries(facets.tags.map((f) => [f.value, f.count]));

        // Matched set = {Weeknight Pasta, Pasta Carbonara, Pasta Salad}.
        expect(dietaryByValue['vegetarian']).toBe(1);
        expect(dietaryByValue['vegan']).toBe(1);
        expect(tagsByValue['dinner']).toBe(2);
        expect(tagsByValue['quick']).toBe(1);
        expect(tagsByValue['lunch']).toBe(1);
    });

    it('applies a dietary-flag filter alongside the text query', async () => {
        await seedCorpus();

        const { results } = await dal.search(filters({ query: 'pasta', dietaryFlags: ['vegetarian'] }));

        expect(results.map((r) => r.recipe.title)).toEqual(['Weeknight Pasta']);
    });

    it('applies a max-cook-time filter (REQ-030f) — excludes a longer cook time, includes the exact bound', async () => {
        const quickId = await seed({
            ownerId: OWNER,
            title: 'Quick Pasta Bowl',
            description: 'A quick tomato pasta.',
            visibility: 'public',
            dietaryFlags: [],
            tags: [],
            prepTimeMinutes: 5,
            cookTimeMinutes: 30,
            totalTimeMinutes: 35,
            ingredientNamesText: 'pasta tomato',
        });
        const slowId = await seed({
            ownerId: OWNER,
            title: 'Slow Braised Pasta',
            description: 'A long-simmered pasta.',
            visibility: 'public',
            dietaryFlags: [],
            tags: [],
            prepTimeMinutes: 5,
            cookTimeMinutes: 60,
            totalTimeMinutes: 65,
            ingredientNamesText: 'pasta beef',
        });

        // cookTime 60 is EXCLUDED at maxCookTime=30; cookTime 30 is INCLUDED (inclusive upper bound).
        const bounded = await dal.search(filters({ query: 'pasta', maxCookTime: 30 }));
        expect(bounded.results.map((r) => r.recipe.id)).toEqual([quickId]);
        expect(bounded.results.map((r) => r.recipe.id)).not.toContain(slowId);

        // Raising the bound to exactly the slow recipe's cook time includes it too.
        const wide = await dal.search(filters({ query: 'pasta', maxCookTime: 60 }));
        expect(wide.results.map((r) => r.recipe.id)).toEqual(expect.arrayContaining([quickId, slowId]));
    });

    it('paginates the ranked page while reporting the unpaged total', async () => {
        await seedCorpus();

        const firstPage = await dal.search(filters({ query: 'pasta', pageSize: 2 }));

        expect(firstPage.results).toHaveLength(2);
        expect(firstPage.total).toBe(3); // three visible pasta matches

        const secondPage = await dal.search(filters({ query: 'pasta', page: 2, pageSize: 2 }));

        expect(secondPage.results).toHaveLength(1);
        expect(secondPage.total).toBe(3);
    });

    it('browses visible recipes (no query) sorted by recency', async () => {
        await seedCorpus();

        const { results, total } = await dal.search(filters({ sortBy: RecipeSearchSortBy.RECENT }));

        // OWNER sees: 3 own (2 public + 1 private) + 2 of OTHER's? No — only OTHER's public one.
        // OWNER public: Weeknight Pasta, Grilled Chicken; OWNER private: Pasta Carbonara; OTHER public: Pasta Salad.
        expect(total).toBe(4);
        expect(results.map((r) => r.recipe.title)).not.toContain('Secret Pasta');
    });

    // verticals-3: the facet CTE samples the top-N matches. In browse mode EVERY row has rank 0, so
    // without a total-order tiebreak the N-row sample is arbitrary and facet counts flicker. With the
    // (rank DESC, created_at DESC, id) tiebreak the sample is the deterministic newest-N. Proven by
    // driving the sample boundary with an injected size of 2 over 3 rows whose created_at we control:
    // the two NEWEST (tagged 'keep') must be sampled and the oldest ('drop') excluded — every time.
    it('samples facets deterministically by (created_at DESC, id), not arbitrarily', async () => {
        // Explicit, distinct created_at so recency order is unambiguous (oldest → newest).
        const insertAt = async (title: string, tag: string, createdAt: string): Promise<void> => {
            await pool.query(
                `INSERT INTO recipes
                    (owner_id, title, description, visibility, dietary_flags, tags,
                     prep_time_minutes, cook_time_minutes, total_time_minutes, servings,
                     ingredient_names_text, created_at, updated_at)
                 VALUES ($1,$2,'',$3,'{}'::text[],$4::text[],5,5,10,4,$5,$6,$6)`,
                [OWNER, title, 'public', [tag], title.toLowerCase(), createdAt],
            );
        };

        await insertAt('Oldest', 'drop', '2026-01-01T00:00:00.000Z');
        await insertAt('Middle', 'keep', '2026-02-01T00:00:00.000Z');
        await insertAt('Newest', 'keep', '2026-03-01T00:00:00.000Z');

        // Sample size 2 → only the two newest rows feed the facets.
        const sampledDal = new SearchDal(db, 2);
        const first = await sampledDal.search(filters({ sortBy: RecipeSearchSortBy.RECENT }));
        const second = await sampledDal.search(filters({ sortBy: RecipeSearchSortBy.RECENT }));

        const tagCounts = (facets: typeof first.facets): Record<string, number> =>
            Object.fromEntries(facets.tags.map((bucket) => [bucket.value, bucket.count]));

        // The two newest are both 'keep'; the oldest 'drop' is beyond the sample and must not appear.
        expect(tagCounts(first.facets)).toEqual({ keep: 2 });
        expect(tagCounts(first.facets)['drop']).toBeUndefined();
        // Identical requests yield identical facet counts (the flicker is gone).
        expect(tagCounts(second.facets)).toEqual(tagCounts(first.facets));
    });
});
