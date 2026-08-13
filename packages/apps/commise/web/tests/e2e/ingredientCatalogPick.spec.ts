import { expect, test } from '@playwright/test';

import { route } from './utils/basePath';
import { E2E_INGREDIENT_IDS, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';

/**
 * Search Stage 2 — the BLENDED ingredient typeahead's user story, driven through the real create wizard
 * (Next dev server + Clerk session + client hooks + routing) with the recipe-service HTTP contract
 * intercepted (`utils/recipeApi`, which serves one `local` and one `catalog` suggestion for any query).
 *
 * Playwright IS this feature's UI integration test (repo testing policy), so what it proves is the part no
 * component test can: that the real `GET /api/v1/ingredients/suggest` → render → tap → `POST
 * /api/v1/ingredients/by-food` → resolved-line round trip actually holds through the live client, the live query
 * cache, and the real wizard — including that a catalog hit (which has NO ingredient id of its own) ends up
 * as a recipe line whose id came from the ADMIT response, and that the recipe then publishes with it.
 *
 * Selectors are role/label only (per repo policy). Serial (Clerk-authed).
 */
test.describe('blended ingredient typeahead — food-catalog suggestions (search Stage 2)', () => {
    test('sections local vs catalog suggestions, and picking a catalog hit admits it onto the recipe', async ({
        page,
    }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId, tier: 'premium' });

        await page.goto(route('/recipes/new'));
        await expect(page.getByText('Step 1 of 4')).toBeVisible();
        await page.getByLabel('Title').fill('E2E Peppered Broth');
        await page.getByRole('radio', { name: 'Easy' }).click();
        await page.getByRole('button', { name: 'Next: Ingredients' }).click();

        // Step 2 (Ingredients).
        await expect(page.getByText('Step 2 of 4')).toBeVisible();
        await page.getByRole('searchbox', { name: 'Search ingredients' }).fill('pepper');

        // Both provenance sections render, as separate labeled regions — the caller's own catalog rows and
        // the food-catalog golden records that were invisible to this typeahead before Stage 2.
        const ownSection = page.getByRole('region', { name: 'Your ingredients' });
        const catalogSection = page.getByRole('region', { name: 'Food catalog' });
        await expect(ownSection).toBeVisible();
        await expect(catalogSection).toBeVisible();
        await expect(ownSection.getByRole('button', { name: 'Salt', exact: true })).toBeVisible();
        // Provenance is legible, not implied.
        await expect(catalogSection.getByText('USDA', { exact: true })).toBeVisible();

        // Pick the CATALOG row. It carries no ingredient id, so this must go through the admit round-trip
        // before the line can exist at all.
        await catalogSection.getByRole('button', { name: 'Pepper, black, ground' }).click();

        // The line landed — with the name and status the ADMIT response supplied, not the suggestion's. A
        // regression that resolved straight off the suggestion would have no valid id to put here.
        await expect(page.getByLabel('Ingredient 1 name')).toHaveValue('Pepper, black, ground');
        await expect(page.getByLabel('Ingredient 1 status')).toHaveText('Resolved');

        // …and it is a real catalog id, so the recipe publishes (Publish validation rejects a line whose
        // `ingredientId` does not resolve). This is the falsifiable end of the story.
        await page.getByRole('button', { name: 'Next: Instructions' }).click();
        await expect(page.getByText('Step 3 of 4')).toBeVisible();
        await page.getByRole('button', { name: 'Add step' }).click();
        await page.getByLabel('Step 1 instruction').fill('Simmer, then season generously.');
        await page.getByRole('button', { name: 'Next: Photos' }).click();
        await expect(page.getByText('Step 4 of 4')).toBeVisible();
        await page.getByRole('button', { name: 'Publish' }).click();

        await expect(page.getByRole('heading', { name: 'E2E Peppered Broth' })).toBeVisible();
        // REQ-034 — every line came from the food database (no freeform), so the partial-nutrition
        // disclosure must NOT render. Guards against the admit accidentally minting a user-entered row.
        await expect(
            page.getByText('Nutrition includes USDA database items; user-entered ingredients are marked Custom.'),
        ).toHaveCount(0);
    });

    test('F2 — an unavailable food catalog degrades to the local section plus a non-blocking notice', async ({
        page,
    }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId, tier: 'premium' });

        // Override the blended read for THIS test only: food-service is down, so the server answered 200
        // with the local section and `catalogAvailability: 'unavailable'`. Registered after `mockRecipeApi`
        // so it takes precedence (Playwright matches the most recently added route first).
        await page.route('**/api/v1/ingredients/suggest**', (routeToFulfill) =>
            routeToFulfill.fulfill({
                json: {
                    suggestions: [
                        {
                            provenance: 'local',
                            ingredient: {
                                id: E2E_INGREDIENT_IDS.salt,
                                name: 'Salt',
                                foodId: 'food_salt',
                                isUserEntered: false,
                                createdAt: '2026-01-01T00:00:00.000Z',
                            },
                        },
                    ],
                    catalogAvailability: 'unavailable',
                },
            }),
        );

        await page.goto(route('/recipes/new'));
        await expect(page.getByText('Step 1 of 4')).toBeVisible();
        await page.getByLabel('Title').fill('E2E Degraded Catalog');
        await page.getByRole('button', { name: 'Next: Ingredients' }).click();
        await expect(page.getByText('Step 2 of 4')).toBeVisible();

        await page.getByRole('searchbox', { name: 'Search ingredients' }).fill('salt');

        // The typeahead still works: the caller's own section renders in full…
        await expect(page.getByRole('region', { name: 'Your ingredients' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Salt', exact: true })).toBeVisible();
        // …the catalog section is simply absent (not an error, not an empty state)…
        await expect(page.getByRole('region', { name: 'Food catalog' })).toHaveCount(0);
        await expect(page.getByText('No matching ingredients found.')).toHaveCount(0);
        // …and the degradation is disclosed honestly rather than silently swallowed.
        await expect(
            page.getByText('Showing your ingredients only — the food catalog is unavailable right now.'),
        ).toBeVisible();

        // The local row is still fully pickable — the whole point of F2.
        await page.getByRole('button', { name: 'Salt', exact: true }).click();
        await expect(page.getByLabel('Ingredient 1 name')).toHaveValue('Salt');
    });
});
