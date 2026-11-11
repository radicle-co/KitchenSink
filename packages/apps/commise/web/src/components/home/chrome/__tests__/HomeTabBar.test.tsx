// @vitest-environment jsdom
/**
 * The web bottom tab bar (`buildSpec.md` §3.2; slice 3): the reachable destinations and no "Soon" item, on the
 * floating layer's material, gone from 840; the active tab marked by `aria-current`, the here-bar and the weight; and the
 * second tap on the active tab — to the root from a pushed route, to the top at the root.
 *
 * Rewritten for the You tab (owner ruling 2026-11-11, N3): the bar now has FOUR items, Home, Recipes, Discover and You,
 * so the tests that pinned "exactly three" pin four, and the ones that read a tab's `textContent` read its label, because
 * the You tab's glyph is the cook's initials. The You tab's states (loading disc, initials, no-name glyph, active ring,
 * accessible name "You") are the new describe at the foot.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

import { homeMessages } from '@commise/features-core/home';
import { RECIPE_HOME_WIDGET_CAPABILITY } from '@commise/features-recipes';
import {
    TAB_LABEL_TEXT_CAP,
    YOU_TAB_DISC_SIZE,
    YOU_TAB_INITIALS_SIZE,
    type HomeNavItemId,
    type ProfileEntry,
} from '@commise/features-core';
import { ScrollHost } from '@commise/ui/scroll-host';

import { webMessages } from '@/i18n/messages';

import { HomeTabBar } from '../HomeTabBar';

const route = vi.hoisted(() => ({ pathname: '/en' }));

vi.mock('next/navigation', () => ({ usePathname: () => route.pathname }));

const chrome = { ...homeMessages.en.chrome, ...webMessages.en.home.chrome };

beforeEach(() => {
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

const READY: ProfileEntry = { status: 'ready', name: 'Eliza Montgomery' };

const renderBar = (
    activeId: HomeNavItemId | null = 'home',
    live: readonly string[] = [RECIPE_HOME_WIDGET_CAPABILITY],
    profile: ProfileEntry = READY,
) =>
    render(
        <ScrollHost>
            <HomeTabBar chrome={chrome} locale="en" liveCapabilities={live} activeId={activeId} profile={profile} />
        </ScrollHost>,
    );

const bar = (): HTMLElement => screen.getByRole('navigation', { name: chrome.tabNavLabel });

/** The visible label of every tab, in order (a tab's `textContent` also holds the You disc's initials). */
const labels = (): (string | undefined)[] =>
    within(bar())
        .getAllByRole('link')
        .map((link) => link.querySelector('.text-caption')?.textContent);

describe('HomeTabBar (web)', () => {
    it('shows exactly Home, Recipes, Discover and You, as links, and no "Soon" item', () => {
        renderBar();

        expect(labels()).toEqual(['Home', 'Recipes', 'Discover', 'You']);
        expect(within(bar()).queryByRole('button')).toBeNull();
        expect(bar().textContent).not.toMatch(/soon/i);
    });

    it('adds Plan only once its capability goes live', () => {
        renderBar('home', [RECIPE_HOME_WIDGET_CAPABILITY, 'meal-planning']);

        // Plan has no route yet, so a live capability still draws no dead link.
        expect(within(bar()).getAllByRole('link')).toHaveLength(4);
    });

    it('links each destination to its route', () => {
        renderBar();

        expect(within(bar()).getByRole('link', { name: 'Recipes' }).getAttribute('href')).toBe('/en/recipes');
        expect(within(bar()).getByRole('link', { name: 'Discover' }).getAttribute('href')).toBe('/en/discover');
        expect(within(bar()).getByRole('link', { name: 'You' }).getAttribute('href')).toBe('/en/profile');
    });

    it('marks the active destination with aria-current, the here-bar and the weight', () => {
        renderBar('recipes');

        const active = within(bar()).getByRole('link', { name: 'Recipes' });
        const inactive = within(bar()).getByRole('link', { name: 'Home' });

        expect(active.getAttribute('aria-current')).toBe('page');
        expect(inactive.getAttribute('aria-current')).toBeNull();
        expect(active.className.split(/\s+/u)).toContain('text-ink');
        expect(inactive.className).toContain('text-ink-muted');
        expect(active.querySelector('.bg-here-bar')).not.toBeNull();
        expect(inactive.querySelector('.bg-here-bar')).toBeNull();
    });

    it('marks nothing on a page that is no destination (the 404)', () => {
        renderBar(null);

        expect(
            within(bar())
                .getAllByRole('link')
                .some((link) => link.hasAttribute('aria-current')),
        ).toBe(false);
    });

    it('sits on the bar material, clears the home indicator, and is gone from 840', () => {
        const { container } = renderBar();

        expect(container.querySelector('[data-material="bar"]')).not.toBeNull();
        expect(bar().className).toContain('pb-[env(safe-area-inset-bottom)]');
        expect(bar().className).toContain('nav:hidden');
    });

    it('scrolls to the top on a second tap at the tab’s root, instead of navigating', () => {
        route.pathname = '/en/recipes';
        renderBar('recipes');

        const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
        within(bar()).getByRole('link', { name: 'Recipes' }).dispatchEvent(event);

        expect(event.defaultPrevented).toBe(true);
        expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
    });

    it('navigates to the tab’s root on a second tap from a pushed route', () => {
        route.pathname = '/en/recipes/01HX';
        renderBar('recipes');

        const link = within(bar()).getByRole('link', { name: 'Recipes' });
        fireEvent.click(link);

        expect(window.scrollTo).not.toHaveBeenCalled();
        expect(link.getAttribute('href')).toBe('/en/recipes');
    });

    it('leaves a tap on ANOTHER tab to navigate', () => {
        route.pathname = '/en';
        renderBar('home');

        const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
        within(bar()).getByRole('link', { name: 'Recipes' }).dispatchEvent(event);

        expect(window.scrollTo).not.toHaveBeenCalled();
    });
});

