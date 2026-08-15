/**
 * T042-test — unit tests for {@link SearchDal} over a mocked `db.execute` (no database).
 *
 * Pins the three responsibilities the DAL owns:
 *   1. **Row mapping** — `rowToRecipe` coerces a raw snake_case `recipes` row into the shared domain
 *      `Recipe` (nulls → `undefined`, timestamps → ISO-8601), never leaking `search_vector`.
 *   2. **FTS rank query shape** — a `query` search issues a ranked read using `ts_rank` +
 *      `plainto_tsquery` over `search_vector`, scoped to visible rows (`public` OR owner-owned) and
 *      excluding tombstones, paginated with `LIMIT`/`OFFSET`.
 *   3. **Facet aggregation** — a rank-sampling CTE (`LIMIT` sample) unnests `dietary_flags` + `tags`
 *      into grouped counts, returned alongside the page and the unpaged total.
 *
 * Query *shape* is asserted by compiling the `SQL` handed to `db.execute` through the production Postgres
 * dialect (bound values render as `$n` params, exactly as at runtime), so the tests pin the real emitted
 * SQL contract — including centrally-defined read-predicate columns — without a database.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { RecipeSearchSortBy } from '@kitchensink/recipe-core';

import type { RecipeDrizzle } from '../../../database/client.js';
import { makeRawRecipeSearchRow, makeRawFacetRow } from '../../__fixtures__/search.fixtures.js';
import {
    SearchDal,
    rowToRecipe,
    clampPageSize,
    clampPage,
    DEFAULT_SEARCH_PAGE_SIZE,
    FACET_SAMPLE_SIZE,
    MAX_FACET_SAMPLE_SIZE,
    type RecipeSearchFilters,
} from '../search.dal.js';
// The clamp's own ceiling, from the clamp's own module. It used to be spelled `MAX_SEARCH_PAGE_SIZE` and
// imported from `search.dal.js`; that name is now the WIRE bound in `@kitchensink/recipe-core` (which is a
// different concern — see `../../__tests__/pageSizeBound.test.ts`, which asserts the two agree).
import { MAX_PAGE_SIZE } from '../../../common/pagination.js';

/** A minimal `db.execute` mock. */
function makeDb(): { db: RecipeDrizzle; execute: ReturnType<typeof vi.fn> } {
    const execute = vi.fn();
    const db = { execute } as unknown as RecipeDrizzle;

    return { db, execute };
}

const dialect = new PgDialect();

/**
 * Compile the `SQL` handed to `db.execute` to its real Postgres text via the production dialect — the same
 * rendering path Drizzle uses at runtime. This faithfully resolves embedded column references (e.g. the
 * centralized `activeRecipe()` / `viewableBy()` read-predicates render as `"recipes"."deleted_at"` etc.)
 * and parameterizes bound values as `$n`, so the shape assertions pin the actual emitted SQL rather than a
 * lossy flatten that silently drops non-string chunks.
 */
function sqlText(value: unknown): string {
    return dialect.sqlToQuery(value as Parameters<PgDialect['sqlToQuery']>[0]).sql;
}

/**
 * The parameters bound to the statement handed to `db.execute`, rendered by the same production dialect.
 *
 * The companion to {@link sqlText}: asserting a value is in `params` (and NOT in the text) is what
 * distinguishes a parameterised query from one that spliced the value in, which `sqlText` alone cannot tell
 * apart — the number appears either way.
 */
function sqlParams(value: unknown): unknown[] {
    return dialect.sqlToQuery(value as Parameters<PgDialect['sqlToQuery']>[0]).params;
}

const OWNER = '01J000000000000000000FREE0';

/** Base filters (relevance sort, first page) with per-test overrides. */
function filters(overrides: Partial<RecipeSearchFilters> = {}): RecipeSearchFilters {
    return {
        ownerId: OWNER,
        page: 1,
        pageSize: 20,
        sortBy: RecipeSearchSortBy.RELEVANCE,
        ...overrides,
    };
}

