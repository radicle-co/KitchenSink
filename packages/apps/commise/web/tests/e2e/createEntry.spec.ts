import { expect, test } from '@playwright/test';

import { route } from './utils/basePath';
import { makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';

/**
 * The one-tap create entry (build spec §3.4; owner decision D4; UI overhaul slice 8), through the real browser, in both
 * themes (D15). REPLACES `recipeCreateDial.spec.ts`: the dial and its menu are gone, because paste lives in the editor's
 * Ingredients section, so "New recipe" opens the empty editor in ONE press, from the floating button below 840 px and
 * from the sidebar at 840 and wider. Home's first run keeps its own Paste ingredients, which opens the new editor at
 * Ingredients with the Paste a list sheet up.
 *
 * Selectors are role and label only (repo policy); no `data-testid`, no `waitForTimeout`.
 */
const SCHEMES = ['light', 'dark'] as const;

for (const colorScheme of SCHEMES) {
    test.describe(`the create entry (${colorScheme})`, () => {
        test.use({ colorScheme });

        test.beforeEach(async ({ page }) => {
            await signInWithTicket(page);
        });

        test('the floating "New recipe" opens the empty editor in one press, with no menu', async ({ page }) => {
            await page.setViewportSize({ width: 390, height: 844 });
            const viewerId = await readViewerAppId(page);
            await mockRecipeApi(page, {
                viewerId,
                tier: 'premium',
                recipes: [
                    makeRecipeDetail({
                        id: 'ec000000-0000-4000-8000-000000000017',
                        ownerId: viewerId,
                        title: 'Weeknight Pasta',
                    }),
                ],
            });

            await page.goto(route('/recipes'));
            const button = page.getByRole('button', { name: 'New recipe' });
            await expect(button).toBeVisible();
            // A plain button: it discloses nothing.
            await expect(button).not.toHaveAttribute('aria-haspopup');
            await expect(button).not.toHaveAttribute('aria-expanded');

            await button.click();

            await expect(page).toHaveURL(/\/recipes\/new/);
            await expect(page.getByRole('heading', { level: 1, name: 'New recipe' })).toBeVisible();
            await expect(page.getByRole('menu')).toHaveCount(0);
        });

        test('Enter on the focused button opens the editor', async ({ page }) => {
            await page.setViewportSize({ width: 390, height: 844 });
            const viewerId = await readViewerAppId(page);
            await mockRecipeApi(page, {
                viewerId,
                tier: 'premium',
                recipes: [
                    makeRecipeDetail({
                        id: 'ec000000-0000-4000-8000-000000000017',
                        ownerId: viewerId,
                        title: 'Weeknight Pasta',
                    }),
                ],
            });

            await page.goto(route('/recipes'));
            await page.getByRole('button', { name: 'New recipe' }).focus();
            await page.keyboard.press('Enter');

            await expect(page.getByRole('heading', { level: 1, name: 'New recipe' })).toBeVisible();
        });

        test('at 1280 the sidebar’s "New recipe" opens the editor in one press', async ({ page }) => {
            await page.setViewportSize({ width: 1280, height: 900 });
            const viewerId = await readViewerAppId(page);
            await mockRecipeApi(page, {
                viewerId,
                tier: 'premium',
                recipes: [
                    makeRecipeDetail({
                        id: 'ec000000-0000-4000-8000-000000000017',
                        ownerId: viewerId,
                        title: 'Weeknight Pasta',
                    }),
                ],
            });

            await page.goto(route('/recipes'));
            // From 840 the floating button is gone, so the one "New recipe" is the sidebar's.
            await page.getByRole('button', { name: 'New recipe' }).click();

            await expect(page).toHaveURL(/\/recipes\/new/);
            await expect(page.getByRole('heading', { level: 1, name: 'New recipe' })).toBeVisible();
        });

        test('Home’s first run: Paste ingredients opens the editor at Ingredients with the paste sheet up', async ({
            page,
        }) => {
            await page.setViewportSize({ width: 390, height: 844 });
            const viewerId = await readViewerAppId(page);
            await mockRecipeApi(page, { viewerId, tier: 'premium', recipes: [] });

            await page.goto(route('/'));
            // §3.4: the first run's own buttons take the floating button's place.
            await expect(page.getByRole('button', { name: 'Add your first recipe' })).toBeVisible();
            await expect(page.getByRole('button', { name: 'New recipe' })).toHaveCount(0);

            await page.getByRole('button', { name: 'Paste ingredients' }).click();

            await expect(page).toHaveURL(/\/recipes\/new\?paste=1#ingredients$/);
            const sheet = page.getByRole('dialog', { name: 'Paste a list' });
            await expect(sheet).toBeVisible();
            await expect(sheet.getByRole('textbox', { name: 'Ingredient lines' })).toBeVisible();

            await page.keyboard.press('Escape');
            await expect(sheet).toHaveCount(0);
            await expect(page.getByRole('heading', { level: 2, name: 'Ingredients' })).toBeInViewport();
        });
    });
}
