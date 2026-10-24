import { expect } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';

/**
 * Assertions for a pushed page that sits in the design system's `PushedPageFrame`
 * (`docs/design/uiRefreshWorkshop5/pinnedBackBar.md` §6): below 840 its Back is pinned in a fixed bar and stays reachable
 * wherever the page is scrolled; from 840 there is no bar and the header's eyebrow link is the Back.
 *
 * Both Backs are in the DOM at every width and CSS shows one, so a count by role (which skips `display: none`) is the
 * proof of "exactly one visible". Selectors are role-only, as the suite requires.
 */

/** The bar's height in px, which `scroll-padding-top` keeps a focused control clear of (`PINNED_BAR_HEIGHT`). */
const BAR_PX = 56;

/** The most Tab presses the walk takes: well past any pushed page here, so a loop in the page cannot hang the spec. */
const MAX_TABS = 120;

/**
 * Below 840: the Back is the one visible match, is in the viewport after scrolling to the END of the page, a Tab walk
 * through the page never leaves the focused control under the bar, and a click lands on the parent page.
 *
 * The caller sets a narrow, short viewport (`test.use`) so the page really scrolls; this asserts it did, so a page too
 * short to scroll fails here instead of passing for nothing.
 *
 * @param page - A page already open on the pushed page.
 * @param backName - The Back's accessible name ("Back to Profile").
 * @param parent - The parent page's path, as a pattern the URL must match after the click.
 */
export async function expectBackPinnedWhileScrolling(page: Page, backName: string, parent: RegExp): Promise<void> {
    const back = page.getByRole('link', { name: backName });

    // The eyebrow is `display: none` below 840, so only the bar's copy matches.
    await expect(back).toHaveCount(1);
    await expect(back).toBeInViewport();

    // The H1 starts at the bar's bottom edge: `<main>` owns the room under the bar, so a page rendered OUTSIDE the shell's
    // `<main>` would leave it at y≈0, under the bar (and one with a leftover 24 px of padding would sit at 80). The Tab walk
    // cannot see this: the H1 is `tabIndex={-1}`.
    await page.evaluate(() => window.scrollTo(0, 0));
    const h1Top = (await page.getByRole('heading', { level: 1 }).first().boundingBox())?.y ?? Number.NaN;

    expect(h1Top, 'the H1 starts at the bar’s bottom edge, not under it').toBeGreaterThanOrEqual(BAR_PX);
    expect(h1Top, 'the H1 is not pushed below the bar by extra padding').toBeLessThan(BAR_PX + 8);

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect
        .poll(() => page.evaluate(() => window.scrollY), { message: 'the page scrolls to its end' })
        .toBeGreaterThan(0);

    await expect(back).toHaveCount(1);
    await expect(back).toBeInViewport();

    await expectTabWalkNeverUnderBar(page);

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await back.click();
    await expect(page).toHaveURL(parent);
}

/**
 * Walks focus through the page in one direction and returns the controls that took focus fully behind the bar, how many
 * presses it took and the deepest scroll position it saw. The bar's own controls are skipped (they ARE the bar).
 *
 * Forward from the top, a focused control scrolls in at the BOTTOM edge and never meets the bar; it is Shift+Tab from the
 * end, scrolling each control in at the TOP edge, that puts it under the bar unless `scroll-padding-top` holds it clear.
 * So the guard walks both ways.
 */
async function walkFocus(
    page: Page,
    key: 'Tab' | 'Shift+Tab',
): Promise<{ readonly covered: string[]; readonly presses: number; readonly deepest: number }> {
    await page.evaluate((fromEnd) => {
        (document.activeElement as HTMLElement | null)?.blur();
        window.scrollTo(0, fromEnd ? document.documentElement.scrollHeight : 0);
    }, key === 'Shift+Tab');

    const covered: string[] = [];
    let presses = 0;
    let deepest = 0;

    for (let press = 0; press < MAX_TABS; press += 1) {
        await page.keyboard.press(key);
        presses += 1;

        const seen = await page.evaluate((barPx) => {
            const focused = document.activeElement;

            if (focused === null || focused === document.body || focused === document.documentElement) {
                return { done: true as const };
            }

            if (focused.closest('[data-condensed]') !== null) {
                return { done: false as const, skipped: true as const };
            }

            const rect = focused.getBoundingClientRect();

            return {
                done: false as const,
                skipped: false as const,
                name: focused.getAttribute('aria-label') ?? focused.textContent?.trim().slice(0, 40) ?? focused.tagName,
                // Fully covered: it ends at or above the bar's lower edge, so none of it shows below the bar.
                covered: rect.bottom <= barPx,
                scrollY: window.scrollY,
            };
        }, BAR_PX);

        if (seen.done) {
            break;
        }

        if (!seen.skipped) {
            deepest = Math.max(deepest, seen.scrollY);

            if (seen.covered) {
                covered.push(seen.name);
            }
        }
    }

    return { covered, presses, deepest };
}

