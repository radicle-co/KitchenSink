import { expect, test } from '@playwright/test';

import { signInWithTicket } from './utils/auth';
import { route } from './utils/basePath';
import { mockRecipeApi, readViewerAppId } from './utils/recipeApi';

/**
 * The offline notice and the shell (UI walk P5; build spec §3.8): the notice sits at the top of `<main>`, so going
 * offline pushes the page down and leaves the sidebar where it is. It used to render above the whole shell.
 */

test.describe('the offline notice', () => {
    test('⛔ does not move the sidebar when the device goes offline', async ({ page, context }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId, paidFeatures: 'granted' });

        await page.goto(route('/recipes'));
        const sidebar = page.getByRole('navigation', { name: 'Main' }).first();
        await expect(sidebar).toBeVisible();
        const before = await sidebar.boundingBox();

        await context.setOffline(true);

        await expect(page.getByRole('status', { name: 'Sync status' }).getByText('You’re offline')).toBeVisible();
        const after = await sidebar.boundingBox();

        expect(before).not.toBeNull();
        expect(after?.y).toBe(before?.y);
        // The notice is inside <main>.
        await expect(page.getByRole('main').getByText('You’re offline')).toBeVisible();
    });
});
