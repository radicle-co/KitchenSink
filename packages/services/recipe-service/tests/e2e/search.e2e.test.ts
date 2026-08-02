/**
 * W8-a.1 / W8-a.3 / W8-a.9 — e2e proof of the search read surface through the fully ASSEMBLED recipe app
 * (`GET /api/v1/search/recipes`) against the real Postgres harness. Pins the client-visible HTTP contract for
 * the three shipped search changes at the DB level, where the unit tests can only assert SQL shape:
 *
 *   - **Draft exclusion (W8-a.3, security):** a `visibility=public, status=draft` recipe owned by someone
 *     else is ABSENT from a viewer's results and from the facet sample — the leak the status predicate closes.
 *   - **Facet dimensions (W8-a.9):** the response carries `cuisine` counts and mutually-exclusive
 *     `totalTime` buckets over the (draft-excluded) match sample.
 *   - **Sorts (W8-a.9) + calories (W8-a.1):** `sortBy=quickest` orders by ascending total time, and each
 *     hit's `recipe.leadCaloriesPerServing` is surfaced from the denormalized column.
 *
 * The booted app authenticates as VIEWER (dev bypass). Recipes are seeded via a direct pg pool (so drafts
 * and other owners' rows exist), each carrying a unique FTS token so `query=` scopes the sample to this
 * spec's rows. Skips when no test database is configured.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { bootRecipeApp, hasDatabaseUrl, type BootedRecipeApp } from './harness.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];

const VIEWER = '01JSEARCHE2E000VIEWER0000A';
const OTHER_OWNER = '01JSEARCHE2E0000OWNER0000B';
/** A token present in every seeded title but (deliberately) in no other recipe, so `query=` scopes to us. */
const TOKEN = 'zzsearchfixture';
/** A separate token for the REQ-030f cook-time rows, isolated from the `TOKEN` total-count assertions. */
const COOK_TOKEN = 'zzcooktimefixture';

interface SeededRecipe {
    readonly ownerId: string;
    readonly status: 'draft' | 'published';
    readonly cuisine: string;
    readonly totalTime: number;
    readonly calories: number | null;
    readonly title: string;
}

interface CookTimeSeededRecipe {
    readonly title: string;
    readonly cookTime: number;
}

interface SearchHit {
    recipe: { id: string; title: string; leadCaloriesPerServing?: number };
}

interface FacetBucket {
    value: string;
    count: number;
}

interface SearchBody {
    results: SearchHit[];
    facets: { cuisine: FacetBucket[]; totalTime: FacetBucket[] };
    total: number;
}

