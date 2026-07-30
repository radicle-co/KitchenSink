/**
 * Contract-conformance test for the SEARCH vertical (DIVERGENCE #3).
 *
 * Drives the REAL `@kitchensink/recipe-service-client` against the REAL booted app so the search response
 * contract is proven end to end. The reconciliation KEPT the server's object-per-hit envelope
 * (`results: { recipe, rank? }[]`) and tightened the client + spec TO it (the client's type previously
 * claimed a bare `Recipe[]`, which silently mismatched the server's envelope — a consumer reading
 * `results[0].title` would get `undefined`), removed the never-built `highlights`/`cuisine`-facet/
 * `appliedFilters`, and set `sortBy` to the three real values (`relevance`/`recent`/`title`). This suite
 * locks the runtime envelope + the `sortBy` values so the contract cannot silently drift again.
 *
 * Recipes are seeded via raw `fetch` (create-recipe has its own divergence, #5). The nested `recipe` is
 * asserted field-level, not full-schema, because the recipe-detail serialization diverges separately (#6).
 * Runs only when the harness DB is configured.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RecipeServiceClient } from '@kitchensink/recipe-service-client';

import { bootRecipeApp, hasDatabaseUrl, type BootedRecipeApp } from '../../../tests/e2e/harness.js';

/** The dev-bypass owner ULID this suite creates recipes as. */
const OWNER = '01JSEARCHCONTRACT00000000A';

/** A seeded catalog ingredient (Flour) from the baseline global setup. */
const FLOUR_ID = '00000000-0000-4000-8000-0000000000aa';

/** Two distinctive titles this suite owns, so its assertions survive other recipes in the shared DB. */
const TITLE_A = 'Zeppole Contract Alpha';
const TITLE_B = 'Zeppole Contract Beta';

async function seedRecipe(client: RecipeServiceClient, title: string): Promise<void> {
    // Seeded through the typed client end to end (create now fully conforms — #5 + #8).
    await client.createRecipe({
        title,
        servings: 2,
        prepTimeMinutes: 5,
        cookTimeMinutes: 10,
        totalTimeMinutes: 15,
        tags: ['contract'],
        dietaryFlags: ['vegetarian'],
        ingredients: [{ ingredientId: FLOUR_ID, name: 'Flour', quantity: 1 }],
        steps: [{ instruction: 'Mix.' }],
    });
}

describe.skipIf(!hasDatabaseUrl)('search vertical — client ↔ server contract conformance', () => {
    let booted: BootedRecipeApp;
    let client: RecipeServiceClient;

    beforeAll(async () => {
        booted = await bootRecipeApp({ devAuthUserId: OWNER });
        client = new RecipeServiceClient({ baseUrl: booted.baseUrl });

        // Seed B before A so a title sort (A before B) proves ordering, not insertion order.
        await seedRecipe(client, TITLE_B);
        await seedRecipe(client, TITLE_A);
    });

    afterAll(async () => {
        await booted.close();
    });

    it('returns the { recipe, rank? } envelope + a facets/pagination block through the typed client', async () => {
        const response = await client.searchRecipes({ tags: ['contract'] });

        // Each hit is the object-per-hit envelope — results[i].recipe, NOT a bare Recipe.
        const titles = response.results.map((hit) => hit.recipe.title);
        expect(titles).toContain(TITLE_A);
        expect(titles).toContain(TITLE_B);

        // Pagination + facets envelope is present.
        expect(response.total).toBeGreaterThanOrEqual(2);
        expect(typeof response.page).toBe('number');
        expect(typeof response.hasMore).toBe('boolean');

        // Facets are the object-per-bucket array `{ value, count }[]` (NOT a { value: count } map) — the
        // extensible shape (#7). Both seeds carry the `vegetarian` dietary flag.
        expect(Array.isArray(response.facets.dietaryFlags)).toBe(true);
        const vegetarian = response.facets.dietaryFlags?.find((bucket) => bucket.value === 'vegetarian');
        expect(vegetarian).toBeDefined();
        expect(typeof vegetarian?.count).toBe('number');
        expect(vegetarian?.count).toBeGreaterThanOrEqual(2);
    });

    it('honours sortBy=title (the reconciled enum value) — A orders before B', async () => {
        const response = await client.searchRecipes({ tags: ['contract'], sortBy: 'title' });

        const ours = response.results
            .map((hit) => hit.recipe.title)
            .filter((title) => title === TITLE_A || title === TITLE_B);
        expect(ours.indexOf(TITLE_A)).toBeLessThan(ours.indexOf(TITLE_B));
    });

    it('honours sortBy=recent — newest first (A was seeded after B)', async () => {
        const response = await client.searchRecipes({ tags: ['contract'], sortBy: 'recent' });

        const ours = response.results
            .map((hit) => hit.recipe.title)
            .filter((title) => title === TITLE_A || title === TITLE_B);
        expect(ours.indexOf(TITLE_A)).toBeLessThan(ours.indexOf(TITLE_B));
    });
});