/** Tab from the top and Shift+Tab from the end: a focused control is never fully behind the bar. */
async function expectTabWalkNeverUnderBar(page: Page): Promise<void> {
    const forward = await walkFocus(page, 'Tab');
    const backward = await walkFocus(page, 'Shift+Tab');

    expect(forward.presses, 'the forward walk pressed Tab more than once').toBeGreaterThan(1);
    expect(backward.presses, 'the backward walk pressed Shift+Tab more than once').toBeGreaterThan(1);
    expect(
        Math.max(forward.deepest, backward.deepest),
        'the walks scrolled the page, so the bar had something to cover',
    ).toBeGreaterThan(0);
    expect(forward.covered, 'controls that took focus fully behind the pinned bar, walking forward').toEqual([]);
    expect(backward.covered, 'controls that took focus fully behind the pinned bar, walking backward').toEqual([]);
}

/**
 * From 840: the header's eyebrow is the one visible Back and the fixed bar is not displayed.
 *
 * @param page - A page already open on the pushed page.
 * @param backName - The Back's accessible name.
 */
export async function expectEyebrowBackAndNoBar(page: Page, backName: string): Promise<void> {
    const visible = page.getByRole('link', { name: backName });
    const all = page.getByRole('link', { name: backName, includeHidden: true });

    await expect(visible).toHaveCount(1);
    await expect(visible).toBeVisible();
    // The bar's copy comes first in the DOM, and is `display: none` from 840.
    await expect(all).toHaveCount(2);
    await expect(all.first()).toBeHidden();
    await expect(all.last()).toBeVisible();

    const underFixedAncestor = await visible.evaluate((node) => {
        for (let current: Element | null = node; current !== null; current = current.parentElement) {
            if (getComputedStyle(current).position === 'fixed') {
                return true;
            }
        }

        return false;
    });

    expect(underFixedAncestor, 'the visible Back is the in-flow eyebrow, not the fixed bar').toBe(false);
}

/**
 * Below 840: the page's H1 starts at the bar's bottom edge (56 px), not 24 px below it, and the shell's connectivity notice
 * sits UNDER the bar and AFTER Back in reading order. `<main>` takes the bar's height as its top padding on a pushed page, and
 * the shell draws the bar into a slot ahead of the notice.
 *
 * The H1 is measured first, with no notice, so a notice cannot move it; then the device goes offline and the notice is
 * measured. Both Back and the notice are located by role, and the order is the DOM's (`compareDocumentPosition`), which is
 * the reading and the tab order.
 *
 * @sideEffect Takes the browser context offline and leaves it offline.
 * @param page - A page already open on the pushed page.
 * @param context - Its browser context.
 * @param backName - The Back's accessible name.
 * @param h1Name - The H1's accessible name.
 */
