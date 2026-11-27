import { expect, test, type Page } from '@playwright/test';

import { signInWithTicket } from './utils/auth';
import { route } from './utils/basePath';
import { E2E_RECIPE_IDS, makeCollection, makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';

/**
 * The snackbar centres over the main column beside the sidebar (from 840 px), open and collapsed. The page measures the
 * "Notifications" region against the `<main>` box, so a fixed sidebar offset in the code would fail one of the two
 * widths. Selectors are role and label only.
 */
const MESSAGE = 'Removed Weeknight Pasta from Weeknight dinners.';

async function raiseSnackbar(page: Page): Promise<void> {
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
}

async function expectBarOverMainColumn(page: Page): Promise<void> {
    const notifications = page.getByRole('region', { name: 'Notifications' });
    await expect(notifications.getByText(MESSAGE)).toBeVisible();

    const region = await notifications.boundingBox();
    const main = await page.getByRole('main').boundingBox();
    const text = await notifications.getByText(MESSAGE).boundingBox();
    const sidebar = await page.getByRole('navigation', { name: 'Primary' }).boundingBox();

    expect(region).not.toBeNull();
    expect(main).not.toBeNull();
    expect(text).not.toBeNull();
    expect(sidebar).not.toBeNull();
    expect(Math.abs((region?.x ?? 0) - (main?.x ?? 0))).toBeLessThanOrEqual(1);
    expect(
        Math.abs((region?.x ?? 0) + (region?.width ?? 0) - ((main?.x ?? 0) + (main?.width ?? 0))),
    ).toBeLessThanOrEqual(1);
    expect(text?.x ?? 0).toBeGreaterThanOrEqual((sidebar?.x ?? 0) + (sidebar?.width ?? 0));
}

test.describe('snackbar over the main column (CL-508)', () => {
    test.use({ viewport: { width: 1024, height: 768 } });

    test('at 1024 px the bar sits over the main column, sidebar open and then collapsed', async ({ page }) => {
        await raiseSnackbar(page);
        await expectBarOverMainColumn(page);

        // Pause the timer with the pointer on the bar, then collapse: the column widens and the bar follows it.
        await page.getByRole('button', { name: 'Collapse' }).click();
        await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible();
        await expectBarOverMainColumn(page);
    });
});
