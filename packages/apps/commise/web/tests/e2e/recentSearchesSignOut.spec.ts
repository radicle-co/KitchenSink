import { expect, test } from '@playwright/test';

import { route } from './utils/basePath';
import { E2E_RECIPE_IDS, makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';

/**
 * Owner ruling 2026-10-17 (`docs/design/uiOverhaul/ownerDecisions.md`): the history stays on the device, per signed-in user,
 * and ends with the session. The real sign-out control is the trigger, because the clear belongs to the one sign-out command
 * (ADR-0009), not to anything this page does. The second-user half (user B never sees user A's) is held by the component
 * tests on both platforms: it needs two real Clerk users, which this suite's one fixture user does not give.
 */
test.describe('discovery recent searches — ended by sign-out (D23)', () => {
    test('⛔ signing out forgets the history: a fresh sign-in offers no recent searches', async ({ page }) => {
        test.slow();
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, {
            viewerId,
            recipes: [makeRecipeDetail({ id: E2E_RECIPE_IDS.paella, ownerId: 'usr_other', title: 'Seafood Paella' })],
        });

        await page.goto(route('/discover'));
        await expect(page.getByRole('heading', { name: 'Trending' })).toBeVisible();
        const searchBox = page.getByRole('searchbox', { name: 'Search recipes' });
        await searchBox.click();
        await searchBox.fill('paella');
        await expect(page.getByText('1 recipe for “paella”', { exact: true })).toHaveCount(1);
        await searchBox.fill('');
        await expect(page.getByRole('button', { name: 'Search for “paella”' })).toBeVisible();

        // Leave through the real control, then come back as the same person.
        await page.goto(route('/profile'));
        await page.getByRole('button', { name: 'Sign out' }).click();
        await expect(page.getByRole('textbox', { name: /email/i })).toBeVisible({ timeout: 20_000 });

        // `force`: a signed-out context still holds Clerk's dev-browser and `__client_uat` cookies, which the helper's
        // restored-session branch reads as a live session and then waits on a Home that never comes.
        await signInWithTicket(page, { force: true });
        await page.goto(route('/discover'));
        await expect(page.getByRole('heading', { name: 'Trending' })).toBeVisible();
        await page.getByRole('searchbox', { name: 'Search recipes' }).click();
        await expect(page.getByRole('region', { name: 'Recent searches' })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Search for “paella”' })).toHaveCount(0);
    });
});
