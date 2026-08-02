import { expect, test } from '@playwright/test';

import { makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { route } from './utils/basePath';
import { signInWithTicket } from './utils/auth';

/**
 * Clone + visibility happy path (T080), driven through the real web UI with the recipe-service contract
 * intercepted (`utils/recipeApi`). Clone: opening a public recipe you don't own and cloning it lands you on
 * the copy. Visibility: an owner on a premium plan can switch their public recipe to private (the gate reads
 * the viewer's `account.subscriptionTier` via `/api/v1/users/me`, which the mock serves). Role/label selectors
 * only. The real backend is covered by the recipe-service's own e2e + k6.
 */
test.describe('clone + visibility (T080)', () => {
    test('clone a public recipe into your library', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        const publicRecipe = makeRecipeDetail({
            id: 'rec_pub',
            ownerId: 'usr_other',
            title: 'Public Paella',
            visibility: 'public',
        });
        await mockRecipeApi(page, { viewerId, recipes: [publicRecipe] });

        await page.goto(route('/recipes/rec_pub'));
        await expect(page.getByRole('heading', { name: 'Public Paella' })).toBeVisible();

        await page.getByRole('button', { name: 'Clone' }).click();

        // A successful clone navigates to the newly-created copy's detail.
        await expect(page).toHaveURL(/\/recipes\/rec_clone_/);
        await expect(page.getByRole('heading', { name: 'Public Paella (copy)' })).toBeVisible();
    });

    test('a premium owner switches their public recipe to private', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        const ownPublic = makeRecipeDetail({
            id: 'rec_own',
            ownerId: viewerId,
            title: 'My Public Dish',
            visibility: 'public',
        });
        await mockRecipeApi(page, { viewerId, tier: 'premium', recipes: [ownPublic] });

        await page.goto(route('/recipes/rec_own'));
        await expect(page.getByRole('heading', { name: 'My Public Dish' })).toBeVisible();

        // The visibility toggle is a secondary owner action, behind the "More" overflow menu (C4).
        await page.getByRole('button', { name: 'More' }).click();
        const privateOption = page.getByRole('radio', { name: 'Private' });
        await expect(privateOption).toBeEnabled();

        // Controlled toggle: the click fires the mutation; the option reflects private after the refetch.
        await privateOption.click();
        await expect(privateOption).toBeChecked();
    });
});
