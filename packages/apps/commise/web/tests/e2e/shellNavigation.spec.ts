import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

import { route } from './utils/basePath';
import { makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';

/**
 * The web shell of the UI overhaul, slice 3 (`docs/design/uiOverhaul/buildSpec.md` §3.2-§3.6; ownerDecisions D5),
 * measured in a real browser with the real stylesheet, in BOTH themes (D15, D17):
 *
 * - below 840 px the bottom tab bar (Home, Recipes, Discover and You), from 840 the sidebar — exactly one primary
 *   navigation visible at a time;
 * - Profile is the You tab below 840 and the sidebar's first row from 840, where the wordmark was (owner ruling
 *   2026-11-11, N3); no title row carries an avatar;
 * - no top bar, no hamburger, no "Soon" item;
 * - the sidebar's collapse persists across a reload, drawn at the right width on the first paint;
 * - the floating "New recipe" comes right after the page's H1 in DOM order, and hides with the on-screen keyboard;
 * - a second tap on the active tab scrolls its root to the top;
 * - "Back to top" appears past four screens on the way up, and returns to the top and the H1.
 *
 * It replaces `homeTopBarGeometry.spec.ts`, whose top bar is deleted.
 */

/** Sign in and seed the recipe API; `count` recipes make a long My recipes list. */
async function signedIn(page: Page, count = 2): Promise<void> {
    await signInWithTicket(page);
    const viewerId = await readViewerAppId(page);
    const recipes = Array.from({ length: count }, (_unused, index) =>
        makeRecipeDetail({ id: `shell_${index}`, title: `Shell recipe ${index + 1}`, ownerId: viewerId }),
    );
    await mockRecipeApi(page, { viewerId, paidFeatures: 'granted', recipes });
}

/**
 * The one primary navigation that is displayed: the sidebar is named "Main" and the bottom tab bar "Tabs" (W-14), and
 * CSS shows exactly one of them at any width.
 */
const visibleNav = (page: Page) => page.getByRole('navigation', { name: /^(?:Main|Tabs)$/u }).filter({ visible: true });

/**
 * The tab bar's four links, by accessible name. The You tab's disc holds the cook's initials, so the links' text is not
 * the list to compare: the names are (the disc is decorative, the visible label "You" names the tab, SC 2.5.3).
 */
async function expectTabNames(nav: Locator): Promise<void> {
    await expect(nav.getByRole('link')).toHaveCount(4);

    for (const name of ['Home', 'Recipes', 'Discover', 'You']) {
        await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();
    }
}

/**
 * Owner 2026-10-13: a landscape phone (a window under 480 px tall, below the 840 px sidebar breakpoint) gets a compact
 * bottom bar — the label beside the glyph, 48 px tall — and the labels remain the links' names.
 */
test.describe('the bottom tab bar in landscape (a window under 480 px tall)', () => {
    test('is 48 px tall with each label beside its glyph, and keeps every tab named', async ({ page }) => {
        await page.setViewportSize({ width: 800, height: 390 });
        await signedIn(page);
        await page.goto(route('/'));

        const nav = visibleNav(page);
        await expect(nav).toHaveCount(1);
        await expectTabNames(nav);

        const box = await nav.boundingBox();
        expect(box?.height).toBeCloseTo(48, 0);

        const home = nav.getByRole('link', { name: 'Home' });
        const label = await home.getByText('Home').boundingBox();
        const glyph = await home.locator('svg').boundingBox();
        expect(label).not.toBeNull();
        expect(glyph).not.toBeNull();
        // Beside, not under: the label starts to the right of the glyph's right edge.
        expect((label?.x ?? 0) >= (glyph?.x ?? 0) + (glyph?.width ?? 0) - 1).toBe(true);
    });

    test('is the stacked 64 px bar again in a window 480 px tall or more', async ({ page }) => {
        await page.setViewportSize({ width: 800, height: 480 });
        await signedIn(page);
        await page.goto(route('/'));

        const box = await visibleNav(page).boundingBox();
        expect(box?.height).toBeCloseTo(64, 0);
    });
});

for (const colorScheme of ['light', 'dark'] as const) {
    test.describe(`the shell (${colorScheme})`, () => {
        test.use({ colorScheme });

        for (const width of [390, 839]) {
            test(`draws the bottom tab bar at ${width} px, with no top bar and no hamburger`, async ({ page }) => {
                await page.setViewportSize({ width, height: 844 });
                await signedIn(page);
                await page.goto(route('/'));

                const nav = visibleNav(page);
                await expect(nav).toHaveCount(1);
                await expectTabNames(nav);
                await expect(nav.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
                // Home's roadmap placeholders say "Coming soon" by design; the NAVIGATION never does.
                await expect(nav.getByText(/soon/iu)).toHaveCount(0);
                await expect(page.getByRole('banner')).toHaveCount(0);
                await expect(page.getByRole('button', { name: /navigation/iu })).toHaveCount(0);

                const box = await nav.boundingBox();
                expect(box === null ? 0 : box.y + box.height).toBeCloseTo(844, 0);
            });
        }

        for (const width of [840, 1024, 1280]) {
            test(`draws the sidebar at ${width} px, Profile first, then New recipe, and no tab bar`, async ({
                page,
            }) => {
                await page.setViewportSize({ width, height: 900 });
                await signedIn(page);
                await page.goto(route('/'));

                const nav = visibleNav(page);
                await expect(nav).toHaveCount(1);
                await expect(page.locator('[data-tab-bar]')).toBeHidden();

                const newRecipe = page.getByRole('button', { name: 'New recipe' }).filter({ visible: true });
                await expect(newRecipe).toHaveCount(1);
                const order = await newRecipe.evaluate((button, navName) => {
                    const sidebarNav = [...document.querySelectorAll('nav')].find(
                        (candidate) => candidate.getAttribute('aria-label') === navName && candidate.checkVisibility(),
                    );

                    return sidebarNav !== undefined && Boolean(button.compareDocumentPosition(sidebarNav) & 4);
                }, 'Main');
                expect(order, 'New recipe comes before the destinations').toBe(true);
                await expect(page.getByRole('banner')).toHaveCount(0);

                // The profile row is the first row, where the wordmark was: before New recipe, to Profile, no wordmark,
                // and no second Profile entry at the foot.
                const profile = page.getByRole('link', { name: /^Profile/u }).filter({ visible: true });
                await expect(profile).toHaveCount(1);
                await expect(profile).toHaveAttribute('href', /\/profile$/u);
                const profileFirst = await profile.evaluate(
                    (row, button) => Boolean(row.compareDocumentPosition(button as Node) & 4),
                    await newRecipe.elementHandle(),
                );
                expect(profileFirst, 'the profile row comes before New recipe').toBe(true);
                await expect(page.getByText('Commise', { exact: true })).toHaveCount(0);
            });
        }

        test('opens Profile from the sidebar’s first row at 1280 px, which takes the active style, with no Back', async ({
            page,
        }) => {
            await page.setViewportSize({ width: 1280, height: 900 });
            await signedIn(page);
            await page.goto(route('/'));

            await page
                .getByRole('link', { name: /^Profile/u })
                .filter({ visible: true })
                .click();

            await expect(page).toHaveURL(/\/profile$/u);
            await expect(page.getByRole('heading', { level: 1, name: 'Profile' })).toBeVisible();
            await expect(page.getByRole('link', { name: /^Profile/u }).filter({ visible: true })).toHaveAttribute(
                'aria-current',
                'page',
            );
            // A tab root: nothing to go back to.
            await expect(page.getByRole('link', { name: /^Back/u })).toHaveCount(0);
        });

        test('opens Profile from the You tab at 390 px, which takes the ring, and no title row carries an avatar', async ({
            page,
        }) => {
            await page.setViewportSize({ width: 390, height: 844 });
            await signedIn(page);

            for (const path of ['/', '/recipes', '/collections', '/discover']) {
                await page.goto(route(path));
                await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
                await expect(
                    page.getByRole('main').getByRole('link', { name: /^Profile/u }),
                    `${path}: no avatar link in the page`,
                ).toHaveCount(0);
                await expect(
                    page.getByRole('main').getByRole('button', { name: /^Profile/u }),
                    `${path}: no avatar button in the page`,
                ).toHaveCount(0);
            }

            await page.goto(route('/'));
            await visibleNav(page).getByRole('link', { name: 'You', exact: true }).click();

            await expect(page).toHaveURL(/\/profile$/u);
            await expect(page.getByRole('heading', { level: 1, name: 'Profile' })).toBeVisible();
            await expect(visibleNav(page).getByRole('link', { name: 'You', exact: true })).toHaveAttribute(
                'aria-current',
                'page',
            );
            await expect(page.getByRole('link', { name: /^Back/u })).toHaveCount(0);
        });

        test('fits four tabs of at least 80 × 56 across 320 px with no horizontal scroll', async ({ page }) => {
            await page.setViewportSize({ width: 320, height: 640 });
            await signedIn(page);
            await page.goto(route('/'));

            const links = visibleNav(page).getByRole('link');
            await expect(links).toHaveCount(4);

            for (const link of await links.all()) {
                const box = await link.boundingBox();
                expect(box?.width ?? 0).toBeGreaterThanOrEqual(80);
                expect(box?.height ?? 0).toBeGreaterThanOrEqual(56);
            }

            expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
        });

        test('keeps the sidebar collapsed across a reload, at the right width from the first paint', async ({
            page,
        }) => {
            await page.setViewportSize({ width: 1280, height: 900 });
            await signedIn(page);
            await page.goto(route('/'));

            await page.getByRole('button', { name: 'Collapse' }).click();
            await expect(page.getByRole('button', { name: 'Expand sidebar' })).toHaveAttribute(
                'aria-expanded',
                'false',
            );

            await page.reload({ waitUntil: 'domcontentloaded' });
            // The server read the cookie, so the very first layout is the 80 px rail: no shift on hydration.
            const sidebar = page.locator('[data-collapsed]').first();
            await expect(sidebar).toHaveAttribute('data-collapsed', 'true');
            expect((await sidebar.boundingBox())?.width).toBe(80);

            await page.getByRole('button', { name: 'Expand sidebar' }).click();
            await expect(page.getByRole('button', { name: 'Collapse' })).toBeVisible();
            await expect.poll(async () => (await sidebar.boundingBox())?.width).toBe(256);
        });

        // W-02: the rail is `overflow-y-auto`, which clips x too, so the in-flow tip was a 4 px sliver on hover and nothing
        // on focus. The label is a portalled tooltip now (SC 1.4.13): shown by hover and by keyboard focus, beside the rail
        // and wholly on screen, dismissed by Escape, and it stays while the pointer is over it.
        // ⚠️ Not run when written; the tip is aria-hidden, so it is found by its text rather than by a role.
        test('shows the collapsed rail’s New recipe tooltip beside the rail, fully visible, on hover and on focus', async ({
            page,
        }) => {
            await page.setViewportSize({ width: 1280, height: 900 });
            await signedIn(page);
            await page.goto(route('/'));
            await page.getByRole('button', { name: 'Collapse' }).click();

            const rail = page.locator('[data-collapsed="true"]');
            const button = page.getByRole('button', { name: 'New recipe' }).filter({ visible: true });
            // The tip is `aria-hidden` and drawn in a portal, so it has no role to ask for.
            const tip = page.locator('[data-tooltip]');
            const railBox = await rail.boundingBox();

            await button.hover();
            await expect(tip).toBeVisible();

            const box = await tip.boundingBox();
            const viewport = page.viewportSize();

            expect(box, 'the tip has a layout box').not.toBeNull();
            // Not a sliver (it was 4 px): the whole label, and reaching past the rail's edge, inside the window. The tip's
            // box begins at the control (it is joined by padding), so it is its RIGHT edge that clears the rail.
            expect(box?.width ?? 0).toBeGreaterThan(60);
            expect((box?.x ?? 0) + (box?.width ?? 0)).toBeGreaterThan((railBox?.x ?? 0) + (railBox?.width ?? 0));
            expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(viewport?.width ?? 0);

            // Hoverable (SC 1.4.13): the pointer can cross onto the tip and it stays.
            await tip.hover();
            await expect(tip).toBeVisible();

            // Dismissible: Escape hides it without the pointer moving.
            await page.keyboard.press('Escape');
            await expect(tip).toBeHidden();

            // Keyboard focus shows it too, with the pointer elsewhere (the clipped tip never appeared on focus).
            await page.mouse.move(640, 600);
            await expect(tip).toBeHidden();
            await button.focus();
            await page.keyboard.press('Shift+Tab');
            await page.keyboard.press('Tab');
            await expect(button).toBeFocused();
            await expect(tip).toBeVisible();
            await page.keyboard.press('Escape');
            await expect(tip).toBeHidden();
        });

        test('puts the floating New recipe right after the H1 in DOM order, on a phone', async ({ page }) => {
            await page.setViewportSize({ width: 390, height: 844 });
            await signedIn(page);
            await page.goto(route('/'));

            const heading = page.getByRole('heading', { level: 1 });
            await expect(heading).toBeVisible();
            const fab = page.getByRole('button', { name: 'New recipe' }).filter({ visible: true });
            await expect(fab).toHaveCount(1);

            const follows = await heading.evaluate((h1, fabName) => {
                const button = [...document.querySelectorAll('button')].find(
                    (candidate) => candidate.textContent?.includes(fabName) === true && candidate.checkVisibility(),
                );
                const focusables = [...document.querySelectorAll('main a[href], main button')].filter((node) =>
                    node.checkVisibility(),
                );
                const firstAfter = focusables.find((node) => Boolean(h1.compareDocumentPosition(node) & 4));

                // The title row carries no avatar (owner ruling 2026-11-11, N3): the floating button is the next control.
                return button !== undefined && firstAfter === button;
            }, 'New recipe');
            expect(follows).toBe(true);
        });

        test('scrolls a tab’s root to the top on a second tap of the active tab', async ({ page }) => {
            await page.setViewportSize({ width: 390, height: 844 });
            await signedIn(page, 40);
            await page.goto(route('/recipes'));
            await expect(page.getByText('Shell recipe 40')).toBeAttached();

            await page.evaluate(() => window.scrollTo({ top: 1500 }));
            await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(1000);
            await visibleNav(page).getByRole('link', { name: 'Recipes' }).click();

            await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
            await expect(page).toHaveURL(/\/recipes$/u);
        });

        test('shows Back to top past four screens on the way up, and it returns to the top and the H1', async ({
            page,
        }) => {
            await page.setViewportSize({ width: 390, height: 700 });
            await signedIn(page, 60);
            await page.goto(route('/recipes'));
            await expect(page.getByText('Shell recipe 60')).toBeAttached();

            const backToTop = page.getByRole('button', { name: 'Back to top' });
            await page.mouse.wheel(0, 4000);
            await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(3200);
            await expect(backToTop, 'not while scrolling down').toHaveCount(0);

            await page.mouse.wheel(0, -200);
            await expect(backToTop).toBeVisible();
            await backToTop.click();

            await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
            await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
        });
    });
}

test.describe('the floating button and the on-screen keyboard', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('hides while a text field holds focus on a touch screen', async ({ page }) => {
        await signedIn(page, 3);
        await page.goto(route('/recipes'));

        const fab = page.getByRole('button', { name: 'New recipe' }).filter({ visible: true });
        await expect(fab).toHaveCount(1);
        await page.getByRole('searchbox').first().focus();
        await expect(fab).toHaveCount(0);

        await page.getByRole('heading', { level: 1 }).click();
        await expect(fab).toHaveCount(1);
    });
});
