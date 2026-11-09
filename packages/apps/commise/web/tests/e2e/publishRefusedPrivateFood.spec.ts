import { expect, test } from '@playwright/test';

import { route } from './utils/basePath';
import { makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';

/**
 * A Publish the server refuses because a line uses a food only the cook can see (ADR-0029 section 4; private foods
 * spec section 7), through the real editor with the recipe-service contract intercepted.
 *
 * What only a browser shows: the refusal sheet opens over the editor, and its "open the food" action leaves the editor
 * where it is by opening the food page in a NEW tab, so the cook's unsaved recipe is never navigated away from.
 * Selectors are role, label and text only.
 */
const RECIPE_ID = 'ec000000-0000-4000-8000-0000000000f1';
const FOOD_ID = 'food_private_sauce';

test.describe('publish refused for a private food', () => {
    test('the refusal opens the food in a new tab and Back to editor leaves the draft in place', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        const recipe = makeRecipeDetail({
            id: RECIPE_ID,
            ownerId: viewerId,
            title: 'Sauce Night',
            cuisine: 'Italian',
            status: 'draft',
            visibility: 'public',
            currentVersion: 1,
            ingredients: [
                {
                    ingredientId: 'ing_private_sauce',
                    name: 'Secret Sauce',
                    foodId: FOOD_ID,
                    foodVisibility: 'private',
                    quantity: { kind: 'exact', value: 1 },
                    unit: 'tbsp',
                    isUserEntered: false,
                },
            ],
        });
        await mockRecipeApi(page, { viewerId, paidFeatures: 'granted', recipes: [recipe] });

        // Registered after the mock, so it answers first: the server's refusal of a public recipe holding a private food.
        await page.route(`**/api/v1/recipes/${RECIPE_ID}`, async (request) => {
            if (request.request().method() !== 'PATCH') {
                return request.fallback();
            }

            return request.fulfill({
                status: 400,
                json: {
                    code: 'PRIVATE_FOODS_ON_PUBLIC_RECIPE',
                    message: 'A public recipe cannot use a private food',
                    details: { lines: [{ sortOrder: 0, foodId: FOOD_ID }] },
                },
            });
        });

        await page.goto(route(`/recipes/${RECIPE_ID}/edit`));
        await page.getByRole('button', { name: 'Publish', exact: true }).click();

        const sheet = page.getByRole('dialog', { name: 'This recipe can’t be public yet' });
        await expect(sheet).toBeVisible();

        const popup = page.waitForEvent('popup');
        await sheet.getByRole('button', { name: /^Open .*Secret Sauce.* in a new tab$/u }).click();
        expect(new URL((await popup).url()).pathname).toMatch(new RegExp(`/foods/${FOOD_ID}$`, 'u'));

        // The editor was never navigated away from.
        await sheet.getByRole('button', { name: 'Back to editor' }).click();
        await expect(sheet).toBeHidden();
        await expect(page).toHaveURL(new RegExp(`/recipes/${RECIPE_ID}/edit$`, 'u'));

        // A refusal is not a failed save (designAnswers 2026-11-09): the header does not say "Couldn't save", there is no
        // save-failure notice and no Try again (which would send the same refused write), and Publish reopens the sheet.
        await expect(page.getByText(/couldn.t save/iu)).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
        await page.getByRole('button', { name: 'Publish', exact: true }).first().click();
        await expect(sheet).toBeVisible();
    });
});