describe.skipIf(!hasDatabaseUrl)('search read surface (e2e, assembled app)', () => {
    let booted: BootedRecipeApp;
    let pool: pg.Pool;

    beforeAll(async () => {
        booted = await bootRecipeApp({ devAuthUserId: VIEWER });
        pool = new pg.Pool({ connectionString: DATABASE_URL, max: 3 });

        const rows: SeededRecipe[] = [
            {
                ownerId: OTHER_OWNER,
                status: 'published',
                cuisine: 'italian',
                totalTime: 20,
                calories: 300,
                title: `${TOKEN} quick italian`,
            },
            {
                ownerId: OTHER_OWNER,
                status: 'published',
                cuisine: 'thai',
                totalTime: 75,
                calories: null,
                title: `${TOKEN} slow thai`,
            },
            // A PUBLIC DRAFT owned by someone else — must never surface to the viewer (W8-a.3).
            {
                ownerId: OTHER_OWNER,
                status: 'draft',
                cuisine: 'italian',
                totalTime: 10,
                calories: 999,
                title: `${TOKEN} secret draft`,
            },
        ];

        for (const r of rows) {
            await pool.query(
                `INSERT INTO recipes
                   (owner_id, title, visibility, status, cuisine, servings,
                    prep_time_minutes, cook_time_minutes, total_time_minutes, lead_calories_per_serving)
                 VALUES ($1, $2, 'public', $3, $4, 2, 5, 10, $5, $6)`,
                [r.ownerId, r.title, r.status, r.cuisine, r.totalTime, r.calories],
            );
        }

        // REQ-030f — two published public rows with distinct cook times, isolated by COOK_TOKEN.
        const cookRows: CookTimeSeededRecipe[] = [
            { title: `${COOK_TOKEN} quick sear`, cookTime: 30 },
            { title: `${COOK_TOKEN} slow braise`, cookTime: 60 },
        ];

        for (const r of cookRows) {
            await pool.query(
                `INSERT INTO recipes
                   (owner_id, title, visibility, status, cuisine, servings,
                    prep_time_minutes, cook_time_minutes, total_time_minutes)
                 VALUES ($1, $2, 'public', 'published', 'italian', 2, 5, $3, $3)`,
                [OTHER_OWNER, r.title, r.cookTime],
            );
        }
    });

    afterAll(async () => {
        await pool.query('DELETE FROM recipes WHERE owner_id = ANY($1)', [[OTHER_OWNER, VIEWER]]);
        await pool.end();
        await booted?.close();
    });

    async function search(params: Record<string, string>): Promise<SearchBody> {
        const qs = new URLSearchParams({ query: TOKEN, ...params }).toString();
        const res = await fetch(`${booted.baseUrl}/api/v1/search/recipes?${qs}`);
        expect(res.status).toBe(200);
        return (await res.json()) as SearchBody;
    }

    it("excludes another owner's public DRAFT from results and total (W8-a.3 leak closed)", async () => {
        const body = await search({});

        expect(body.total).toBe(2); // the two published rows only — the draft is invisible
        const titles = body.results.map((h) => h.recipe.title);
        expect(titles).not.toContain(`${TOKEN} secret draft`);
    });

    it('surfaces cuisine + total-time facets over the draft-excluded sample (W8-a.9)', async () => {
        const body = await search({});

        // italian would be 2 if the draft leaked; it is 1 because the draft is excluded from the sample.
        expect(body.facets.cuisine).toContainEqual({ value: 'italian', count: 1 });
        expect(body.facets.cuisine).toContainEqual({ value: 'thai', count: 1 });
        // total_time buckets: 20 → '16-30', 75 → '61+' (the draft's 10 → '0-15' must be absent).
        expect(body.facets.totalTime).toContainEqual({ value: '16-30', count: 1 });
        expect(body.facets.totalTime).toContainEqual({ value: '61+', count: 1 });
        expect(body.facets.totalTime.find((b) => b.value === '0-15')).toBeUndefined();
    });

    it('orders by ascending total time for sortBy=quickest and surfaces denormalized calories (W8-a.9/.1)', async () => {
        const body = await search({ sortBy: 'quickest' });

        expect(body.results.map((h) => h.recipe.title)).toEqual([`${TOKEN} quick italian`, `${TOKEN} slow thai`]);
        // The 20-min italian carries its denormalized headline calories; the thai row seeded NULL → omitted.
        expect(body.results[0]!.recipe.leadCaloriesPerServing).toBe(300);
        expect(body.results[1]!.recipe.leadCaloriesPerServing).toBeUndefined();
    });

    it('filters by maxCookTime (REQ-030f): a 60-min cook time is excluded at max=30, a 30-min one is included', async () => {
        const bounded = await search({ query: COOK_TOKEN, maxCookTime: '30' });

        expect(bounded.total).toBe(1);
        const boundedTitles = bounded.results.map((h) => h.recipe.title);
        expect(boundedTitles).toContain(`${COOK_TOKEN} quick sear`);
        expect(boundedTitles).not.toContain(`${COOK_TOKEN} slow braise`);

        // Raising the bound to exactly the slow row's cook time includes both (inclusive upper bound).
        const wide = await search({ query: COOK_TOKEN, maxCookTime: '60' });
        expect(wide.total).toBe(2);
    });
});