/**
 * Design review 2026-11-01 (`deviceShots2.md` M-2): when one label wraps and the others do not, a tab that centres its
 * content in the row's height moves its glyph down. The glyph row is one fixed row at the top of every tab: each column
 * starts at the top, 8 px down (the 1x look: 8 + 24 glyph + 4 + 20 label in 64), glyph first, label under it. The
 * compact row, where the label sits beside the glyph, stays centred.
 *
 * ⚠️ jsdom lays nothing out, so these pin the declared classes. Only a browser or a device proves the row lines up.
 */
describe('HomeTabBar (web) — one glyph row, whatever the labels do', () => {
    const COMPACT = '[@media(max-height:479px)]';

    it('starts every tab’s column at the top, 8 px down, centred across', () => {
        renderBar();

        for (const link of within(bar()).getAllByRole('link')) {
            const classes = link.className.split(/\s+/u);

            expect(classes).toEqual(expect.arrayContaining(['flex-col', 'items-center', 'justify-start', 'pt-2']));
            expect(classes).not.toContain('justify-center');
        }
    });

    it('draws each tab’s glyph before its label', () => {
        renderBar();

        for (const link of within(bar()).getAllByRole('link')) {
            const glyph = link.querySelector('svg, [data-you-disc]');
            const label = link.querySelector('.text-caption') as Element;

            expect(glyph).not.toBeNull();
            expect(glyph!.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        }
    });

    it('keeps the compact row centred, with no top padding, in a window under 480 px tall only', () => {
        renderBar();

        for (const link of within(bar()).getAllByRole('link')) {
            expect(link.className).toContain(`${COMPACT}:justify-center`);
            expect(link.className).toContain(`${COMPACT}:pt-0`);
        }
    });
});

/**
 * Owner 2026-10-13: a landscape phone (a window under 480 px tall, below the 840 px sidebar breakpoint) gets a compact bar —
 * the label beside the glyph, 48 px tall — that clears a side cutout. jsdom evaluates no media query, so what these pin is
 * the declared rule: the utilities are keyed on `max-height: 479px` (one pixel under the 480 dp compact class,
 * `isCompactHeight`), and the unconditional layout is unchanged. The rendered height is the Playwright test's.
 */
describe('HomeTabBar (web) — compact height', () => {
    const COMPACT = '[@media(max-height:479px)]';

    it('shrinks the bar to 48 px plus the foot inset, in a window under 480 px tall only', () => {
        renderBar();

        expect(bar().className).toContain(`${COMPACT}:h-[calc(3rem+env(safe-area-inset-bottom))]`);
        // The upright height is unchanged.
        expect(bar().className).toContain('h-[calc(4rem+env(safe-area-inset-bottom))]');
    });

    it('puts each label beside its glyph and gives each tab a 48 px target, in a window under 480 px tall only', () => {
        renderBar();

        for (const link of within(bar()).getAllByRole('link')) {
            expect(link.className).toContain(`${COMPACT}:flex-row`);
            expect(link.className).toContain(`${COMPACT}:min-h-12`);
        }
    });

    // Rewritten for four tabs (2026-11-11): the bar's own 8 px side padding is gone, because four tabs of at least 80 px
    // need the full 320 px and the padded 304 would push the fourth 16 px past the screen. The inset alone remains.
    it('pads both sides by the safe-area inset alone so a cutout never covers a tab and four fit at 320', () => {
        renderBar();

        expect(bar().className).toContain('pl-[env(safe-area-inset-left)]');
        expect(bar().className).toContain('pr-[env(safe-area-inset-right)]');
        expect(bar().className).not.toContain('max(0.5rem');
    });

    it('keeps every label as the link’s accessible name', () => {
        renderBar();

        expect(labels()).toEqual(['Home', 'Recipes', 'Discover', 'You']);
    });
});

/**
 * The You tab (owner ruling 2026-11-11, N3; `buildSpec.md` §3.2): the cook's avatar as a 24 px disc over the label "You",
 * to Profile. jsdom draws no pixels, so the ring and disc sizes are the declared classes; the 80 × 56 fit at 320 is the
 * Playwright test's.
 */
/**
 * Tab labels take their own 1.3× cap (owner ruling 2026-11-11, `buildSpec.md` §3.2): a label grows with the browser's text
 * size to 1.3× the caption size and stops, so four tabs at 320 keep every label on one line inside its 80. The value is the
 * shared `TAB_LABEL_TEXT_CAP`, never an inline number. jsdom lays nothing out, so this pins the declared size; the
 * Playwright spec measures it at 320 with the text at 200%.
 */
describe('HomeTabBar (web) — the tab label cap', () => {
    it('sizes every label as the caption size capped at 1.3× it, on one line', () => {
        renderBar();

        for (const link of within(bar()).getAllByRole('link')) {
            const label = link.querySelector('.text-caption') as HTMLElement;

            expect(label.style.fontSize).toBe(`min(0.875rem, ${String(14 * TAB_LABEL_TEXT_CAP)}px)`);
            expect(label.className).toContain('whitespace-nowrap');
        }
    });
});

describe('HomeTabBar (web) — the You tab', () => {
    const you = (): HTMLElement => within(bar()).getByRole('link', { name: 'You' });

    it('is named by its visible label "You" alone, whatever the disc shows (SC 2.5.3)', () => {
        renderBar('home', undefined, { status: 'ready', name: 'Eliza Montgomery' });

        expect(you().textContent).toContain('EM');
        expect(within(bar()).getAllByRole('link', { name: 'You' })).toHaveLength(1);
    });

    it('shows the initials in a 24 px disc on the action fill once the profile is ready', () => {
        renderBar();

        const disc = you().querySelector('[data-you-disc]');

        // A glyph never scales with text: the box is 24 CSS px, not rem, the same as the icons beside it.
        expect((disc as HTMLElement).style.width).toBe(`${String(YOU_TAB_DISC_SIZE)}px`);
        expect((disc as HTMLElement).style.height).toBe(`${String(YOU_TAB_DISC_SIZE)}px`);
        expect(disc?.className).not.toMatch(/\bsize-/u);
        expect(disc?.className).toContain('bg-action');
        expect(disc?.textContent).toBe('EM');
        expect((disc?.firstElementChild as HTMLElement).style.fontSize).toBe(`${String(YOU_TAB_INITIALS_SIZE)}px`);
    });

    it('shows a blank pearl disc while the profile loads, with no glyph and no initials', () => {
        renderBar('home', undefined, { status: 'loading', name: undefined });

        const disc = you().querySelector('[data-you-disc]');

        expect(disc?.className).toContain('bg-surface-muted');
        expect(disc?.textContent).toBe('');
        expect(disc?.querySelector('svg')).toBeNull();
    });

    it.each([
        ['has no name', { status: 'ready', name: undefined } as const],
        ['failed to load', { status: 'failed', name: undefined } as const],
    ])('shows the 20 px user glyph, never an error, when the profile %s', (_what, profile) => {
        renderBar('home', undefined, profile);

        expect(you().querySelector('[data-you-disc] svg')?.getAttribute('width')).toBe('20');
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('rings the disc in ink and marks the tab current when active (on /profile)', () => {
        renderBar('you');

        const disc = you().querySelector('[data-you-disc]');

        expect(you().getAttribute('aria-current')).toBe('page');
        // The ring is a box-shadow (`ring-*`), which takes no layout room, never a border.
        expect(disc?.className).toContain('ring-2');
        expect(disc?.className).toContain('ring-ink');
        expect(disc?.className).not.toMatch(/\bborder/u);
        expect(you().querySelector('.bg-here-bar')).not.toBeNull();
        expect(you().querySelector('.text-caption')?.className).toContain('font-semibold');
    });

    it('draws no ring and no current mark when another tab is active', () => {
        renderBar('recipes');

        expect(you().getAttribute('aria-current')).toBeNull();
        expect(you().querySelector('[data-you-disc]')?.className).not.toContain('ring-2');
    });

    it('takes an equal share of the bar and is at least 56 px tall, so four fit at 320 CSS px', () => {
        renderBar();

        for (const link of within(bar()).getAllByRole('link')) {
            // Equal shares of the bar (`flex-1`), with no rem minimum: a rem minimum grows with the browser's text size, so
            // at 200% four `min-w-20` tabs are 640 px and push You and Discover off a 320 px screen. Four shares of 320 are 80.
            expect(link.className).toContain('flex-1');
            expect(link.className).toContain('min-w-0');
            expect(link.className).toContain('min-h-14');
            expect(link.className).not.toMatch(/min-w-(?:20|24)/u);
        }
    });

    it('scrolls to the top on a second tap at Profile, instead of navigating', () => {
        route.pathname = '/en/profile';
        renderBar('you');

        const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
        you().dispatchEvent(event);

        expect(event.defaultPrevented).toBe(true);
        expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
    });
});
