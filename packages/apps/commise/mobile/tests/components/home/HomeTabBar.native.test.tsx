/**
 * The native bottom tab bar (`buildSpec.md` §3.2; D6, D14): the three reachable destinations and no "Soon" tab, each a
 * `tab` named by its label; the active one `selected`, in `ink` at weight 600 with the here-bar; on the floating
 * layer's material; padded by the bottom inset; and every press reported — the active tab's too, which is its second tap.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { RECIPE_HOME_WIDGET_CAPABILITY } from '@commise/features-recipes';
import type { HomeNavItemId } from '@commise/features-core';
import { role } from '@commise/ui/colors';

import { HomeTabBar } from '../../../src/components/home/chrome/HomeTabBar.js';
import { mobileMessages } from '../../../src/i18n/messages.js';

afterEach(cleanup);

const chrome = mobileMessages.en.home.chrome;

const renderBar = (activeId: HomeNavItemId = 'home', onPress = vi.fn(), live = [RECIPE_HOME_WIDGET_CAPABILITY]) =>
    render(
        <HomeTabBar chrome={chrome} liveCapabilities={live} activeId={activeId} onPress={onPress} bottomInset={34} />,
    );

/** `#RRGGBB` as the `rgb(r, g, b)` jsdom reports. */
const rgb = (hex: string): string => {
    const value = Number.parseInt(hex.slice(1), 16);

    return `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`;
};

describe('HomeTabBar (native)', () => {
    it('shows exactly Home, Recipes and Discover as tabs, and no "Soon" tab', () => {
        renderBar();

        expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Home', 'Recipes', 'Discover']);
        expect(screen.getByRole('tablist', { name: chrome.tabNavLabel }).textContent).not.toMatch(/soon/i);
    });

    it('shows Plan once its capability goes live', () => {
        renderBar('home', vi.fn(), [RECIPE_HOME_WIDGET_CAPABILITY, 'meal-planning']);

        expect(screen.getByRole('tab', { name: 'Plan' })).toBeTruthy();
    });

    it('marks the active tab selected, in ink, with the here-bar; the rest inkMuted and unselected', () => {
        renderBar('recipes');

        const active = screen.getByRole('tab', { name: 'Recipes' });
        const inactive = screen.getByRole('tab', { name: 'Home' });

        expect(active.getAttribute('aria-selected')).toBe('true');
        expect(inactive.getAttribute('aria-selected')).toBe('false');
        expect(getComputedStyle(screen.getByText('Recipes')).color).toBe(rgb(role.ink));
        expect(getComputedStyle(screen.getByText('Home')).color).toBe(rgb(role.inkMuted));
        expect(getComputedStyle(active.firstElementChild as Element).backgroundColor).toBe(rgb(role.hereBar));
        expect(getComputedStyle(inactive.firstElementChild as Element).backgroundColor).not.toBe(rgb(role.hereBar));
    });

    it('reports every press, the active tab’s too (its second tap)', () => {
        const onPress = vi.fn();
        renderBar('home', onPress);

        fireEvent.click(screen.getByRole('tab', { name: 'Discover' }));
        fireEvent.click(screen.getByRole('tab', { name: 'Home' }));

        expect(onPress.mock.calls).toEqual([['discover'], ['home']]);
    });

    it('pads its foot by the bottom safe-area inset, and gives each tab at least a 48 dp target', () => {
        renderBar();

        expect(getComputedStyle(screen.getByRole('tablist')).paddingBottom).toBe('34px');
        expect(getComputedStyle(screen.getByRole('tab', { name: 'Home' })).minHeight).toBe('64px');
    });
});
