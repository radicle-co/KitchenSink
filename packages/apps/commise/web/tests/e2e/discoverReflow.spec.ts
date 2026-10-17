import { expect, test } from '@playwright/test';

import { route } from './utils/basePath';
import { makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';

/**
 * Discover must not scroll sideways while its browse rails load (E1, WCAG 1.4.10 Reflow).
 *
 * The defect lived only in the PENDING state: the skeleton strip had no overflow rule, so its three 256 px tiles
 * widened the page to 832 px at 320 while the loaded strip scrolled inside itself. A first visit always loads, so
 * every phone user met it. The "Community" source tab is a link to this same route, so this covers it too.
 *
 * The browse request is held open for the whole test, so the rails stay pending. The spec first proves the pending
 * state is ON SCREEN — without that, a page that skipped the skeleton (SSR data, a route `loading.tsx`) would pass
 * the width check having measured nothing. jsdom cannot measure width; this is the only tier that can.
 *
 * Selectors are role/label only (repo policy); no `data-testid`, no `waitForTimeout`.
 */

const WIDTHS = [320, 390, 768] as const;

test.afterEach(async ({ page }) => {
    // The held request never settles by design; release it quietly so teardown does not report it.
    await page.unrouteAll({ behavior: 'ignoreErrors' });
});

for (const width of WIDTHS) {
    test(`Discover does not scroll sideways at ${String(width)} px while its rails load`, async ({ page }) => {
        await page.setViewportSize({ width, height: 800 });
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId });
        // Registered after the mock, so it wins: every browse request stays pending.
        await page.route('**/api/v1/search/recipes**', () => undefined);

        await page.goto(route('/discover'));

        const loading = page.getByRole('status', { name: 'Loading recipes' }).first();
        await expect(loading).toBeVisible();
        // The placeholders have nothing to scroll to, so they promise nothing: no chevron, and no scroller.
        await expect(loading.locator('svg')).toHaveCount(0);
        await expect(loading.locator('[class*="overflow-x-auto"]')).toHaveCount(0);
        const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
        expect(scrollWidth).toBe(width);
    });
}

test.describe('Discover rail cards — W-03: a long attribution cannot widen a card', () => {
    test('every rail card stays within 256 px, with a 60-character unbroken attribution', async ({ page }) => {
        await page.setViewportSize({ width: 840, height: 900 });
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, {
            viewerId,
            recipes: [
                makeRecipeDetail({
                    id: 'ec000000-0000-4000-8000-000000000071',
                    ownerId: 'usr_other',
                    title: 'Imported Stew',
                    visibility: 'public',
                    sourceAttribution: 'A'.repeat(60),
                }),
            ],
        });

        await page.goto(route('/discover'));
        const card = page.getByRole('article', { name: 'Imported Stew' }).first();
        await expect(card).toBeVisible();

        const widths = await page
            .getByRole('article')
            .evaluateAll((cards) => cards.map((element) => Math.round(element.getBoundingClientRect().width)));

        for (const width of widths) {
            expect(width).toBeLessThanOrEqual(256);
        }

        // The Save a copy button must stay INSIDE its card: an `auto` grid column once let the long word push it out.
        const cardBox = await card.boundingBox();
        const saveBox = await card.getByRole('button', { name: 'Save a copy of Imported Stew' }).boundingBox();

        expect(cardBox).not.toBeNull();
        expect(saveBox).not.toBeNull();
        expect(saveBox!.x).toBeGreaterThanOrEqual(cardBox!.x);
        expect(saveBox!.x + saveBox!.width).toBeLessThanOrEqual(cardBox!.x + cardBox!.width);
    });

    test('no card says "Cloned from" a raw id', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, {
            viewerId,
            recipes: [
                makeRecipeDetail({
                    id: 'ec000000-0000-4000-8000-000000000072',
                    ownerId: 'usr_other',
                    title: 'Copied Stew',
                    visibility: 'public',
                }),
            ],
        });

        await page.goto(route('/discover'));
        await expect(page.getByRole('article', { name: 'Copied Stew' }).first()).toBeVisible();

        await expect(page.getByText(/Cloned from/u)).toHaveCount(0);
    });
});