/** Wire the three ordered `execute` reads: page rows, count, facet rows. */
function primeExecute(
    execute: ReturnType<typeof vi.fn>,
    opts: { rows?: Record<string, unknown>[]; total?: number; facets?: Record<string, unknown>[] } = {},
): void {
    execute
        .mockResolvedValueOnce({ rows: opts.rows ?? [] })
        .mockResolvedValueOnce({ rows: [{ total: opts.total ?? 0 }] })
        .mockResolvedValueOnce({ rows: opts.facets ?? [] });
}

describe('rowToRecipe', () => {
    it('maps a raw snake_case row to the domain Recipe, coercing nulls and dates', () => {
        const recipe = rowToRecipe(
            makeRawRecipeSearchRow({
                id: 'r-1',
                owner_id: OWNER,
                title: 'Pasta',
                description: 'Tasty',
                cuisine: 'italian',
                dietary_flags: ['vegan'],
                tags: ['dinner'],
                current_version: 3,
                created_at: '2026-07-01T00:00:00.000Z',
                updated_at: '2026-07-02T00:00:00.000Z',
            }) as never,
        );

        expect(recipe).toMatchObject({
            id: 'r-1',
            ownerId: OWNER,
            title: 'Pasta',
            description: 'Tasty',
            cuisine: 'italian',
            visibility: 'public',
            sourceType: 'user_created',
            dietaryFlags: ['vegan'],
            tags: ['dinner'],
            currentVersion: 3,
            createdAt: '2026-07-01T00:00:00.000Z',
            updatedAt: '2026-07-02T00:00:00.000Z',
        });
    });

    it('maps null optional columns to undefined and never emits search_vector', () => {
        const recipe = rowToRecipe(
            makeRawRecipeSearchRow({
                description: null,
                cuisine: null,
                source_url: null,
                source_attribution: null,
                cloned_from_id: null,
                deleted_at: null,
            }) as never,
        );

        expect(recipe.cuisine).toBeUndefined();
        expect(recipe.sourceUrl).toBeUndefined();
        expect(recipe.sourceAttribution).toBeUndefined();
        expect(recipe.clonedFromId).toBeUndefined();
        expect(recipe.deletedAt).toBeUndefined();
        expect(recipe.description).toBe(''); // required field defaults to empty string
        expect(recipe).not.toHaveProperty('searchVector');
        expect(recipe).not.toHaveProperty('search_vector');
    });

    it('normalizes a Date timestamp to an ISO-8601 string', () => {
        const recipe = rowToRecipe(
            makeRawRecipeSearchRow({ created_at: new Date('2026-07-01T12:00:00.000Z') }) as never,
        );

        expect(recipe.createdAt).toBe('2026-07-01T12:00:00.000Z');
    });

    // ── CR-001 read-model fields ────────────────────────────────────────────────────────────────────
    it('maps the trigger-maintained aggregate: numeric average → number, count as-is', () => {
        const recipe = rowToRecipe(makeRawRecipeSearchRow({ average_rating: '4.50', rating_count: 12 }) as never);

        expect(recipe.averageRating).toBe(4.5);
        expect(recipe.ratingCount).toBe(12);
    });

    it('OMITS averageRating (never 0) when the recipe is unrated', () => {
        const recipe = rowToRecipe(makeRawRecipeSearchRow({ average_rating: null, rating_count: 0 }) as never);

        expect(recipe).not.toHaveProperty('averageRating');
        expect(recipe.ratingCount).toBe(0);
    });

    it('maps difficulty when stated and omits it when NULL', () => {
        expect(rowToRecipe(makeRawRecipeSearchRow({ difficulty: 'hard' }) as never).difficulty).toBe('hard');
        expect(rowToRecipe(makeRawRecipeSearchRow({ difficulty: null }) as never)).not.toHaveProperty('difficulty');
    });

    it('derives usesPremiumCapability from visibility + sourceType (never visibility alone)', () => {
        // Chosen-private → PRO.
        expect(
            rowToRecipe(makeRawRecipeSearchRow({ visibility: 'private', source_type: 'user_created' }) as never)
                .usesPremiumCapability,
        ).toBe(true);
        // Forced-private import → NOT PRO (the trap `visibility === 'private'` would get wrong).
        expect(
            rowToRecipe(makeRawRecipeSearchRow({ visibility: 'private', source_type: 'imported_physical' }) as never)
                .usesPremiumCapability,
        ).toBe(false);
        // Public → never PRO.
        expect(
            rowToRecipe(makeRawRecipeSearchRow({ visibility: 'public', source_type: 'user_created' }) as never)
                .usesPremiumCapability,
        ).toBe(false);
    });

    it('resolves coverPhotoUrl from the cover key + CDN base, and omits it without a key or a base', () => {
        // Key + CDN base → absolute URL.
        expect(
            rowToRecipe(makeRawRecipeSearchRow({ cover_photo_key: 'recipes/o/r/photos/x.jpg' }) as never, 'https://cdn')
                .coverPhotoUrl,
        ).toBe('https://cdn/recipes/o/r/photos/x.jpg');
        // Key present but NO CDN base → omitted (never a malformed relative URL).
        expect(
            rowToRecipe(makeRawRecipeSearchRow({ cover_photo_key: 'recipes/o/r/photos/x.jpg' }) as never),
        ).not.toHaveProperty('coverPhotoUrl');
        // No photo → omitted even with a base.
        expect(
            rowToRecipe(makeRawRecipeSearchRow({ cover_photo_key: null }) as never, 'https://cdn'),
        ).not.toHaveProperty('coverPhotoUrl');
    });
});

