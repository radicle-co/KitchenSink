import { expect, test } from '@playwright/test';

import { signInWithTicket } from './utils/auth';
import { route } from './utils/basePath';
import { E2E_RECIPE_IDS, makeCollection, makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';

/**
 * One snackbar host above the pages (plan U7a). A snackbar raised on one page is still there, in the same
 * "Notifications" region, after a client-side move to another page, and its timer decides the outcome there: the
 * removal that was waiting on it is sent when it runs out, wherever the cook is by then. Selectors are role and label
 * only. Written with U7a and run in the feature's e2e wrap-up.
 */
test.describe('one snackbar across pages (U7a)', () => {
    test('a removal snackbar follows the cook to the collections list and sends the removal when it runs out', async ({
        page,
    }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, {
            viewerId,
            recipes: [makeRecipeDetail({ id: E2E_RECIPE_IDS.pasta, ownerId: viewerId, title: 'Weeknight Pasta' })],
            collections: [
                makeCollection({
                    id: 'col_dinners',
                    ownerId: viewerId,
                    name: 'Weeknight dinners',
                    recipeIds: [E2E_RECIPE_IDS.pasta],
                }),
            ],
        });
        await page.goto(route('/collections/col_dinners'));

        await page.getByRole('button', { name: 'More actions for Weeknight Pasta' }).click();
        await page.getByRole('menuitem', { name: 'Remove from collection' }).click();

        const notifications = page.getByRole('region', { name: 'Notifications' });
        const message = 'Removed Weeknight Pasta from Weeknight dinners.';

        await expect(notifications).toHaveCount(1);
        await expect(notifications.getByText(message)).toBeVisible();

        // Move to another page without a reload: the host is above both pages, so the snackbar stays.
        await page.getByRole('link', { name: 'Back to Collections' }).first().click();
        await expect(page).toHaveURL(/\/collections\/?$/u);
        await expect(notifications).toHaveCount(1);
        await expect(notifications.getByText(message)).toBeVisible();

        // Let it run out, away from it (the pointer pauses the timer): the removal is sent from the new page.
        const removal = page.waitForResponse(
            (response) =>
                response.request().method() === 'DELETE' &&
                /\/api\/v1\/collections\/col_dinners\/recipes\/[^/]+$/u.test(response.url()),
            { timeout: 20_000 },
        );

        await page.mouse.move(0, 0);
        await expect(notifications.getByText(message)).toHaveCount(0, { timeout: 15_000 });
        expect((await removal).status()).toBe(204);
    });
});
