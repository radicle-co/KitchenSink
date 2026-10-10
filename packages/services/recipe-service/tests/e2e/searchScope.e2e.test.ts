/**
 * `GET /api/v1/search/recipes?scope=community` — e2e proof, against the real Postgres harness, that Discover's
 * scope shows ONLY other cooks' public, published recipes (UX evaluation F13).
 *
 * The viewer's own draft, private and public-published recipes and another cook's DRAFT and PRIVATE recipes are all
 * seeded beside the one row that qualifies, and the same predicate must govern the page, the facets and the total
 * (they are three separate reads). The unscoped search is asserted too, so the scope is proven to NARROW a result
 * that previously included the viewer's own rows rather than to filter nothing.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { bootRecipeApp, type BootedRecipeApp } from './harness.js';
import { recipeDb } from '../support/roleDb.js';

const roleDb = recipeDb();

const VIEWER = '01JSCOPEE2E0000VIEWER0000A';
const OTHER = '01JSCOPEE2E00000OTHER0000B';
/** In every seeded title and in no other recipe, so `query=` scopes the sample to this spec's rows. */
const TOKEN = 'zzscopefixture';

interface Seed {
    readonly label: string;
    readonly ownerId: string;
    readonly visibility: 'public' | 'private';
    readonly status: 'draft' | 'published';
    readonly cuisine: string;
}

const SEEDS: readonly Seed[] = [
    { label: 'own draft', ownerId: VIEWER, visibility: 'public', status: 'draft', cuisine: 'greek' },
    { label: 'own private', ownerId: VIEWER, visibility: 'private', status: 'published', cuisine: 'greek' },
    { label: 'own public', ownerId: VIEWER, visibility: 'public', status: 'published', cuisine: 'greek' },
    { label: 'other draft', ownerId: OTHER, visibility: 'public', status: 'draft', cuisine: 'thai' },
    { label: 'other private', ownerId: OTHER, visibility: 'private', status: 'published', cuisine: 'thai' },
    { label: 'other public', ownerId: OTHER, visibility: 'public', status: 'published', cuisine: 'thai' },
];

interface SearchBody {
    results: { recipe: { title: string } }[];
    facets: { cuisine: { value: string; count: number }[]; totalTime: { value: string; count: number }[] };
    total: number;
}

describe('search scope=community (e2e, assembled app)', () => {
    let booted: BootedRecipeApp;
    let pool: pg.Pool;

    beforeAll(async () => {
        booted = await bootRecipeApp({ databaseUrl: roleDb.appUrl, devAuthUserId: VIEWER });
        pool = new pg.Pool({ connectionString: roleDb.appUrl, max: 3 });

        for (const seed of SEEDS) {
            await pool.query(
                `INSERT INTO recipes
                   (owner_id, title, visibility, status, cuisine, servings,
                    prep_time_minutes, cook_time_minutes, total_time_minutes)
                 VALUES ($1, $2, $3, $4, $5, 2, 5, 10, 20)`,
                [seed.ownerId, `${TOKEN} ${seed.label}`, seed.visibility, seed.status, seed.cuisine],
            );
        }
    });

    afterAll(async () => {
        await pool.query('DELETE FROM recipes WHERE owner_id = ANY($1)', [[OTHER, VIEWER]]);
        await pool.end();
        await booted?.close();
    });

    async function search(params: Record<string, string>): Promise<SearchBody> {
        const res = await fetch(
            `${booted.baseUrl}/api/v1/search/recipes?${new URLSearchParams({ query: TOKEN, ...params }).toString()}`,
        );

        expect(res.status).toBe(200);

        return (await res.json()) as SearchBody;
    }

    it("without a scope the viewer still sees their own rows (today's behaviour, unchanged)", async () => {
        const body = await search({});

        expect(body.results.map((hit) => hit.recipe.title).sort()).toEqual(
            [`${TOKEN} other public`, `${TOKEN} own draft`, `${TOKEN} own private`, `${TOKEN} own public`].sort(),
        );
        expect(body.total).toBe(4);
    });

    it("scope=community returns only another cook's public, published recipe", async () => {
        const body = await search({ scope: 'community' });

        expect(body.results.map((hit) => hit.recipe.title)).toEqual([`${TOKEN} other public`]);
    });

    it('the total and the facets agree with the rows — all three reads share one predicate', async () => {
        const body = await search({ scope: 'community' });

        expect(body.total).toBe(1);
        // greek is the viewer's own cuisine: it would be present (3) if the facet sample leaked their rows.
        expect(body.facets.cuisine).toEqual([{ value: 'thai', count: 1 }]);
        expect(body.facets.totalTime).toEqual([{ value: '16-30', count: 1 }]);
    });

    it('refuses an unknown scope with a 400', async () => {
        const res = await fetch(`${booted.baseUrl}/api/v1/search/recipes?scope=everyone`);

        expect(res.status).toBe(400);
    });
});
