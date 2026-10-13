import { expect, test } from '@playwright/test';

import { signInWithTicket } from './utils/auth';
import { route } from './utils/basePath';
import { mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { openNewRecipe } from './utils/recipeEditor';

/**
 * The editor's session and chrome, as only a browser shows them (UI walk batch B2): leaving during the first create (E3),
 * the document's scroll padding for focus under the sticky chrome (E4), a refused Publish landing on its field (E7), the
 * bar's foot (E21), the guided progress for an account that has never published (A-005), and the Ready line (A-010b).
 *
 * The recipe-service contract is intercepted (`utils/recipeApi`); selectors are role and label only (repo policy).
 */

test.describe('the editor session', () => {
    test.beforeEach(async ({ page }) => {
        await signInWithTicket(page);
    });

    /**
     * E3: × ran the exit checkpoint and then pushed to My recipes; the create's answer arrived before the push committed
     * and rewrote the URL with `replaceState`, which Next turns into a restore that discards the push. The editor stayed.
     *
     * ⛔ The NAVIGATION is held, not the create: the create answers at once, and My recipes is slow to arrive. Delaying
     * the create instead gives the push time to commit first, and the URL guard then lets it through without the fix.
     */
    test('⛔ × leaves for My recipes when the create answers before the navigation commits', async ({ page }) => {
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId, tier: 'premium' });
        let holdNavigation = false;
        await page.route(
            (url) => url.pathname.endsWith('/recipes') && !url.pathname.includes('/api/'),
            async (request) => {
                if (holdNavigation) {
                    await new Promise((resolve) => setTimeout(resolve, 1_500));
                }

                await request.fallback();
            },
        );

        await openNewRecipe(page);
        await page.getByLabel('Title').fill('Leaving Soup');
        holdNavigation = true;
        await page.getByRole('button', { name: 'Close editor' }).click();

        await expect(page).toHaveURL(/\/recipes$/u, { timeout: 15_000 });
    });

    /** E4 (WCAG 2.2 SC 2.4.11): the document pads its scroll for the sticky header and the action bar. */
    test('pads the document’s scroll for the sticky chrome, and a keyboard-focused control stays above the bar', async ({
        page,
    }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId, tier: 'premium' });

        await openNewRecipe(page);

        const padding = await page.evaluate(() => {
            const style = getComputedStyle(document.documentElement);

            return { top: style.scrollPaddingTop, bottom: style.scrollPaddingBottom };
        });
        expect(Number.parseFloat(padding.top)).toBeGreaterThan(0);
        expect(Number.parseFloat(padding.bottom)).toBeGreaterThan(16);

        await page.getByRole('button', { name: 'Add a group' }).focus();
        const focused = await page.getByRole('button', { name: 'Add a group' }).boundingBox();
        const bar = await page.getByRole('group', { name: 'Recipe actions' }).boundingBox();

        expect(focused).not.toBeNull();
        expect(focused!.y + focused!.height).toBeLessThanOrEqual((bar?.y ?? 844) + 1);
    });

    /** E1 (build spec §6.4, §7.7 item 2): Private did nothing for a free-tier cook. It opens the Premium sheet. */
    test('Private for a free-tier cook opens the Premium sheet, and Not now leaves the recipe public', async ({
        page,
    }) => {
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId, tier: 'free' });

        await openNewRecipe(page);
        await page.getByRole('radio', { name: /^Private/u }).click();

        const sheet = page.getByRole('dialog', { name: 'Private recipes are part of Premium.' });
        await expect(sheet).toBeVisible();
        // Equal choices, nothing pre-selected (DSA Art. 25).
        await expect(sheet.getByRole('button', { name: 'See Premium' })).toBeVisible();

        await sheet.getByRole('button', { name: 'Not now' }).click();

        await expect(sheet).toBeHidden();
        await expect(page.getByRole('radio', { name: /^Public/u })).toBeChecked();
    });

    /** E7 (build spec §7.8): focus goes to the first invalid field, not the section heading. */
    test('a refused Publish puts focus in the title field', async ({ page }) => {
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId, tier: 'premium' });

        await openNewRecipe(page);
        await page.getByRole('button', { name: 'Publish' }).click();

        await expect(page.getByLabel('Title')).toBeFocused();
    });

    /** E21: the bar is `sticky` in the form column; `<main>` reserved another 96 px under it. */
    test('the action bar rests on the bottom edge at the end of the page', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId, tier: 'premium' });

        await openNewRecipe(page);
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));

        const bar = await page.getByRole('group', { name: 'Recipe actions' }).boundingBox();

        expect(bar).not.toBeNull();
        expect(Math.abs(bar!.y + bar!.height - 844)).toBeLessThanOrEqual(2);
    });

    /** A-005 + E17: an account that has never published is guided even when the library read was never cached. */
    test('an empty account opening the editor by URL is guided: "0 of 4 done"', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 900 });
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId, tier: 'premium', recipes: [] });

        await page.goto(route('/recipes/new'));

        await expect(page.getByText('0 of 4 done').first()).toBeVisible();
    });

    /** A-010b (build spec §7.7 item 3): the Ready line is always in Photos & publish. */
    test('Photos & publish always carries the Ready line: what to fix, then "Ready to publish."', async ({ page }) => {
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId, tier: 'premium' });

        await openNewRecipe(page);

        await expect(page.getByRole('button', { name: /^Fix \d+ things? to publish$/u })).toBeVisible();
    });
});
