/**
 * Component tests for the mobile Home bottom tab bar (US-000 / FR-046 / FR-044). Rendered via react-native-web
 * under jsdom. The load-bearing behaviours: it renders the shared six-destination nav model; reachable
 * destinations are real tabs; gated ones are non-interactive "coming soon" (never navigate); the active
 * destination is the selected tab; and activating a reachable tab routes its id.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';

import { RECIPE_HOME_WIDGET_CAPABILITY } from '@commise/features-recipes';
import { HOME_NAV_ITEMS } from '@commise/features-core';
import { compositeOver, computedContrast, contrastRatio, renderWithProviders } from '@commise/test-utils';
import { palette } from '@commise/ui';

import { HomeTabBar } from '../../../src/components/home/chrome/HomeTabBar.js';
import { NAV_ICONS } from '../../../src/components/home/chrome/icons.js';
import { mobileMessages } from '../../../src/i18n/messages.js';

afterEach(cleanup);

const chrome = mobileMessages.en.home.chrome;
const LIVE = [RECIPE_HOME_WIDGET_CAPABILITY];

const renderTabBar = (overrides: Partial<Parameters<typeof HomeTabBar>[0]> = {}): ((id: string) => void) => {
    const onSelect = vi.fn();
    renderWithProviders(
        <HomeTabBar
            chrome={chrome}
            liveCapabilities={LIVE}
            activeId="home"
            onSelect={onSelect}
            bottomInset={0}
            {...overrides}
        />,
    );

    return onSelect;
};

describe('HomeTabBar (mobile)', () => {
    it('renders a tab for every shared destination', () => {
        renderTabBar();

        for (const label of ['Home', 'Recipes', 'Meal Plan', 'Grocery', 'Nutrition', 'Profile']) {
            expect(screen.getByRole('tab', { name: new RegExp(`^${label}`, 'u') })).toBeTruthy();
        }
    });

    it('marks the active destination as the selected tab', () => {
        renderTabBar({ activeId: 'home' });

        expect(screen.getByRole('tab', { name: 'Home' }).getAttribute('aria-selected')).toBe('true');
        expect(screen.getByRole('tab', { name: 'Recipes' }).getAttribute('aria-selected')).not.toBe('true');
    });

    it('renders gated destinations as disabled "coming soon" tabs that do not navigate', () => {
        const onSelect = renderTabBar();

        const mealPlan = screen.getByRole('tab', { name: `Meal Plan, ${chrome.comingSoonSuffix}` });
        expect(mealPlan.getAttribute('aria-disabled')).toBe('true');

        // It is not pressable — clicking it routes nothing.
        fireEvent.click(mealPlan);
        expect(onSelect).not.toHaveBeenCalled();
    });

    it('routes a reachable destination when its tab is activated', () => {
        const onSelect = renderTabBar();

        fireEvent.click(screen.getByRole('tab', { name: 'Recipes' }));

        expect(onSelect).toHaveBeenCalledWith('recipes');
    });

    it('reveals a gated destination as a real tab once its capability goes live', () => {
        const onSelect = renderTabBar({ liveCapabilities: [...LIVE, 'nutrition'] });

        const nutrition = screen.getByRole('tab', { name: 'Nutrition' });
        expect(nutrition.getAttribute('aria-disabled')).not.toBe('true');

        fireEvent.click(nutrition);
        expect(onSelect).toHaveBeenCalledWith('nutrition');
    });

    it('gives every tab — reachable and gated — a 44pt touch target (U4 / RC-3)', () => {
        renderTabBar();

        for (const tab of screen.getAllByRole('tab')) {
            expect(window.getComputedStyle(tab).minHeight).toBe('44px');
        }
    });

    it('pairs every tab — reachable and gated — with its mapped glyph (mockup parity)', () => {
        renderTabBar();

        for (const item of HOME_NAV_ITEMS) {
            const label = chrome.destinations[item.id];
            const tab = screen.getByRole('tab', { name: new RegExp(`^${label}`, 'u') });
            const glyph = tab.querySelector('[data-commise-stub="icon"]');

            expect(glyph, `no glyph on the ${item.id} tab`).not.toBeNull();
            expect(glyph?.getAttribute('data-icon-name')).toBe(NAV_ICONS[item.id]);
        }
    });

    it('keeps the glyph decorative — the label alone owns each tab’s accessible name', () => {
        renderTabBar();

        // Every glyph sits inside an aria-hidden wrapper, so no tab announces its icon…
        for (const glyph of screen.getAllByRole('tab').map((tab) => tab.querySelector('[data-commise-stub="icon"]'))) {
            expect(glyph?.closest('[aria-hidden="true"]')).not.toBeNull();
        }

        // …and the names stay exactly the label (gated tabs keep their "coming soon" suffix).
        expect(screen.getByRole('tab', { name: 'Recipes' })).toBeTruthy();
        expect(screen.getByRole('tab', { name: `Grocery, ${chrome.comingSoonSuffix}` })).toBeTruthy();
    });

    /**
     * The bar's own translucent glass over the Home screen's `sand` background — the opaque colour a reader
     * actually sees behind a tab label. Read from the rendered bar rather than restated, so re-tinting the
     * glass moves the measurement instead of quietly invalidating it.
     */
    const barSurface = (): string =>
        compositeOver(window.getComputedStyle(screen.getByRole('tablist')).backgroundColor, palette.sand);

    it('keeps the ACTIVE tab’s label WCAG-AA legible over the bar’s glass', () => {
        renderTabBar({ activeId: 'recipes' });

        // The selected label is real text a reader reads; seafoam is 3.99:1 on this glass, under the 4.5:1
        // body floor (SC 1.4.3). The web tab bar takes the same treatment — cross-platform parity (§14).
        const label = within(screen.getByRole('tab', { name: 'Recipes' })).getByText('Recipes');

        expect(computedContrast(label, { surface: barSurface() }), 'active tab label').toBeGreaterThanOrEqual(4.5);
    });

    it('keeps the ACTIVE tab’s GLYPH on the same colour decision as its label', () => {
        renderTabBar({ activeId: 'recipes' });

        // The glyph's colour arrives as a PROP, so there is no computed colour to read — the stub republishes
        // it as `data-icon-color`. It shares the active tab with the label, so it must share the label's
        // colour: an icon left on seafoam next to an `ocean-dark` label paints one control in two greens.
        const glyph = screen.getByRole('tab', { name: 'Recipes' }).querySelector('[data-commise-stub="icon"]');

        expect(glyph?.getAttribute('data-icon-color'), 'active tab glyph colour').toBe(palette['ocean-dark']);
        // …and the token it lands on clears the floor, so the assertion above stays a contrast claim rather
        // than a spelling check.
        expect(
            contrastRatio(palette['ocean-dark'], barSurface()),
            'ocean-dark on the bar glass',
        ).toBeGreaterThanOrEqual(4.5);
    });

    it('renders the "coming soon" label in slate (AA), not the 1.9:1 mist (U4)', () => {
        renderTabBar();

        const mealPlan = screen.getByRole('tab', { name: `Meal Plan, ${chrome.comingSoonSuffix}` });
        expect(window.getComputedStyle(within(mealPlan).getByText('Meal Plan')).color).toBe('rgb(99, 110, 114)');
    });
});
