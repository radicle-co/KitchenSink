import { expect, test } from '@playwright/test';

import { route } from './utils/basePath';
import { mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';

/**
 * A cook with no collections can still make one at 200% zoom (WCAG 1.4.4, 1.4.10).
 *
 * qa-ios found the native twin broken at the largest text size: "New collection" was a button INSIDE the empty state, the
 * state's heading and body ran past a screen that did not scroll, and the button was nowhere to be reached. The designer's
 * ruling (2026-11-03) floats it, the same as "New recipe": always on screen, whatever the size. So at 200% zoom (a 1280 x 720
 * window reflowed to 640 x 360 CSS px) and at the 320 px reflow width, the floating button is inside the viewport, even
 * after the page is scrolled to its end, the page does not scroll sideways, and one press opens the new-collection sheet.
 *
 * Geometry is asserted in a real browser; jsdom has no layout. Selectors are role/label only (repo policy).
 */

const WINDOWS = [
    { name: '200% zoom of a 1280 x 720 window', width: 640, height: 360 },
    { name: 'the 320 px reflow width', width: 320, height: 480 },
] as const;

for (const { name, width, height } of WINDOWS) {
    test(`New collection stays on screen and opens its sheet in the empty state at ${name}`, async ({ page }) => {
        await page.setViewportSize({ width, height });
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId, collections: [] });

        await page.goto(route('/collections'));
        await expect(page.getByRole('heading', { level: 2, name: 'Group recipes your way' })).toBeVisible();

        const create = page.getByRole('button', { name: 'New collection' });
        await expect(create).toHaveCount(1);
        await expect(create).toBeInViewport({ ratio: 1 });

        // Scrolled to the end of the page, it is still there: it floats, it does not sit in the flow.
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await expect(create).toBeInViewport({ ratio: 1 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);

        await create.click();
        await expect(page.getByRole('dialog', { name: 'New collection' })).toBeVisible();
    });
}
