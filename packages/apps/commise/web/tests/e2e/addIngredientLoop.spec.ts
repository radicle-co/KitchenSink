import { expect, test } from '@playwright/test';

import { mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { addStep, fillTimes, ingredientOpen, openNewRecipe } from './utils/recipeEditor';
import { signInWithTicket } from './utils/auth';
import { mockFoodApi } from './utils/foodApi';

/**
 * The add-ingredient LOOP, end to end (plan U28, rewritten for plan 002 V1 B8) — driven through the real one-page editor
 * (Next dev server + Clerk session + client hooks + routing) with the recipe contract and food's search intercepted
 * (`utils/recipeApi`, `utils/foodApi`). Selectors are role/label only (per repo policy); no `waitForTimeout`.
 *
 * ⛔ WHY THIS FLOW EXISTS. "+ Add ingredient" once appended a blank row with no `ingredientId`, which
 * `validateRecipeForm` refused and `toCreateRecipeInput` DROPPED on save, so the old wizard's Next went dead with no
 * obvious cause. Since B8 the trailing row IS the entry: an "Add an ingredient" field after the last line
 * (`docs/design/rowEditorOpenDecisions.md` items 1 and 3). This asserts the loop across the real router and hooks:
 *
 *  1. an empty recipe shows the field and no row, and nothing is refused;
 *  2. text the field holds is not a line: Publish refuses it, and puts the cook back in the field with the list open (R7);
 *  3. picking a food appends a real line, the field is empty and keeps focus for the next one, and the recipe publishes.
 *
 * REWRITTEN for slice 7: the refusal that was the wizard's Next is now Publish's (the one gate, `useRecipeEditor`).
 */
test.describe('add-ingredient loop (plan U28, B8)', () => {
    test('the trailing field adds no row until a food is picked, and a pick completes the line', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId, tier: 'premium' });
        await mockFoodApi(page);

        await openNewRecipe(page);
        await page.getByLabel('Title').fill('E2E Add Ingredient Loop');
        await page.getByRole('button', { name: 'More servings' }).click();
        await fillTimes(page, { prepMinutes: 5 });

        const field = page.getByRole('combobox', { name: 'Add an ingredient' });

        // (1) The empty state invites the first action, and the field is there to take it. No row, no refusal.
        await expect(page.getByText('No ingredients yet. Add your first ingredient.')).toBeVisible();
        await expect(field).toBeVisible();
        await expect(page.getByRole('button', { name: /^Edit / })).toHaveCount(0);
        await expect(page.getByText('Every ingredient needs an item picked from the list.')).toHaveCount(0);

        // (2) ⛔ Typed text is not a line. Publish refuses it and lands in the field with the list open, so the cook
        // keeps the words (R7).
        await field.fill('sal');
        // ⚠️ The open list covers the pinned action bar (reported as a defect), so the cook closes it first. Escape on an
        // open list only closes it: the text stays.
        await field.press('Escape');
        await expect(field).toHaveAttribute('aria-expanded', 'false');
        await expect(field).toHaveValue('sal');
        await page.getByRole('button', { name: 'Publish' }).click();
        await expect(field).toBeFocused();
        await expect(field).toHaveAccessibleDescription(
            /“sal” isn’t in the recipe yet\. Choose a food for it, or clear the box\./u,
        );
        await expect(field).toHaveAttribute('aria-expanded', 'true');
        await expect(page.getByRole('button', { name: /^Edit / })).toHaveCount(0);

        // (3) Picking a food is what actually appends a line, with the food bound to it.
        await page
            .getByRole('group', { name: 'Food catalog' })
            .getByRole('option', { name: 'Salt', exact: true })
            .click();
        await expect(ingredientOpen(page, 'Salt')).toBeVisible();
        // The field is empty and keeps focus, ready for the next ingredient.
        await expect(field).toHaveValue('');
        await expect(field).toBeFocused();
        // A resolved row wears no "no food" note — the note is reserved for a row that genuinely lacks one.
        await expect(
            page.getByText('No food chosen — this line won’t be saved. Remove it and add it from the search above.'),
        ).toHaveCount(0);

        // …and the recipe can now be finished.
        await addStep(page, 'Season to taste.');

        await page.getByRole('button', { name: 'Publish' }).click();

        await expect(page.getByRole('heading', { name: 'E2E Add Ingredient Loop' })).toBeVisible();
    });
});
