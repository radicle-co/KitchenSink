import { expect, test, type Page } from '@playwright/test';

import { makeRecipeDetail, mockRecipeApi, readViewerAppId, type MockRecipeApiOptions } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';
import { chooseRowAction, openRecipeEditor } from './utils/recipeEditor';

/**
 * Plan 002 US5, through the real web app with the recipe-service contract intercepted: a matched ingredient in the
 * editor shows an info glyph; activating it shows that food's nutrition per 100 g, read in the BACKGROUND by the
 * editor's one batch read (`POST /api/v1/ingredients/food-nutrition`), which also feeds the running total.
 * (`ingredientStatusExplanation.md` §6b, SPECIFY.4; plan 002 R30: calories live in the panel, not the row.)
 *
 * What only this tier proves: the batch read is really issued for the recipe's foods on open, its answer reaches both
 * the panel and the total in a real browser, and a failed read offers a Try again that reads again.
 * Selectors are role/label/text only.
 */
const seedEditor = async (page: Page, foodNutrition: MockRecipeApiOptions['foodNutrition']): Promise<void> => {
    await signInWithTicket(page);
    const viewerId = await readViewerAppId(page);
    await mockRecipeApi(page, {
        viewerId,
        foodNutrition,
        recipes: [
            makeRecipeDetail({
                id: 'ec000000-0000-4000-8000-000000000015',
                ownerId: viewerId,
                title: 'Rice Bowl',
                servings: 1,
                currentVersion: 2,
                ingredients: [
                    {
                        ingredientId: 'ing_rice',
                        foodId: 'food_rice',
                        name: 'Arborio rice',
                        quantity: { kind: 'exact', value: 300 },
                        unit: 'g',
                        isUserEntered: false,
                        resolutionStatus: 'RESOLVED',
                    },
                ],
            }),
        ],
    });

    await openRecipeEditor(page, 'ec000000-0000-4000-8000-000000000015');
};

test.describe('a matched ingredient shows its nutrition in the editor (plan 002 US5)', () => {
    // REWRITTEN for the read rows (build spec §7.5.1): a matched row is quiet, and its figures open from ⋯ Food details.
    test('⋯ Food details opens the food’s figures per 100 g, and the total uses the same read', async ({ page }) => {
        await seedEditor(page, { food_rice: { caloriesPer100g: 130, proteinGPer100g: 2.7, carbsGPer100g: 28 } });
        const ingredients = page.getByRole('region', { name: 'Ingredients' });

        // R30: no calorie chip on the row, and no status word on a match.
        await expect(ingredients.getByRole('list')).not.toContainText('390 cal');
        await expect(ingredients.getByRole('button', { name: /: Arborio rice$/u })).toHaveCount(0);
        // The total comes from the background read: 300 g at 130 kcal / 100 g, one serving.
        await expect(ingredients).toContainText('390 cal per serving · 1 of 1 counted');

        await chooseRowAction(page, 'Arborio rice', 'Food details');
        const panel = page.getByRole('dialog', { name: 'Arborio rice' });
        await expect(panel).toContainText('Per 100 g');
        await expect(panel).toContainText('130');
        await expect(panel).toContainText('2.7 g');
        // Fat is not published: an em dash and one footnote, never 0.
        await expect(panel).toContainText('— means this figure isn’t published for this food.');

        await page.keyboard.press('Escape');
        await expect(panel).toHaveCount(0);
        await expect(ingredients.getByRole('button', { name: 'Actions for Arborio rice' })).toBeFocused();
    });

    test('a failed read says so in the panel and the total, and Try again reads again', async ({ page }) => {
        await seedEditor(page, { food_rice: 'unavailable' });

        await chooseRowAction(page, 'Arborio rice', 'Food details');
        const panel = page.getByRole('dialog', { name: 'Arborio rice' });
        await expect(panel).toContainText('We couldn’t load the nutrition just now. Try again.');

        const reread = page.waitForRequest(
            (request) => request.url().endsWith('/api/v1/ingredients/food-nutrition') && request.method() === 'POST',
        );
        await panel.getByRole('button', { name: 'Try again' }).click();
        await reread;
    });

    test.describe('at 320 × 640 (WCAG 1.4.10 reflow)', () => {
        test.use({ viewport: { width: 320, height: 640 } });

        test('the open panel does not scroll the page sideways', async ({ page }) => {
            await seedEditor(page, { food_rice: { caloriesPer100g: 130 } });

            await chooseRowAction(page, 'Arborio rice', 'Food details');
            await expect(page.getByRole('dialog', { name: 'Arborio rice' })).toContainText('Per 100 g');
            const overflow = await page.evaluate(
                () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
            );
            expect(overflow).toBeLessThanOrEqual(0);
        });
    });
});