export async function expectNoticeUnderBarAndAfterBack(
    page: Page,
    context: BrowserContext,
    backName: string,
    h1Name: string,
): Promise<void> {
    const h1 = page.getByRole('heading', { level: 1, name: h1Name });
    const back = page.getByRole('link', { name: backName });
    const notice = page.getByRole('status', { name: 'Sync status' });

    await expect(h1).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    const h1Top = (await h1.boundingBox())?.y ?? Number.NaN;

    // 56, not 80: the frame adds nothing to the 56 px `<main>` takes. The eyebrow is `display: none` here.
    expect(h1Top, 'the H1 starts at the bar’s bottom edge').toBeGreaterThanOrEqual(BAR_PX);
    expect(h1Top, 'the H1 is not pushed 24 px below the bar').toBeLessThan(BAR_PX + 8);

    await context.setOffline(true);
    await expect(notice.getByText('You’re offline')).toBeVisible();

    const barBottom = (await back.boundingBox())?.y ?? Number.NaN;
    const noticeBox = await notice.boundingBox();

    expect(barBottom, 'the bar is at the top of the viewport').toBeLessThan(BAR_PX);
    expect(noticeBox?.y ?? Number.NaN, 'the notice is not covered by the bar').toBeGreaterThanOrEqual(BAR_PX);

    const backFirst = await page.evaluate(
        ([backLabel]) => {
            const link = Array.from(document.querySelectorAll('a, button')).find(
                (node) => node.getAttribute('aria-label') === backLabel && node.closest('[data-condensed]') !== null,
            );
            const status = document.querySelector('[role="status"][aria-label="Sync status"]');

            return (
                link !== undefined &&
                status !== null &&
                (link.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
            );
        },
        [backName],
    );

    expect(backFirst, 'Back comes before the notice in reading and tab order').toBe(true);
}

/**
 * From tablet width (600) to 840 the bar's Back names its parent beside the chevron, as native's does ("‹ Collections");
 * the accessible name stays the full "Back to {parent}".
 *
 * @param page - A page already open on the pushed page, at a width in [600, 840).
 * @param backName - The Back's accessible name ("Back to Collections").
 * @param parent - The parent's name, as drawn.
 */
export async function expectBarNamesItsParent(page: Page, backName: string, parent: string): Promise<void> {
    const back = page.getByRole('link', { name: backName });

    await expect(back).toHaveCount(1);
    await expect(back.getByText(parent, { exact: true })).toBeVisible();
}

/**
 * Below 600 the bar's Back is the chevron alone: the parent's name is not drawn.
 *
 * @param page - A page already open on the pushed page, narrower than 600.
 * @param backName - The Back's accessible name.
 * @param parent - The parent's name, which must not be visible.
 */
export async function expectBarIsChevronOnly(page: Page, backName: string, parent: string): Promise<void> {
    await expect(page.getByRole('link', { name: backName }).getByText(parent, { exact: true })).toBeHidden();
}

/**
 * The bar's Back sits on the page's content gutter, so the chevron lines up with the H1 under it
 * (`docs/design/uiRefreshWorkshop5/pinnedBackBar.md` §6): 16 px below 600 and 24 px from 600, as `<main>`'s own padding.
 *
 * Measured by the Back control's bounding box against the H1's left edge, and against the literal gutter so both being
 * wrong together cannot pass. The chevron's own box is checked too, since it is what the eye reads.
 *
 * @param page - A page already open on the pushed page, below 840, scrolled to the top.
 * @param backName - The Back's accessible name.
 * @param gutter - The expected gutter in px (16 below 600, 24 from 600).
 */
export async function expectBackOnContentGutter(page: Page, backName: string, gutter: number): Promise<void> {
    const back = page.getByRole('link', { name: backName });

    await expect(back).toHaveCount(1);
    await page.evaluate(() => window.scrollTo(0, 0));

    const h1Left = (await page.getByRole('heading', { level: 1 }).first().boundingBox())?.x ?? Number.NaN;
    const backLeft = (await back.boundingBox())?.x ?? Number.NaN;
    const chevronLeft = (await back.locator('svg').first().boundingBox())?.x ?? Number.NaN;

    expect(h1Left, `the H1 starts on the ${String(gutter)} px gutter`).toBeCloseTo(gutter, 0);
    expect(backLeft, 'the Back control starts on the H1’s left edge').toBeCloseTo(h1Left, 0);
    expect(chevronLeft, 'the chevron starts on the H1’s left edge').toBeCloseTo(h1Left, 0);
}

/**
 * A state with no header (collection loading, a failed read) shows its Back where the width puts it: the bar's below 840
 * and the header's eyebrow from 840 (`display: none` for the other one). So there is exactly ONE visible Back, never none.
 *
 * @param page - A page already open on the state.
 * @param backName - The Back's accessible name.
 * @param visible - How many Backs are visible at this width.
 */
export async function expectVisibleBacks(page: Page, backName: string, visible: number): Promise<void> {
    const backs = page.getByRole('link', { name: backName });

    await expect(backs).toHaveCount(visible);

    for (const back of await backs.all()) {
        await expect(back).toBeVisible();
    }
}
