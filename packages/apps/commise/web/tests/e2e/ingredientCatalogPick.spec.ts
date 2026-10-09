import { expect, test } from '@playwright/test';

import { E2E_CATALOG_FOOD, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';
import { mockFoodApi, ownFoodLedger } from './utils/foodApi';
import { addStep, openNewRecipe } from './utils/recipeEditor';

/**
 * The ingredient search's user story since plan 002 S5, driven through the real one-page editor (Next dev server + Clerk
 * session + client hooks + routing) with the recipe contract and food's progressive search intercepted
 * (`utils/recipeApi`, `utils/foodApi`).
 *
 * Playwright IS this feature's UI integration test (repo testing policy), so what it proves is the part no component
 * test can: that food's `GET /api/v1/foods/search/progressive` → two groups → tap → recipe's `POST
 * /api/v1/ingredients/by-food` → resolved-line round trip holds through the live clients, the live query cache and the
 * real editor — including that a catalog food (which has NO ingredient id of its own) ends up as a recipe line whose id
 * came from the ADMIT response, and that the recipe then publishes with it.
 *
 * When part of the search cannot answer, `ingredientSearchDegraded.spec.ts` has the story (it took this file's F2
 * case). A remote food's pick is `ingredientRemoteFoods.spec.ts`'s. Selectors are role/label only (per repo policy).
 * Serial (Clerk-authed).
 */
/** One of the cook's own foods, which food's authored search answers for “pepper”. */
const MY_PEPPER = { id: 'food_my_pepper', name: 'pepper, my cracked blend', score: 0.8 } as const;

test.describe('the ingredient search — the cook’s foods and the catalog’s (plan 002 S5)', () => {
    test('groups the cook’s own foods ahead of the catalog’s, and picking a catalog food admits it onto the recipe', async ({
        page,
    }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId, tier: 'premium' });
        await mockFoodApi(page, { authored: ownFoodLedger([MY_PEPPER]) });

        await openNewRecipe(page);
        await page.getByLabel('Title').fill('E2E Peppered Broth');
        await page.getByRole('radio', { name: 'Easy' }).click();

        // Ingredients.
        await page.getByRole('combobox', { name: 'Add an ingredient' }).fill('pepper');

        // Both groups render, labelled, the cook's own foods first (L1), and an own food says it is theirs (L4.2).
        const list = page.getByRole('listbox', { name: 'Food suggestions for ingredient 1' });
        await expect(list.getByRole('group')).toHaveText([/^Your foods/u, /^Food catalog/u, /^Not listed\?/u]);
        await expect(
            list
                .getByRole('group', { name: 'Your foods' })
                .getByRole('option', { name: `${MY_PEPPER.name}, your food` }),
        ).toBeVisible();

        // Pick the CATALOG food. It carries no ingredient id, so this must go through the admit round-trip before the
        // line can exist at all.
        const admit = page.waitForRequest(
            (request) => request.url().endsWith('/api/v1/ingredients/by-food') && request.method() === 'POST',
        );
        await list
            .getByRole('group', { name: 'Food catalog' })
            .getByRole('option', { name: E2E_CATALOG_FOOD.name })
            .click();
        expect((await admit).postDataJSON()).toEqual({ foodId: E2E_CATALOG_FOOD.foodId });

        // The line landed — with the name and status the ADMIT response supplied, not the suggestion's. A
        // regression that resolved straight off the suggestion would have no valid id to put here.
        await expect(page.getByRole('group', { name: 'Ingredient 1 name' })).toHaveText('Pepper, black, ground');
        // EDITED for plan 002 V1: a matched row shows NO status word (SPECIFY.1 rows 3-4, "a match is not news"), and
        // the old "Ingredient 1 status" label is gone. A match now reads as the row's info glyph, named for its food.
        await expect(page.getByRole('button', { name: 'About Pepper, black, ground' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'About Pepper, black, ground' })).toHaveAccessibleDescription('');

        // …and it is a real catalog id, so the recipe publishes (Publish validation rejects a line whose
        // `ingredientId` does not resolve). This is the falsifiable end of the story.
        await addStep(page, 'Simmer, then season generously.');
        await page.getByRole('button', { name: 'Publish' }).click();

        await expect(page.getByRole('heading', { name: 'E2E Peppered Broth' })).toBeVisible();
        // REQ-034 — every line came from the food database, so the custom note must NOT render (§S15). Guards against the
        // admit accidentally minting a user-entered row. The source note is asserted first, so the region is on screen.
        const nutrition = page.getByRole('region', { name: 'Nutrition (per serving)' });
        await expect(nutrition).toContainText('Nutrition comes from public food databases.');
        await expect(nutrition).not.toContainText('Custom ingredients count only the nutrition you entered for them.');
    });
});
