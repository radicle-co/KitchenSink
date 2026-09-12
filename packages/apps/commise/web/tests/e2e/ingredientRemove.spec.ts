import { expect, test } from '@playwright/test';

import { route } from './utils/basePath';
import { makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';

/**
 * Plan 002 US6, through the real web app with the recipe-service contract intercepted: deleting an ingredient from a
 * recipe removes ONLY that row, and never affects another recipe. Remove is slot 2's direct control on a row whose
 * only action it is (the FAILED row here), and an item of the row's `⋮` menu on a row with more than one action (the
 * RESOLVED row, which also offers Change food; `ingredientRowPolicy.ts`, §3a). Both are driven.
 *
 * What only this tier proves: in a real browser the right row goes, the rest keep their values, and the save the
 * removal leads to writes this recipe and nothing else. Selectors are role/label/text only.
 */
/**
 * The lines' binding ids. They are UUIDs because the save's request body validates `ingredientId` as one and the client
 * parses it before the round trip: a slug id makes Publish fail in the browser and never reach the double (the trap
 * `E2E_INGREDIENT_IDS` records).
 */
const LINE_IDS = {
    rice: '55555555-5555-4555-8555-555555555551',
    saffron: '55555555-5555-4555-8555-555555555552',
    stock: '55555555-5555-4555-8555-555555555553',
} as const;

test.describe('removing an ingredient (plan 002 US6)', () => {
    test('Remove removes only its row, and the save touches only this recipe', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        const line = (ingredientId: string, name: string, resolutionStatus: 'RESOLVED' | 'FAILED') => ({
            ingredientId,
            name,
            quantity: { kind: 'exact' as const, value: 1 },
            unit: 'cup',
            isUserEntered: false,
            resolutionStatus,
            ...(resolutionStatus === 'FAILED' ? { unresolvedReason: 'sources_errored' as const } : {}),
        });
        const other = makeRecipeDetail({
            id: 'rec_other',
            ownerId: viewerId,
            title: 'Other Recipe',
            ingredients: [line(LINE_IDS.saffron, 'Saffron', 'RESOLVED')],
        });
        const store = await mockRecipeApi(page, {
            viewerId,
            recipes: [
                makeRecipeDetail({
                    id: 'rec_remove',
                    ownerId: viewerId,
                    title: 'Paella',
                    currentVersion: 1,
                    ingredients: [
                        line(LINE_IDS.rice, 'Rice', 'RESOLVED'),
                        line(LINE_IDS.saffron, 'Saffron', 'FAILED'),
                        line(LINE_IDS.stock, 'Stock', 'RESOLVED'),
                    ],
                }),
                other,
            ],
        });

        await page.goto(route('/recipes/rec_remove/edit'));
        await page.getByRole('button', { name: /Ingredients:/ }).click();
        await expect(page.getByRole('navigation', { name: 'Recipe wizard steps' })).toContainText('Step 2 of 4');
        const ingredients = page.getByRole('region', { name: 'Ingredients' });

        // Remove the middle row (a FAILED one) from the keyboard.
        await ingredients.getByRole('button', { name: 'Remove ingredient 2' }).focus();
        await page.keyboard.press('Enter');

        await expect(ingredients.getByRole('group', { name: /Ingredient \d name/ })).toHaveCount(2);
        // V1 sign-off item 11: focus moves on to the NEXT row's glyph, never to the page.
        await expect(ingredients.getByRole('button', { name: 'About Stock' })).toBeFocused();
        await expect(ingredients.getByRole('group', { name: 'Ingredient 1 name' })).toHaveText('Rice');
        await expect(ingredients.getByRole('group', { name: 'Ingredient 2 name' })).toHaveText('Stock');

        // And the first row, by pointer, from its `⋮` menu.
        await ingredients.getByRole('button', { name: 'Actions for Rice' }).click();
        await page.getByRole('menuitem', { name: 'Remove ingredient' }).click();
        await expect(ingredients.getByRole('group', { name: /Ingredient \d name/ })).toHaveCount(1);
        await expect(ingredients.getByRole('button', { name: 'About Stock' })).toBeFocused();
        await expect(ingredients.getByRole('group', { name: 'Ingredient 1 name' })).toHaveText('Stock');

        await page.getByRole('button', { name: /Review:/ }).click();
        await page.getByRole('button', { name: 'Publish' }).click();
        await expect(page.getByRole('heading', { name: 'Paella' })).toBeVisible();

        expect(store.get('rec_remove')?.ingredients.map((saved) => saved.ingredientId)).toEqual([LINE_IDS.stock]);
        // ⛔ Never affects another recipe: the other recipe's line on the same food is untouched.
        expect(store.get('rec_other')?.ingredients).toEqual(other.ingredients);
    });
});
