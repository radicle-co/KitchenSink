import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

import { route } from './utils/basePath';
import { mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';

/**
 * The app shell's desktop-vs-narrow navigation CUTOVER, measured in a real browser (U39).
 *
 * ## The defect this spec is named after
 *
 * The shipped chrome disagreed with itself about its own breakpoint: the hamburger and the drawer hid at `md`
 * (768px) while the desktop rail only appeared at `lg` (1024px). Between 768 and 1023px there was therefore
 * NEITHER — a tablet had no route to the full navigation at all, and survived only on the bottom tab bar's
 * six compact icons. `AppShell`'s module doc already described the cutover as "the shared `lg` token", so the
 * `md` spellings were the unfinished half of that migration, not a second deliberate breakpoint.
 *
 * ## Why the component suite cannot settle this
 *
 * `HomeChrome.test.tsx` covers the same invariant, but jsdom runs no Tailwind and computes no layout, so it
 * resolves a width against CLASS STRINGS using an assumed breakpoint scale. It therefore cannot notice a
 * theme that redefines what `lg` means — the exact class of failure that once let a 32px avatar paint at 64px
 * behind a green jsdom simulator (see `homeTopBarGeometry.spec.ts`). Everything here is real visibility in a
 * real engine with the real stylesheet, at the three widths that bound the cutover.
 *
 * ## The invariant is a mutual exclusion, not two independent checks
 *
 * "Exactly one of {hamburger, rail} is reachable" fails in BOTH directions — for the 768–1023px gap this unit
 * closes, and for a future over-correction that shows a hamburger beside a rail — where two independent
 * per-element assertions would leave the second unguarded. The same shape is applied to the primary-nav
 * landmark itself: exactly one 'Main' navigation is visible at every width.
 *
 * Selectors are role/label only (repo policy); no `data-testid`, no `waitForTimeout`.
 */

/** The widest viewport that is still BELOW Tailwind's `md` (768px) — a phone. */
const PHONE_WIDTH_PX = 767;

/** Inside the former gap: at or above `md`, below `lg`. A tablet, and the width U39 exists for. */
const TABLET_WIDTH_PX = 900;

/** Exactly Tailwind's `lg` — the first width at which the desktop rail is meant to appear. */
const DESKTOP_WIDTH_PX = 1024;

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

/** The hamburger, and the rail's own collapse control — the affordance each rendering is identified by. */
function navAffordances(page: Page): { hamburger: Locator; rail: Locator } {
    return {
        hamburger: page.getByRole('button', { name: 'Open navigation' }),
        // Only the desktop rail has a collapse control; the tab bar and the drawer have none.
        rail: page.getByRole('button', { name: /^(Collapse|Expand) navigation$/u }),
    };
}

/**
 * Assert exactly one primary-nav landmark is visible, and say whether it is the bottom-pinned tab bar.
 *
 * The tab bar and the rail are the SAME accessible landmark ('Main' navigation) rendered two ways, so they
 * cannot be told apart by role or name. They are told apart by where they sit: the tab bar is `fixed` to the
 * foot of the viewport, the rail is a full-height column at the left. Measuring that is what a real engine is
 * for, and it doubles as the "the tab bar is still pinned to the bottom" assertion.
 *
 * @param page - The page under test.
 * @param expectBottomPinned - Whether the one visible landmark should be the bottom tab bar.
 */
async function expectSinglePrimaryNav(page: Page, expectBottomPinned: boolean): Promise<void> {
    const visibleNavs = page.getByRole('navigation', { name: 'Main' }).filter({ visible: true });

    await expect(visibleNavs, 'exactly one primary-nav landmark is visible').toHaveCount(1);

    const box = await visibleNavs.boundingBox();

    if (box === null) {
        throw new Error('the visible primary-nav landmark has no layout box');
    }

    const viewport = page.viewportSize();

    if (viewport === null) {
        throw new Error('this spec requires a fixed viewport');
    }

    const isBottomPinned = Math.abs(box.y + box.height - viewport.height) <= SLACK_PX;

    expect(isBottomPinned, expectBottomPinned ? 'the tab bar is pinned to the foot' : 'the rail is not').toBe(
        expectBottomPinned,
    );
}

test.describe('Home nav cutover — 767px, a phone', () => {
    test.use({ viewport: { width: PHONE_WIDTH_PX, height: 812 } });

    test('offers the hamburger, not the rail, and keeps the bottom tab bar', async ({ page }) => {
        await landOnHome(page);
        const { hamburger, rail } = navAffordances(page);

        await expect(hamburger).toBeVisible();
        await expect(rail).toBeHidden();
        await expectSinglePrimaryNav(page, true);
    });
});

test.describe('Home nav cutover — 900px, the tablet band U39 closes', () => {
    test.use({ viewport: { width: TABLET_WIDTH_PX, height: 800 } });

    test('still offers the hamburger, because the rail has not arrived yet', async ({ page }) => {
        await landOnHome(page);
        const { hamburger, rail } = navAffordances(page);

        // The regression: before U39 BOTH of these were hidden, leaving no way to reach the full navigation.
        await expect(hamburger).toBeVisible();
        await expect(rail).toBeHidden();
    });

    test('opens a usable, focus-trapped drawer from that hamburger', async ({ page }) => {
        await landOnHome(page);

        await navAffordances(page).hamburger.click();
        const drawer = page.getByRole('dialog', { name: 'Main' });

        await expect(drawer).toBeVisible();
        // Focus lands inside on open, and Radix's trap keeps it there — a drawer whose panel or overlay still
        // hid at the earlier breakpoint would open onto nothing at this width. (The retired class is
        // DESCRIBED, never spelled: Tailwind v4's auto-scan covers this `tests/` tree as TEXT, so writing it
        // verbatim emits the dead utility into the production bundle.)
        await expect(drawer.locator(':focus')).toHaveCount(1);

        for (let step = 0; step < 8; step += 1) {
            await page.keyboard.press('Tab');
            await expect(drawer.locator(':focus'), `focus stays trapped after ${step + 1} tabs`).toHaveCount(1);
        }

        // The destinations really are reachable from here — the point of having a drawer at all.
        await expect(drawer.getByRole('link', { name: 'Recipes' })).toBeVisible();

        await page.keyboard.press('Escape');
        await expect(drawer).toBeHidden();
    });

    test('keeps the bottom tab bar exactly as it was', async ({ page }) => {
        await landOnHome(page);

        await expectSinglePrimaryNav(page, true);
    });
});

test.describe('Home nav cutover — 1024px, the first desktop width', () => {
    test.use({ viewport: { width: DESKTOP_WIDTH_PX, height: 800 } });

    test('swaps to the rail and retires the hamburger', async ({ page }) => {
        await landOnHome(page);
        const { hamburger, rail } = navAffordances(page);

        await expect(rail).toBeVisible();
        await expect(hamburger).toBeHidden();
        // The one visible 'Main' landmark is now the rail, so the tab bar is gone — its own `lg:hidden`
        // cutover, unchanged by U39, and now finally the SAME width the hamburger hides at.
        await expectSinglePrimaryNav(page, false);
    });
});
