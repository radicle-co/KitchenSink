import { expect, test } from '@playwright/test';

import { makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';
import { ingredientOpen, openRecipeEditor } from './utils/recipeEditor';

/**
 * Plan 002 US6, through the real web app with the recipe-service contract intercepted: deleting an ingredient from a
 * recipe removes ONLY that row, and never affects another recipe. REWRITTEN for the UI overhaul's read rows (build spec
 * §7.5.1): Remove is never a row button, always the last item of the row's `⋯`; it is driven from the keyboard on the
 * FAILED row and by pointer on a RESOLVED one.
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
            id: 'ec000000-0000-4000-8000-000000000016',
            ownerId: viewerId,
            title: 'Other Recipe',
            ingredients: [line(LINE_IDS.saffron, 'Saffron', 'RESOLVED')],
        });
        const store = await mockRecipeApi(page, {
            viewerId,
            recipes: [
                makeRecipeDetail({
                    id: 'ec000000-0000-4000-8000-000000000024',
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

        await openRecipeEditor(page, 'ec000000-0000-4000-8000-000000000024');
        const ingredients = page.getByRole('region', { name: 'Ingredients' });

        const rows = ingredients.getByRole('button', { name: /^Edit / });

        // Remove the middle row (a FAILED one) from the keyboard, through its `⋯`.
        await ingredients.getByRole('button', { name: 'Actions for Saffron' }).focus();
        await page.keyboard.press('Enter');
        await page.getByRole('menuitem', { name: 'Remove ingredient' }).focus();
        await page.keyboard.press('Enter');

        await expect(rows).toHaveCount(2);
        // §7.5.1: focus moves on to the NEXT row's open control, never to the page.
        await expect(ingredientOpen(ingredients, 'Stock')).toBeFocused();
        await expect(rows).toHaveText(['1 cupRice', '1 cupStock']);

        // And the first row, by pointer.
        await ingredients.getByRole('button', { name: 'Actions for Rice' }).click();
        await page.getByRole('menuitem', { name: 'Remove ingredient' }).click();
        await expect(rows).toHaveCount(1);
        await expect(ingredientOpen(ingredients, 'Stock')).toBeFocused();

        // The seed is published, so its one write is Save changes (slice 7, D1).
        await page.getByRole('button', { name: 'Save changes' }).click();
        await expect(page.getByRole('heading', { name: 'Paella' })).toBeVisible();

        expect(
            store.get('ec000000-0000-4000-8000-000000000024')?.ingredients.map((saved) => saved.ingredientId),
        ).toEqual([LINE_IDS.stock]);
        // ⛔ Never affects another recipe: the other recipe's line on the same food is untouched.
        expect(store.get('ec000000-0000-4000-8000-000000000016')?.ingredients).toEqual(other.ingredients);
    });
});
