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
