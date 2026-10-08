import { expect, test } from '@playwright/test';

import { route } from './utils/basePath';
import { mockRecipeApi, readViewerAppId } from './utils/recipeApi';
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

        await expect(page.getByRole('status', { name: 'Loading recipes' }).first()).toBeVisible();
        const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
        expect(scrollWidth).toBe(width);
    });
}
