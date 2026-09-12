import { expect, test } from '@playwright/test';
import type { RecipeSnapshot } from '@kitchensink/recipe-core';

import { route } from './utils/basePath';
import { makeRecipeDetail, makeRecipeVersion, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';

/**
 * Recipe lines with no name, through the real web app (plan 002 R2, R9, R52; `docs/design/namelessLineCopy.md`),
 * with the recipe-service contract intercepted.
 *
 * What only this tier proves: the detail page's retry for lines food could not name refetches the REAL query and a
 * recovery lands focus on the Ingredients heading in a real browser; and a restore the server refuses shows the
 * refusal in the list and inside the preview, with the refused line marked. Selectors are role/label/text only.
 */
test.describe('recipe lines with no name (plan 002)', () => {
    test('a line food could not name offers one Try again, and a retry that names it moves focus to Ingredients', async ({
        page,
    }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        const recipe = makeRecipeDetail({
            id: 'rec_unreachable',
            ownerId: viewerId,
            title: 'Za’atar Flatbread',
            ingredients: [
                {
                    ingredientId: 'ing_zaatar',
                    quantity: { kind: 'exact', value: 2 },
                    unit: 'tbsp',
                    isUserEntered: false,
                    resolutionStatus: 'FOOD_UNREACHABLE',
                },
            ],
        });
        const store = await mockRecipeApi(page, { viewerId, recipes: [recipe] });

        await page.goto(route('/recipes/rec_unreachable'));
        await expect(page.getByRole('heading', { name: 'Za’atar Flatbread' })).toBeVisible();

        const ingredients = page.getByRole('region', { name: 'Ingredients' });

        await expect(ingredients.getByRole('checkbox', { name: '2 tbsp Ingredient not loaded' })).toBeVisible();
        // The visible sentence describes the one Try again it sits beside.
        await expect(ingredients.getByRole('button', { name: 'Try again' })).toHaveAccessibleDescription(
            'We couldn’t load one ingredient’s name and nutrition just now. Your recipe hasn’t changed.',
        );
        await expect(ingredients.getByRole('button', { name: 'Try again' })).toHaveCount(1);

        // Food answers on the next read.
        store.set('rec_unreachable', {
            ...recipe,
            ingredients: [
                {
                    ingredientId: 'ing_zaatar',
                    name: 'Za’atar',
                    quantity: { kind: 'exact', value: 2 },
                    unit: 'tbsp',
                    isUserEntered: false,
                    resolutionStatus: 'RESOLVED',
                },
            ],
        });
        await ingredients.getByRole('button', { name: 'Try again' }).click();

        await expect(ingredients.getByRole('checkbox', { name: '2 tbsp Za’atar' })).toBeVisible();
        await expect(ingredients.getByRole('button', { name: 'Try again' })).toHaveCount(0);
        await expect(page.getByRole('heading', { level: 2, name: 'Ingredients' })).toBeFocused();
    });

    test('a restore the server refuses says so in the list and inside the preview, marking the line', async ({
        page,
    }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        const recipeId = 'rec_restore_refused';
        const v1Snapshot: RecipeSnapshot = {
            version: 1,
            title: 'Weeknight Pasta',
            description: 'A fast pasta dinner.',
            steps: [{ id: 'step_1', recipeId, stepNumber: 1, instruction: 'Boil water.' }],
            ingredients: [
                // Its binding is gone and this version saved no name: the server cannot restore it.
                {
                    id: 'ri_1',
                    recipeId,
                    ingredientId: 'ing_gone',
                    quantity: { kind: 'exact', value: 2 },
                    unit: 'tbsp',
                    sortOrder: 1,
                    isUserEntered: false,
                },
            ],
            servings: 4,
            prepTimeMinutes: 10,
            cookTimeMinutes: 20,
        };
        const v2Snapshot: RecipeSnapshot = { ...v1Snapshot, version: 2, title: 'Weeknight Pasta, Revised' };

        await mockRecipeApi(page, {
            viewerId,
            recipes: [
                makeRecipeDetail({ id: recipeId, ownerId: viewerId, title: v2Snapshot.title, currentVersion: 2 }),
            ],
            recipeVersions: {
                [recipeId]: [
                    makeRecipeVersion({ id: 'ver_1', recipeId, versionNumber: 1, snapshot: v1Snapshot }),
                    makeRecipeVersion({ id: 'ver_2', recipeId, versionNumber: 2, snapshot: v2Snapshot }),
                ],
            },
            goneBindingIds: ['ing_gone'],
        });

        await page.goto(route(`/recipes/${recipeId}/versions`));
        await expect(page.getByRole('heading', { name: 'Version history' })).toBeVisible();

        await page.getByRole('button', { name: 'Restore version 1' }).click();
        await expect(page.getByRole('region', { name: 'Version history' }).getByRole('alert')).toHaveText(
            'This version can’t be restored: one of its ingredients no longer exists, and this version didn’t save its name. Nothing was changed. Preview the version to see which one.',
        );

        await page.getByRole('button', { name: 'Preview version 1' }).click();
        const dialog = page.getByRole('dialog');

        await dialog.getByRole('button', { name: 'Restore this version' }).click();
        await expect(dialog.getByRole('alert')).toHaveText(
            'This version can’t be restored: one of its ingredients no longer exists, and this version didn’t save its name. It’s marked below. Nothing was changed.',
        );
        await expect(dialog.getByText('2 tbsp Name not saved (can’t be restored)')).toBeVisible();
    });
});
