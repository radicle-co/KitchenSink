import { expect, test } from '@playwright/test';

import { route } from './utils/basePath';
import { makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';

/**
 * The Cuisine field (`docs/design/uiOverhaul/cuisineField.md`; owner rulings 2026-10-13): free text with the 90
 * suggestions under it, and a cuisine REQUIRED TO PUBLISH.
 *
 * What only a browser shows: the list a real keyboard and pointer reach — the whole list on focus, a filter from the
 * first keystroke, the cook's own words offered as "Use “…”" and saved in the canonical spelling — and that a Publish
 * without a cuisine is refused in the editor, lands on the field and sends nothing. The recipe-service contract is
 * intercepted (`utils/recipeApi`); selectors are role and label only (repo policy).
 *
 * Not run by the author's session: the coordinator runs Playwright.
 */

const DRAFT_ID = 'ec000000-0000-4000-8000-0000000000c1';

test.describe('the Cuisine field', () => {
    test.beforeEach(async ({ page }) => {
        await signInWithTicket(page);
    });

    test('lists all 90 on focus, narrows to what the cook types, and offers the cook’s own words', async ({ page }) => {
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId, paidFeatures: 'granted' });
        await page.goto(route('/recipes/new'));

        const cuisine = page.getByRole('combobox', { name: 'Cuisine' });
        const list = page.getByRole('listbox', { name: 'Cuisine suggestions' });

        await cuisine.focus();
        await expect(list.getByRole('option')).toHaveCount(90);

        await cuisine.fill('ind');
        await expect(list.getByRole('option')).toHaveText(['Indian', 'Indonesian', 'Use “Ind”']);

        await cuisine.fill('nyonya');
        await expect(
            page.getByRole('paragraph').filter({ hasText: 'No cuisines match “Nyonya”. You can use it as your own.' }),
        ).toBeVisible();
        await page.getByRole('option', { name: 'Use “Nyonya” as the cuisine' }).click();

        await expect(cuisine).toHaveValue('Nyonya');
        await expect(list).toBeHidden();
    });

    test('publishes a recipe once the cook chooses a cuisine, and saves it in the list’s spelling', async ({
        page,
    }) => {
        const viewerId = await readViewerAppId(page);
        const seed = makeRecipeDetail({ id: DRAFT_ID, ownerId: viewerId, title: 'Green Curry', status: 'draft' });
        const store = await mockRecipeApi(page, { viewerId, paidFeatures: 'granted', recipes: [seed] });

        await page.goto(route(`/recipes/${DRAFT_ID}/edit`));
        const cuisine = page.getByRole('combobox', { name: 'Cuisine' });
        await cuisine.fill('thai');
        await page.getByRole('option', { name: 'Thai' }).click();
        await page.getByRole('button', { name: 'Publish', exact: true }).click();

        await expect.poll(() => store.get(DRAFT_ID)?.status).toBe('published');
        expect(store.get(DRAFT_ID)?.cuisine).toBe('Thai');
    });

    test('refuses Publish without a cuisine: one thing to fix, focus on the field, nothing sent', async ({ page }) => {
        const viewerId = await readViewerAppId(page);
        const seed = makeRecipeDetail({ id: DRAFT_ID, ownerId: viewerId, title: 'Green Curry', status: 'draft' });
        const store = await mockRecipeApi(page, { viewerId, paidFeatures: 'granted', recipes: [seed] });

        await page.goto(route(`/recipes/${DRAFT_ID}/edit`));
        await page.getByRole('button', { name: 'Publish', exact: true }).click();

        await expect(page.getByRole('status').filter({ hasText: 'Fix 1 thing to publish' })).toBeVisible();
        const cuisine = page.getByRole('combobox', { name: 'Cuisine' });
        await expect(cuisine).toBeFocused();
        await expect(cuisine).toHaveAttribute('aria-invalid', 'true');
        // The error is the field's own description, not a separate alert (cuisineField.md P4: the slot is never live;
        // the refusal is spoken by the action bar's status line and by focusing the field).
        await expect(cuisine).toHaveAccessibleDescription(/Choose a cuisine, or type your own\./u);
        expect(store.get(DRAFT_ID)?.status).toBe('draft');
    });
});
