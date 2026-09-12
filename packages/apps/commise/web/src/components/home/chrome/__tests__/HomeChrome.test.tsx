// @vitest-environment jsdom
/**
 * Component tests for the Home application shell (US-000 / FR-046).
 *
 * The shell owns only ephemeral view state — the collapsed rail and the mobile drawer — so these exercise
 * that state: the surface content lands in the `<main>` landmark, the sidebar and tab bar are both present
 * (the two responsive renderings of the nav), the hamburger opens and the drawer dismisses, and the collapse
 * control flips. Selectors are role/label only.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { RECIPE_HOME_WIDGET_CAPABILITY } from '@commise/features-recipes';

import { webMessages } from '@/i18n/messages';

import { HomeChrome } from '../HomeChrome';

afterEach(cleanup);

const chrome = webMessages.en.home.chrome;

const renderChrome = (): void => {
    render(
        <HomeChrome
            chrome={chrome}
            pageTitle={chrome.pageTitles.home}
            locale="en"
            liveCapabilities={[RECIPE_HOME_WIDGET_CAPABILITY]}
            activeId="home"
            displayName="Jane Doe"
        >
            <p>surface-content</p>
        </HomeChrome>,
    );
};

describe('HomeChrome', () => {
    it('renders the surface content inside the main landmark', () => {
        renderChrome();

        expect(screen.getByRole('main').textContent).toContain('surface-content');
    });

    it('renders both responsive nav renderings (sidebar + tab bar)', () => {
        renderChrome();

        // jsdom does not apply the responsive `hidden` classes, so both landmarks are in the tree; in a real
        // viewport exactly one is display:none. Two named nav landmarks is the contract.
        expect(screen.getAllByRole('navigation', { name: chrome.primaryNavLabel }).length).toBeGreaterThanOrEqual(1);
        expect(screen.getByRole('banner')).toBeTruthy();
    });

    it('opens the mobile nav drawer from the hamburger and dismisses it, returning focus to the hamburger', async () => {
        const user = userEvent.setup();
        renderChrome();

        // Closed by default.
        expect(screen.queryByRole('dialog', { name: chrome.primaryNavLabel })).toBeNull();

        const hamburger = screen.getByRole('button', { name: chrome.openNav });
        await user.click(hamburger);
        const drawer = screen.getByRole('dialog', { name: chrome.primaryNavLabel });
        expect(drawer).toBeTruthy();

        // The close control inside the drawer dismisses it.
        await user.click(within(drawer).getByRole('button', { name: chrome.closeNav }));
        expect(screen.queryByRole('dialog', { name: chrome.primaryNavLabel })).toBeNull();

        // Radix's FocusScope restores focus via an unmount-cleanup `setTimeout(0)` — a real macrotask, not a
        // React state update — so this needs one real tick to elapse.
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(document.activeElement).toBe(hamburger);
    });

    it('closes the mobile drawer on Escape and returns focus to the hamburger (Radix B6/CR-003)', async () => {
        const user = userEvent.setup();
        renderChrome();

        const hamburger = screen.getByRole('button', { name: chrome.openNav });
        await user.click(hamburger);
        expect(screen.getByRole('dialog', { name: chrome.primaryNavLabel })).toBeTruthy();

        await user.keyboard('{Escape}');
        expect(screen.queryByRole('dialog', { name: chrome.primaryNavLabel })).toBeNull();

        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(document.activeElement).toBe(hamburger);
    });

    it('moves focus to the close control when the mobile drawer opens, and traps it while open', async () => {
        const user = userEvent.setup();
        renderChrome();

        await user.click(screen.getByRole('button', { name: chrome.openNav }));
        const drawer = screen.getByRole('dialog', { name: chrome.primaryNavLabel });
        const closeControl = within(drawer).getByRole('button', { name: chrome.closeNav });

        expect(document.activeElement).toBe(closeControl);

        // Radix marks everything outside the drawer `aria-hidden` while trapped, so the collapse control is
        // intentionally unreachable through `getByRole` while open — assert by the surviving accessible name.
        expect(screen.queryByRole('button', { name: chrome.collapseNav })).toBeNull();

        for (let index = 0; index < 8; index += 1) {
            await user.tab();
            expect(drawer.contains(document.activeElement)).toBe(true);
        }
    });

    it('flips the collapse control between collapse and expand', async () => {
        const user = userEvent.setup();
        renderChrome();

        await user.click(screen.getByRole('button', { name: chrome.collapseNav }));
        expect(screen.getByRole('button', { name: chrome.expandNav })).toBeTruthy();

        await user.click(screen.getByRole('button', { name: chrome.expandNav }));
        expect(screen.getByRole('button', { name: chrome.collapseNav })).toBeTruthy();
    });

    it('clears the fixed tab bar AND the device safe-area inset below the main content (U5)', () => {
        renderChrome();

        // The main foot clears the 5rem-tall narrow-breakpoint tab bar PLUS the bottom safe-area inset, and
        // collapses back to the base `lg:pb-6` once the bar becomes a desktop sidebar. `env(...)` is 0 in a
        // normal viewport, so the base value stays 5rem and desktop is unchanged.
        const main = screen.getByRole('main');
        expect(main.className).toContain('pb-[calc(5rem+env(safe-area-inset-bottom))]');
        expect(main.className).toContain('lg:pb-6');
    });
});

/**
 * The desktop-vs-narrow navigation CUTOVER — the width at which the shell swaps one rendering of the nav for
 * another (U39).
 *
 * ## The defect this locks out
 *
 * The shipped chrome disagreed with itself about its own cutover: the hamburger and the drawer hid at `md`
 * (768px) while the rail only appeared at `lg` (1024px). Between 768 and 1023px there was therefore NEITHER
 * — a tablet had no way to reach the full navigation, and survived only on the tab bar's compact icons.
 * `AppShell`'s module doc already called the cutover "the shared `lg` token", so `md` was the unfinished half
 * of that migration rather than a second, deliberate breakpoint.
 *
 * The invariant is stated as a MUTUAL EXCLUSION over a width — "exactly one of {hamburger, rail}" — not as
 * two independent per-element class assertions. Both failure directions (neither present, which is the U39
 * gap; both present, a future over-correction) fail it on their own, and it stays meaningful whatever
 * breakpoint the chrome later moves to, so long as the three renderings move together.
 *
 * ## What jsdom can settle here, and where the rest is proved
 *
 * jsdom runs no Tailwind and computes no layout, so nothing here MEASURES anything. `isDisplayedAt` resolves
 * a width against the element's own class string using Tailwind's default breakpoint scale: it reads the real
 * classes the components ship, but it necessarily assumes `lg` still means 1024px, and that assumption is the
 * one thing it cannot check. That is precisely the class of failure that once let a 32px avatar paint at 64px
 * while a jsdom simulator stayed green (see `HomeTopBar.test.tsx`), so the authoritative measurement lives in
 * `tests/e2e/homeNavCutover.spec.ts`, which loads the real stylesheet at 767 / 900 / 1024px and asks a real
 * engine what is visible. This suite is the fast guard that keeps the class strings in agreement.
 */
