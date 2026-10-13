// @vitest-environment jsdom
/**
 * The web bottom tab bar (`buildSpec.md` §3.2; slice 3): the three reachable destinations and no "Soon" item, on the
 * floating layer's material, gone from 840; the active tab marked by `aria-current`, the here-bar and the weight; and the
 * second tap on the active tab — to the root from a pushed route, to the top at the root.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

import { RECIPE_HOME_WIDGET_CAPABILITY } from '@commise/features-recipes';
import type { HomeNavItemId } from '@commise/features-core';
import { ScrollHost } from '@commise/ui/scroll-host';

import { webMessages } from '@/i18n/messages';

import { HomeTabBar } from '../HomeTabBar';

const route = vi.hoisted(() => ({ pathname: '/en' }));

vi.mock('next/navigation', () => ({ usePathname: () => route.pathname }));

const chrome = webMessages.en.home.chrome;

beforeEach(() => {
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

const renderBar = (
    activeId: HomeNavItemId | null = 'home',
    live: readonly string[] = [RECIPE_HOME_WIDGET_CAPABILITY],
) =>
    render(
        <ScrollHost>
            <HomeTabBar chrome={chrome} locale="en" liveCapabilities={live} activeId={activeId} />
        </ScrollHost>,
    );

const bar = (): HTMLElement => screen.getByRole('navigation', { name: chrome.tabNavLabel });

describe('HomeTabBar (web)', () => {
    it('shows exactly Home, Recipes and Discover, as links, and no "Soon" item', () => {
        renderBar();

        expect(
            within(bar())
                .getAllByRole('link')
                .map((link) => link.textContent),
        ).toEqual(['Home', 'Recipes', 'Discover']);
        expect(within(bar()).queryByRole('button')).toBeNull();
        expect(bar().textContent).not.toMatch(/soon/i);
    });

    it('adds Plan only once its capability goes live', () => {
        renderBar('home', [RECIPE_HOME_WIDGET_CAPABILITY, 'meal-planning']);

        // Plan has no route yet, so a live capability still draws no dead link.
        expect(within(bar()).getAllByRole('link')).toHaveLength(3);
    });

    it('links each destination to its route', () => {
        renderBar();

        expect(within(bar()).getByRole('link', { name: 'Recipes' }).getAttribute('href')).toBe('/en/recipes');
        expect(within(bar()).getByRole('link', { name: 'Discover' }).getAttribute('href')).toBe('/en/discover');
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

    it('marks nothing on a page that is no destination (Profile)', () => {
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

    it('pads both sides by the safe-area inset so a cutout or a 3-button bar never covers a tab', () => {
        renderBar();

        expect(bar().className).toContain('pl-[max(0.5rem,env(safe-area-inset-left))]');
        expect(bar().className).toContain('pr-[max(0.5rem,env(safe-area-inset-right))]');
    });

    it('keeps every label as the link’s accessible name', () => {
        renderBar();

        expect(
            within(bar())
                .getAllByRole('link')
                .map((link) => link.textContent),
        ).toEqual(['Home', 'Recipes', 'Discover']);
    });
});
