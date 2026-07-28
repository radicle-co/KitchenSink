// @vitest-environment jsdom
/**
 * Component tests for the mobile bottom tab bar (US-000 / FR-046; U5 mobile-web safe-area polish).
 *
 * The bar is `lg:hidden` chrome — it never renders on desktop — so its safe-area handling is a pure
 * mobile-web concern. These lock the two things U5 adds without changing desktop: the destinations still
 * render by accessible name, and the bar reserves the device home-indicator inset at its foot (an
 * `env(safe-area-inset-bottom)` bottom padding, plus a height that grows by the same inset so the tappable
 * icons are never squished under the indicator). `env(...)` resolves to 0 in a normal viewport, so the class
 * contract is the only assertable surface here; the rendered clearance is proven by the Playwright 375px pass.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { RECIPE_HOME_WIDGET_CAPABILITY } from '@commise/features-recipes';
import { utilityContrast } from '@commise/test-utils';

import { webMessages } from '@/i18n/messages';

import { HomeTabBar } from '../HomeTabBar';

afterEach(cleanup);

const chrome = webMessages.en.home.chrome;

const renderTabBar = (): void => {
    render(
        <HomeTabBar chrome={chrome} locale="en" liveCapabilities={[RECIPE_HOME_WIDGET_CAPABILITY]} activeId="home" />,
    );
};

describe('HomeTabBar', () => {
    it('renders the tab navigation by its accessible name', () => {
        renderTabBar();

        expect(screen.getByRole('navigation', { name: chrome.tabNavLabel })).toBeTruthy();
    });

    it('marks the active destination with aria-current', () => {
        renderTabBar();

        const home = screen.getByRole('link', { name: chrome.destinations.home });
        expect(home.getAttribute('aria-current')).toBe('page');
    });

    it('keeps BOTH the active and the inactive tab label WCAG-AA legible', () => {
        renderTabBar();

        // The tab's colour class sits on the link and its `text-xs` label span INHERITS it, so the tab colour
        // is the colour of real text. Seafoam is 4.02:1 on the bar — under the 4.5:1 body floor — while the
        // inactive slate already clears it; both are asserted so a fix cannot land on the wrong branch.
        const active = screen.getByRole('link', { name: chrome.destinations.home });
        const inactive = screen.getByRole('link', { name: chrome.destinations.recipes });

        expect(utilityContrast(active.className), 'active tab label').toBeGreaterThanOrEqual(4.5);
        expect(utilityContrast(inactive.className), 'inactive tab label').toBeGreaterThanOrEqual(4.5);
    });

    it('reserves the device home-indicator inset (safe-area) at the foot without touching desktop', () => {
        renderTabBar();

        const nav = screen.getByRole('navigation', { name: chrome.tabNavLabel });
        // The foot pads by the bottom safe-area inset, and the bar height grows by the same inset so the
        // 64px icon row is never compressed under the indicator. Both reference env(safe-area-inset-bottom),
        // which is 0 in a normal viewport → desktop/browser output is unchanged. The bar stays `lg:hidden`.
        expect(nav.className).toContain('pb-[env(safe-area-inset-bottom)]');
        expect(nav.className).toContain('h-[calc(4rem+env(safe-area-inset-bottom))]');
        expect(nav.className).toContain('lg:hidden');
    });
});
