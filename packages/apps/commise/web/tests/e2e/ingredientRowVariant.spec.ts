import { expect, test } from '@playwright/test';

import { signInWithTicket } from './utils/auth';
import { route } from './utils/basePath';
import { makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';

/**
 * Curated U15 on the recipe form row (`docs/design/ingredientSpecialization.md` §S1, F3), through the real web app
 * with the recipe-service contract intercepted: a variant-bound line shows the root's name and the variant's dotted
 * line under it, a root-bound line beside it shows the name only, and the row's nutrition panel repeats the dotted line
 * under its heading. The lines use the two KTD-16 seed roots.
 *
 * What only this tier proves: the detail read's `variant` survives the editor's seed into a real browser row. The
 * per-state rules are pinned by the component tests (`RecipeIngredientsFields.test.tsx`). Selectors are role, label
 * and text only.
 */
const RECIPE_ID = 'rec_variant_row';

test.describe('a variant-bound line in the editor shows its dotted line (curated U15)', () => {
    test('the variant’s parts sit under the root name, and a root-bound line shows the name only', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, {
            viewerId,
            recipes: [
                makeRecipeDetail({
                    id: RECIPE_ID,
                    ownerId: viewerId,
                    title: 'Braise',
                    currentVersion: 1,
                    ingredients: [
                        {
                            ingredientId: '66666666-6666-4666-8666-666666666661',
                            foodId: 'food_beef_brisket',
                            variant: {
                                id: 'var_brisket_flat',
                                parts: [
                                    { attribute: 'cut', text: 'flat half' },
                                    { attribute: 'grade', text: 'choice' },
                                ],
                            },
                            name: 'beef brisket',
                            quantity: { kind: 'exact', value: 2 },
                            unit: 'lb',
                            isUserEntered: false,
                            resolutionStatus: 'RESOLVED',
                        },
                        {
                            ingredientId: '66666666-6666-4666-8666-666666666662',
                            foodId: 'food_chicken_breasts',
                            name: 'boneless skinless chicken breasts',
                            quantity: { kind: 'exact', value: 1 },
                            unit: 'lb',
                            isUserEntered: false,
                            resolutionStatus: 'RESOLVED',
                        },
                    ],
                }),
            ],
        });

        await page.goto(route(`/recipes/${RECIPE_ID}/edit`));
        await page.getByRole('button', { name: /Ingredients:/ }).click();
        await expect(page.getByRole('navigation', { name: 'Recipe wizard steps' })).toContainText('Step 2 of 4');
        const ingredients = page.getByRole('region', { name: 'Ingredients' });
        const rows = ingredients.getByRole('listitem');

        await expect(ingredients.getByRole('group', { name: 'Ingredient 1 name' })).toHaveText('beef brisket');
        await expect(rows.nth(0)).toContainText('flat half');
        await expect(rows.nth(0)).toContainText('choice');
        // Positive control beside the negative: the second row is there, and it carries no parts (R28).
        await expect(ingredients.getByRole('group', { name: 'Ingredient 2 name' })).toHaveText(
            'boneless skinless chicken breasts',
        );
        await expect(rows.nth(1)).not.toContainText('flat half');
        // Never one comma-joined label (§S4).
        await expect(ingredients.getByText('beef brisket, flat half')).toHaveCount(0);

        await ingredients.getByRole('button', { name: 'About beef brisket' }).click();
        await expect(page.getByRole('dialog', { name: 'beef brisket' })).toContainText('flat half');
    });
});
