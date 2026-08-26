import { expect, test } from '@playwright/test';

import { route } from './utils/basePath';
import { mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';

/**
 * The add-ingredient LOOP, end to end (plan U28) — driven through the real create wizard (Next dev server +
 * Clerk session + client hooks + routing) with the recipe-service HTTP contract intercepted
 * (`utils/recipeApi`). Selectors are role/label only (per repo policy); no `waitForTimeout`.
 *
 * ⛔ WHY THIS FLOW EXISTS. "+ Add ingredient" used to append a blank row with no `ingredientId`.
 * `validateRecipeForm` then refused to advance past step 2 and `toCreateRecipeInput` DROPPED the row on
 * save — so a cook typed into a line that could never be part of their recipe, and the wizard's Next went
 * dead with no obvious cause. The button is now a request that hands them the picker. This asserts the whole
 * loop across the real router and the real hooks, which is the only tier that can see the button, the picker
 * and the wizard's gate together:
 *
 *  1. pressing it FOCUSES the picker's search field (the affordance actually lands);
 *  2. pressing it adds NO row, and the step stays advanceable (the dead end is gone, not moved);
 *  3. picking a food appends a real line, and the wizard advances with it.
 */
test.describe('add-ingredient loop (plan U28)', () => {
    test('“+ Add ingredient” opens the picker, adds no row, and a picked food completes the line', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId, tier: 'premium' });

        await page.goto(route('/recipes/new'));
        await expect(page.getByText('Step 1 of 4')).toBeVisible();
        await page.getByLabel('Title').fill('E2E Add Ingredient Loop');
        await page.getByLabel('Servings').fill('2');
        await page.getByLabel('Prep time (minutes)').fill('5');
        await page.getByLabel('Cook time (minutes)').fill('0');
        await page.getByRole('button', { name: 'Next: Ingredients' }).click();

        await expect(page.getByText('Step 2 of 4')).toBeVisible();
        const search = page.getByRole('searchbox', { name: 'Search ingredients' });
        const addIngredient = page.getByRole('button', { name: 'Add ingredient' });

        // The empty state invites the first action rather than showing an empty table.
        await expect(page.getByText('No ingredients yet. Add your first ingredient.')).toBeVisible();
        await expect(search).not.toBeFocused();

        // (1) The button hands the cook the picker.
        await addIngredient.click();
        await expect(search).toBeFocused();

        // (2) ⛔ AND ADDS NOTHING. The old behaviour appended `{ ingredientId: null, name: '', quantity: 1 }`
        // here, which is what wedged the wizard: no row means no unresolved row means Next still works.
        await expect(page.getByLabel('Ingredient 1 name')).toHaveCount(0);
        await expect(page.getByText('No ingredients yet. Add your first ingredient.')).toBeVisible();
        await expect(page.getByText('Every ingredient needs an item picked from the list.')).toHaveCount(0);

        // (3) Picking a food is what actually appends a line — with the food bound to it.
        await search.fill('sal');
        await page.getByRole('button', { name: 'Salt', exact: true }).click();
        await expect(page.getByLabel('Ingredient 1 name')).toHaveValue('Salt');
        // A resolved row wears no "no food" note — the note is reserved for a row that genuinely lacks one.
        await expect(
            page.getByText('No food chosen — this line won’t be saved. Remove it and add it from the search above.'),
        ).toHaveCount(0);

        // …and the recipe can now be finished. Before U28, a cook who had pressed the button first could not
        // get past this step at all without noticing and deleting the phantom row.
        await page.getByRole('button', { name: 'Next: Instructions' }).click();
        await expect(page.getByText('Step 3 of 4')).toBeVisible();
        await page.getByRole('button', { name: 'Add step' }).click();
        await page.getByLabel('Step 1 instruction').fill('Season to taste.');

        await page.getByRole('button', { name: 'Next: Review' }).click();
        await expect(page.getByText('Step 4 of 4')).toBeVisible();
        await page.getByRole('button', { name: 'Publish' }).click();

        await expect(page.getByRole('heading', { name: 'E2E Add Ingredient Loop' })).toBeVisible();
    });
});