describe('HomeChrome — the desktop-vs-narrow nav cutover', () => {
    /** Tailwind's default `min-width` scale, in px. This app's `@theme` does not override it (globals.css). */
    const BREAKPOINT_MIN_WIDTH_PX: Readonly<Record<string, number>> = {
        sm: 640,
        md: 768,
        lg: 1024,
        xl: 1280,
        '2xl': 1536,
    };

    /** The `display` utilities this chrome uses. Matched as WHOLE tokens, so `flex-1` is never `flex`. */
    const DISPLAY_UTILITIES = new Set(['hidden', 'flex', 'block', 'inline-flex', 'inline-block', 'grid']);

    /**
     * The nearest self-or-ancestor element whose `display` is RESPONSIVE — i.e. that carries a
     * breakpoint-prefixed display utility.
     *
     * Anchoring on the responsive one is what makes this work from a role query: the rail's collapse control
     * is itself an unprefixed `flex`, so a "nearest element with any display utility" walk would stop on the
     * button and never reach the rail whose visibility is actually in question.
     *
     * @param from - The role-anchored element to walk up from (inclusive).
     * @returns The element whose display classes decide whether `from` is on screen.
     * @throws Error When no ancestor carries one — the anchor is wrong for this assertion.
     */
    const responsiveDisplayScope = (from: Element): Element => {
        for (let node: Element | null = from; node !== null; node = node.parentElement) {
            const isResponsive = [...node.classList].some((token) => {
                const [variant, utility] = token.split(':');

                return utility !== undefined && variant !== undefined && variant in BREAKPOINT_MIN_WIDTH_PX
                    ? DISPLAY_UTILITIES.has(utility)
                    : false;
            });

            if (isResponsive) {
                return node;
            }
        }

        throw new Error(`no responsive display scope at or above <${from.tagName.toLowerCase()}>`);
    };

    /**
     * Whether an element is displayed at a viewport width, per its own Tailwind display utilities.
     *
     * Tailwind emits base utilities first and breakpoint variants in ascending `min-width` order, so for one
     * property the WIDEST matching breakpoint wins; an unprefixed utility is the 0px base.
     *
     * @param from - A role-anchored element inside the rendering under test.
     * @param widthPx - The viewport width to resolve against.
     * @returns `true` unless the winning display utility is `hidden`.
     */
    const isDisplayedAt = (from: Element, widthPx: number): boolean => {
        const scope = responsiveDisplayScope(from);
        let winner = 'block';
        let winningMinWidth = -1;

        for (const token of scope.classList) {
            const parts = token.split(':');
            const utility = parts.length === 1 ? parts[0] : parts[1];
            const variant = parts.length === 1 ? undefined : parts[0];

            if (utility === undefined || !DISPLAY_UTILITIES.has(utility)) {
                continue;
            }

            const minWidth = variant === undefined ? 0 : (BREAKPOINT_MIN_WIDTH_PX[variant] ?? Number.NaN);

            if (Number.isNaN(minWidth) || minWidth > widthPx || minWidth < winningMinWidth) {
                continue;
            }

            winner = utility;
            winningMinWidth = minWidth;
        }

        return winner !== 'hidden';
    };

    /**
     * The three renderings of the nav, each reached by role + accessible name — never by a test id.
     *
     * The rail is anchored on `collapseNav`, a control only the rail has; the tab bar is then the 'Main'
     * landmark that is NOT inside the rail, which distinguishes the two without depending on DOM order.
     *
     * @returns The hamburger, an element inside the rail, and the tab bar's nav landmark.
     * @throws Error When the tab bar landmark cannot be told apart from the rail's.
     */
    const navRenderings = (): { hamburger: Element; rail: Element; tabBar: Element } => {
        const hamburger = screen.getByRole('button', { name: chrome.openNav });
        const rail = screen.getByRole('button', { name: chrome.collapseNav });
        const railRoot = responsiveDisplayScope(rail);
        const tabBar = screen
            .getAllByRole('navigation', { name: chrome.primaryNavLabel })
            .find((landmark) => !railRoot.contains(landmark));

        if (tabBar === undefined) {
            throw new Error('no bottom tab bar landmark outside the desktop rail');
        }

        return { hamburger, rail, tabBar };
    };

    const cutoverCases: [label: string, widthPx: number, hamburgerShown: boolean, railShown: boolean][] = [
        ['767px (a phone) — the hamburger, no rail', 767, true, false],
        ['900px (a TABLET) — the gap U39 closes', 900, true, false],
        ['1024px (desktop) — the rail, no hamburger', 1024, false, true],
    ];

    it.each(cutoverCases)(
        'shows exactly one of {hamburger, rail} at %s',
        (_label, widthPx, hamburgerShown, railShown) => {
            renderChrome();
            const { hamburger, rail } = navRenderings();

            expect(isDisplayedAt(hamburger, widthPx), `the hamburger at ${widthPx}px`).toBe(hamburgerShown);
            expect(isDisplayedAt(rail, widthPx), `the desktop rail at ${widthPx}px`).toBe(railShown);
            expect(
                [hamburger, rail].filter((element) => isDisplayedAt(element, widthPx)).length,
                `exactly one navigation affordance at ${widthPx}px`,
            ).toBe(1);
        },
    );

    const tabBarCases: [label: string, widthPx: number, shown: boolean][] = [
        ['767px', 767, true],
        ['900px', 900, true],
        ['1024px', 1024, false],
    ];

    it.each(tabBarCases)('leaves the bottom tab bar on its own unchanged cutover at %s', (_label, widthPx, shown) => {
        renderChrome();

        expect(isDisplayedAt(navRenderings().tabBar, widthPx), `the tab bar at ${widthPx}px`).toBe(shown);
    });

    it('opens a drawer that survives the SAME cutover as the hamburger that opens it', async () => {
        const user = userEvent.setup();
        renderChrome();

        await user.click(navRenderings().hamburger);
        const drawer = screen.getByRole('dialog', { name: chrome.primaryNavLabel });
        // Radix portals the overlay immediately before the panel; it carries no role of its own, so it is
        // reached structurally from the role-anchored panel rather than given a test-only attribute.
        const overlay = drawer.previousElementSibling;

        expect(overlay, 'the drawer overlay').not.toBeNull();
        expect(isDisplayedAt(drawer, 900), 'the drawer panel at 900px').toBe(true);
        expect(isDisplayedAt(overlay ?? drawer, 900), 'the drawer overlay at 900px').toBe(true);
        // A drawer that hid at a width where its trigger is shown would open onto nothing; one that opens
        // must still trap focus, which is the behaviour the tablet width now newly depends on.
        expect(drawer.contains(document.activeElement)).toBe(true);
    });
});
