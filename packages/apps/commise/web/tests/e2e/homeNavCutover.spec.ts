import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { route } from './utils/basePath';
import { mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';

/**
 * The shell's ONE cutover, at `nav` = 840 px (ownerDecisions D5; `buildSpec.md` §1.2, §3.2), in a real browser.
 *
 * U39 was a band where the rail had not arrived and the hamburger had already left, so nothing reached the full
 * navigation. Slice 3 deleted the hamburger and its drawer, so the invariant is now simpler and stricter: at every width
 * EXACTLY ONE primary navigation is displayed — the bottom tab bar below 840, the sidebar from 840 — and both switch on
 * the same token, so no width shows neither or both. Rewritten for slice 3 from the `lg` (1024) cutover it pinned.
 */

/** Sub-pixel slack for fractional layout when comparing an element edge to the viewport edge. */
const SLACK_PX = 1;

/** Sign in and land on a Home whose widgets read from an intercepted (empty) recipe API. */
async function landOnHome(page: Page): Promise<void> {
    await signInWithTicket(page);
    const viewerId = await readViewerAppId(page);
    await mockRecipeApi(page, { viewerId, tier: 'free', recipes: [] });
    await page.goto(route('/'));
    await expect(page.getByRole('region', { name: 'Home' })).toBeVisible();
}

/** Whether the one displayed primary navigation is pinned to the viewport's foot. */
async function displayedNavIsBottomPinned(page: Page): Promise<boolean> {
    const visibleNavs = page.getByRole('navigation', { name: 'Main' }).filter({ visible: true });

    await expect(visibleNavs, 'exactly one primary-nav landmark is displayed').toHaveCount(1);

    const box = await visibleNavs.boundingBox();
    const viewport = page.viewportSize();

    if (box === null || viewport === null) {
        throw new Error('the displayed primary nav has no layout box');
    }

    return Math.abs(box.y + box.height - viewport.height) <= SLACK_PX;
}

for (const [width, tabBar] of [
    [600, true],
    [839, true],
    [840, false],
    [1024, false],
] as const) {
    test(`at ${width} px shows ${tabBar ? 'the tab bar' : 'the sidebar'}, and only it`, async ({ page }) => {
        await page.setViewportSize({ width, height: 812 });
        await landOnHome(page);

        expect(await displayedNavIsBottomPinned(page)).toBe(tabBar);
        await expect(page.getByRole('button', { name: /Open navigation/iu })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Collapse' })).toHaveCount(tabBar ? 0 : 1);
        await expect(page.getByRole('button', { name: 'Collapse' }).filter({ visible: true })).toHaveCount(
            tabBar ? 0 : 1,
        );
    });
}
