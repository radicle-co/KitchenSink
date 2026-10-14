import { expect, test } from '@playwright/test';

import { E2E_CATALOG_FOOD, E2E_SALT_FOOD, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';
import { mockFoodApi } from './utils/foodApi';
import { ingredientOpen, openNewRecipe } from './utils/recipeEditor';

/**
 * After a food is picked, the new row stays in view (`docs/design/uiOverhaul/ingredientArrival.md`), driven through the
 * real one-page editor with the recipe contract and food's search intercepted (`utils/recipeApi`, `utils/foodApi`).
 * Selectors are role/label only (per repo policy); no `waitForTimeout`.
 *
 * ⛔ THE DEFECT. A pick adds the new row straight above the add field, and nothing asked for it to be shown: at a short
 * viewport the field held its place and the row ended up above the top edge (or under the sticky header). The page now
 * scrolls the row and the field into view together, with the smallest scroll, honouring the document's `scroll-padding`.
 *
 * A short window makes two rows enough to push the first one out of view. After each pick, both the new row and the add
 * field must be inside the viewport, and the field must still hold focus: the scroll never takes it.
 *
 * ⚠️ The spec's first open check — browser scroll anchoring can already keep the field steady, and then the row hides under
 * the sticky header — is what the second pick's `toBeInViewport` is placed to catch. This file was WRITTEN, NOT RUN, in the
 * session that built the feature: no browser was launched.
 */
test.use({ viewport: { width: 390, height: 420 } });

test.describe('ingredient arrival (ingredientArrival.md)', () => {
    test('after each pick the new row and the add field are both in view, and the field keeps focus', async ({
        page,
    }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId, tier: 'premium' });
        await mockFoodApi(page);

        await openNewRecipe(page);
        await page.getByLabel('Title').fill('E2E Ingredient Arrival');

        const field = page.getByRole('combobox', { name: 'Add an ingredient' });
        const catalog = page.getByRole('group', { name: 'Food catalog' });

        // First pick.
        await field.fill('sal');
        await catalog.getByRole('option', { name: E2E_SALT_FOOD.name, exact: true }).click();
        await expect(ingredientOpen(page, E2E_SALT_FOOD.name)).toBeInViewport();
        await expect(field).toBeInViewport();
        await expect(field).toBeFocused();

        // Second pick: the list has grown, and the first row may now be scrolled away. The new row must be in view.
        await field.fill('pepper');
        await catalog.getByRole('option', { name: E2E_CATALOG_FOOD.name }).click();
        await expect(ingredientOpen(page, E2E_CATALOG_FOOD.name)).toBeInViewport();
        await expect(field).toBeInViewport();
        await expect(field).toBeFocused();
        await expect(field).toHaveValue('');
    });
});