describe('clampPageSize / clampPage', () => {
    it('defaults an absent or non-finite page size', () => {
        expect(clampPageSize(undefined)).toBe(DEFAULT_SEARCH_PAGE_SIZE);
        expect(clampPageSize(Number.NaN)).toBe(DEFAULT_SEARCH_PAGE_SIZE);
    });

    it('clamps page size into [1, MAX] and truncates fractions', () => {
        expect(clampPageSize(0)).toBe(1);
        expect(clampPageSize(999)).toBe(MAX_PAGE_SIZE);
        expect(clampPageSize(7.9)).toBe(7);
    });

    it('clamps page to a minimum of 1', () => {
        expect(clampPage(undefined)).toBe(1);
        expect(clampPage(0)).toBe(1);
        expect(clampPage(-3)).toBe(1);
        expect(clampPage(4)).toBe(4);
    });
});

describe('SearchDal.search', () => {
    let db: RecipeDrizzle;
    let execute: ReturnType<typeof vi.fn>;
    let dal: SearchDal;

    beforeEach(() => {
        ({ db, execute } = makeDb());
        dal = new SearchDal(db);
    });

    it('issues exactly three reads: page, count, facets', async () => {
        primeExecute(execute);

        await dal.search(filters({ query: 'pasta' }));

        expect(execute).toHaveBeenCalledTimes(3);
    });

    it('builds an FTS rank query scoped to visible, non-tombstoned rows', async () => {
        primeExecute(execute);

        await dal.search(filters({ query: 'pasta' }));

        const pageSql = sqlText(execute.mock.calls[0]![0]);

        expect(pageSql).toContain('ts_rank');
        expect(pageSql).toContain("plainto_tsquery('english'");
        expect(pageSql).toContain('search_vector @@');
        // Read-scoping via the centralized predicates (S-R3 + W8-a.3): tombstone + (public OR owner) +
        // (published OR owner). Bound literals are $n params, so we pin the qualified columns + operators.
        expect(pageSql).toContain('"deleted_at" is null');
        expect(pageSql).toContain('"visibility" =');
        expect(pageSql).toContain('"status" ='); // W8-a.3: a public DRAFT must not surface in search
        expect(pageSql).toContain('"owner_id" =');
        expect(pageSql).toContain('LIMIT');
        expect(pageSql).toContain('OFFSET');
    });

    it('omits the FTS predicate when no query is supplied (browse mode)', async () => {
        primeExecute(execute);

        await dal.search(filters());

        const pageSql = sqlText(execute.mock.calls[0]![0]);

        expect(pageSql).not.toContain('plainto_tsquery');
        // Still scoped by visibility + tombstone predicate (S-R3 centralized read-predicates).
        expect(pageSql).toContain('"deleted_at" is null');
        expect(pageSql).toContain('"visibility" =');
    });

    it('adds cuisine, dietary-flag, tag, time, and ingredient predicates when present', async () => {
        primeExecute(execute);

        await dal.search(
            filters({
                query: 'pasta',
                cuisine: 'italian',
                dietaryFlags: ['vegan'],
                tags: ['dinner'],
                maxPrepTime: 15,
                maxCookTime: 20,
                maxTotalTime: 45,
                ingredientIds: ['00000000-0000-4000-8000-0000000000aa'],
            }),
        );

        const pageSql = sqlText(execute.mock.calls[0]![0]);

        expect(pageSql).toContain('cuisine =');
        expect(pageSql).toContain('dietary_flags @>');
        expect(pageSql).toContain('tags @>');
        expect(pageSql).toContain('prep_time_minutes <=');
        expect(pageSql).toContain('cook_time_minutes <=');
        expect(pageSql).toContain('total_time_minutes <=');
        expect(pageSql).toContain('recipe_ingredients');
    });

    it('omits the cook-time predicate when maxCookTime is absent (REQ-030f)', async () => {
        primeExecute(execute);

        await dal.search(filters({ query: 'pasta' }));

        const pageSql = sqlText(execute.mock.calls[0]![0]);

        expect(pageSql).not.toContain('cook_time_minutes <=');
    });

    describe('facet sample size is bounded at construction (fail closed)', () => {
        // This is the value that used to be spliced into the statement with `sql.raw(String(...))`. It is now a
        // bound parameter, so injection is off the table; what remains is an absurd sample making EVERY search
        // scan the table, because the facet CTE runs on every request. Refusing it here turns a silent
        // production pathology into an immediate boot failure. These cases red if the guard is removed.
        it.each([
            ['zero', 0],
            ['negative', -1],
            ['fractional', 2.5],
            ['NaN', Number.NaN],
            ['Infinity', Number.POSITIVE_INFINITY],
            ['above the ceiling', MAX_FACET_SAMPLE_SIZE + 1],
        ])('refuses %s', (_label, size) => {
            expect(() => new SearchDal({} as never, size)).toThrow(RangeError);
        });

        it.each([
            ['the default', FACET_SAMPLE_SIZE],
            ['a small test value', 2],
            ['the ceiling itself', MAX_FACET_SAMPLE_SIZE],
        ])('accepts %s', (_label, size) => {
            expect(() => new SearchDal({} as never, size)).not.toThrow();
        });
    });

    it('aggregates facets via a rank-sampling CTE that unnests dietary_flags and tags', async () => {
        primeExecute(execute);

        await dal.search(filters({ query: 'pasta' }));

        const facetSql = sqlText(execute.mock.calls[2]![0]);

        expect(facetSql).toContain('unnest');
        expect(facetSql).toContain('dietary_flags');
        expect(facetSql).toContain('tags');
        expect(facetSql).toContain('count(*)');
        // The rank sample ceiling is a BOUND PARAMETER, so it is in the params and NOT in the statement text.
        // This assertion used to be `toContain(String(FACET_SAMPLE_SIZE))`, which passed only because
        // `sql.raw(String(...))` spliced the number into the SQL — i.e. the old test was inadvertently
        // asserting the injection-prone form. Flipped deliberately: it now reds if `sql.raw` comes back.
        expect(facetSql).not.toContain(String(FACET_SAMPLE_SIZE));
        expect(facetSql).toMatch(/LIMIT\s+\$\d+/);
        expect(sqlParams(execute.mock.calls[2]![0])).toContain(FACET_SAMPLE_SIZE);
        // W8-a.9 facet dimensions: cuisine (non-null scalar) + total-time buckets (mutually-exclusive CASE).
        expect(facetSql).toContain("'cuisine'");
        expect(facetSql).toContain('cuisine IS NOT NULL');
        expect(facetSql).toContain("'total_time'");
        expect(facetSql).toContain('total_time_minutes <= 15');
        expect(facetSql).toContain("'61+'");
    });

    it('returns mapped results with rank, grouped facets, and the unpaged total', async () => {
        primeExecute(execute, {
            rows: [
                makeRawRecipeSearchRow({ id: 'a', title: 'Pasta Primavera', rank: 0.9 }),
                makeRawRecipeSearchRow({ id: 'b', title: 'Pasta Bake', rank: 0.4 }),
            ],
            total: 7,
            facets: [
                makeRawFacetRow({ facet: 'dietary_flags', value: 'vegetarian', count: 2 }),
                makeRawFacetRow({ facet: 'tags', value: 'dinner', count: 5 }),
                makeRawFacetRow({ facet: 'tags', value: 'quick', count: 3 }),
                makeRawFacetRow({ facet: 'cuisine', value: 'italian', count: 4 }),
                makeRawFacetRow({ facet: 'total_time', value: '16-30', count: 6 }),
                makeRawFacetRow({ facet: 'total_time', value: '61+', count: 1 }),
            ],
        });

        const result = await dal.search(filters({ query: 'pasta' }));

        expect(result.results.map((r) => r.recipe.id)).toEqual(['a', 'b']);
        expect(result.results[0]!.rank).toBe(0.9);
        expect(result.total).toBe(7);
        expect(result.facets.dietaryFlags).toEqual([{ value: 'vegetarian', count: 2 }]);
        expect(result.facets.tags).toEqual([
            { value: 'dinner', count: 5 },
            { value: 'quick', count: 3 },
        ]);
        // W8-a.9: the new facet dimensions fold into their own buckets.
        expect(result.facets.cuisine).toEqual([{ value: 'italian', count: 4 }]);
        expect(result.facets.totalTime).toEqual([
            { value: '16-30', count: 6 },
            { value: '61+', count: 1 },
        ]);
    });

    it('handles an empty result set (no rows, zero total, empty facets)', async () => {
        primeExecute(execute, { rows: [], total: 0, facets: [] });

        const result = await dal.search(filters({ query: 'nothing-matches' }));

        expect(result.results).toEqual([]);
        expect(result.total).toBe(0);
        expect(result.facets).toEqual({ dietaryFlags: [], tags: [], cuisine: [], totalTime: [] });
    });

    it('orders by title when sortBy=title', async () => {
        primeExecute(execute);

        await dal.search(filters({ query: 'pasta', sortBy: RecipeSearchSortBy.TITLE }));

        const pageSql = sqlText(execute.mock.calls[0]![0]);

        expect(pageSql).toContain('title ASC');
    });

    it('orders by recency when sortBy=recent', async () => {
        primeExecute(execute);

        await dal.search(filters({ query: 'pasta', sortBy: RecipeSearchSortBy.RECENT }));

        const pageSql = sqlText(execute.mock.calls[0]![0]);

        expect(pageSql).toContain('created_at DESC');
    });

    it('orders by ascending total time when sortBy=quickest (W8-a.9)', async () => {
        primeExecute(execute);

        await dal.search(filters({ query: 'pasta', sortBy: RecipeSearchSortBy.QUICKEST }));

        const pageSql = sqlText(execute.mock.calls[0]![0]);

        expect(pageSql).toContain('total_time_minutes ASC');
        expect(pageSql).toContain('created_at DESC'); // stable tiebreak
    });

    it('orders by the clone-count correlated subquery when sortBy=most-cloned (W8-a.9)', async () => {
        primeExecute(execute);

        await dal.search(filters({ query: 'pasta', sortBy: RecipeSearchSortBy.MOST_CLONED }));

        const pageSql = sqlText(execute.mock.calls[0]![0]);

        // Popularity = how many recipes were cloned FROM this one, over the indexed cloned_from_id.
        expect(pageSql).toContain('count(*)');
        expect(pageSql).toContain('cloned_from_id');
        expect(pageSql).toContain('created_at DESC'); // the all-zero (nothing cloned) case stays deterministic
    });
});
