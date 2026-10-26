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
            id: 'ec000000-0000-4000-8000-00000000001b',
            ownerId: 'usr_other',
            title: 'Public Paella',
            visibility: 'public',
        });
        await mockRecipeApi(page, { viewerId, recipes: [publicRecipe] });

        await page.goto(route('/recipes/ec000000-0000-4000-8000-00000000001b'));
        await expect(page.getByRole('heading', { name: 'Public Paella' })).toBeVisible();

        await page.getByRole('button', { name: 'Save a copy' }).click();

        // A copy needs a real edit before it can be published (FR-005b), so it opens in the editor.
        await expect(page).toHaveURL(/\/recipes\/ec100000-0000-4000-8000-[^/]+\/edit/);
    });

    test('a premium owner switches their public recipe to private', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        const ownPublic = makeRecipeDetail({
            id: 'ec000000-0000-4000-8000-000000000017',
            ownerId: viewerId,
            title: 'My Public Dish',
            visibility: 'public',
        });
        await mockRecipeApi(page, { viewerId, paidFeatures: 'granted', recipes: [ownPublic] });

        await page.goto(route('/recipes/ec000000-0000-4000-8000-000000000017'));
        await expect(page.getByRole('heading', { name: 'My Public Dish' })).toBeVisible();

        // The visibility change is a secondary owner action, in the ⋯ menu (§6.4).
        await page.getByRole('button', { name: /^More actions for /u }).click();
        await page.getByRole('menuitem', { name: 'Make private' }).click();

        // After the refetch the rating line says Private, and the menu offers the way back.
        await expect(page.getByText('Private', { exact: true })).toBeVisible();
        await page.getByRole('button', { name: /^More actions for /u }).click();
        await expect(page.getByRole('menuitem', { name: 'Make public' })).toBeVisible();
    });

    // Owner 2026-10-13 (B2 E1), REWRITTEN for ADR-0073 (owner ruling 2026-10-26): a free-tier owner's tap on Make private
    // used to open the Premium sheet. A recipe the cook wrote now uses one of their private slots, so the tap makes it private.
    test('a free-tier owner taps Make private and the recipe uses a private slot', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        const ownPublic = makeRecipeDetail({
            id: 'ec000000-0000-4000-8000-000000000018',
            ownerId: viewerId,
            title: 'My Free Dish',
            visibility: 'public',
        });
        await mockRecipeApi(page, { viewerId, paidFeatures: 'upsell', recipes: [ownPublic] });

        await page.goto(route('/recipes/ec000000-0000-4000-8000-000000000018'));
        await expect(page.getByRole('heading', { name: 'My Free Dish' })).toBeVisible();

        await page.getByRole('button', { name: /^More actions for /u }).click();
        await page.getByRole('menuitem', { name: 'Make private' }).click();

        await expect(page.getByRole('dialog', { name: 'Keep more recipes private' })).toHaveCount(0);
        await expect(page.getByRole('dialog', { name: 'Private needs Premium for this recipe' })).toHaveCount(0);
        await expect(page.getByText('Private', { exact: true })).toBeVisible();

        await page.getByRole('button', { name: /^More actions for /u }).click();
        await expect(page.getByRole('menuitem', { name: 'Make public' })).toBeVisible();
    });

    test('⛔ with every slot used, a free-tier owner’s Make private is refused and the page says it stayed public', async ({
        page,
    }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        const held = makeRecipeDetail({
            id: 'ec000000-0000-4000-8000-000000000019',
            ownerId: viewerId,
            title: 'Held Dish',
            visibility: 'private',
        });
        const ownPublic = makeRecipeDetail({
            id: 'ec000000-0000-4000-8000-000000000018',
            ownerId: viewerId,
            title: 'My Free Dish',
            visibility: 'public',
        });
        await mockRecipeApi(page, {
            viewerId,
            paidFeatures: 'upsell',
            recipes: [held, ownPublic],
            privateSlotLimit: 1,
        });

        await page.goto(route('/recipes/ec000000-0000-4000-8000-000000000018'));
        await expect(page.getByRole('heading', { name: 'My Free Dish' })).toBeVisible();

        await page.getByRole('button', { name: /^More actions for /u }).click();
        await page.getByRole('menuitem', { name: 'Make private' }).click();

        await expect(page.getByText('Not available. All 50 of your private slots are in use.')).toBeVisible();
    });
});
