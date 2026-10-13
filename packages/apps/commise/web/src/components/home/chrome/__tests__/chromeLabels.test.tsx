// @vitest-environment jsdom
/**
 * The two navigation landmarks the home chrome renders — the sidebar (840 and wider) and the bottom tab bar (below it) —
 * must not share an accessible name (`buildSpec.md` §10 Landmarks: "Sidebar and tab bar are nav with different names").
 * CSS shows one at a time, but the names are what a landmark list reads, and a destination that finds a nav by its
 * name must find exactly one (W-14).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { RECIPE_HOME_WIDGET_CAPABILITY } from '@commise/features-recipes';
import { ScrollHost } from '@commise/ui/scroll-host';

import { webMessages } from '@/i18n/messages';

import { HomeSidebar } from '../HomeSidebar';
import { HomeTabBar } from '../HomeTabBar';

vi.mock('next/navigation', () => ({ usePathname: () => '/en' }));

const chrome = webMessages.en.home.chrome;

beforeEach(() => {
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe('home chrome navigation landmark names', () => {
    it('names the sidebar and the tab bar differently', () => {
        expect(chrome.primaryNavLabel).not.toBe(chrome.tabNavLabel);
    });

    it('lets each landmark be found by its own name, once, with both rendered', () => {
        render(
            <ScrollHost>
                <HomeSidebar
                    chrome={chrome}
                    locale="en"
                    liveCapabilities={[RECIPE_HOME_WIDGET_CAPABILITY]}
                    activeId="home"
                    profile={{ status: 'ready', name: 'Eliza' }}
                    collapsed={false}
                    onToggleCollapse={() => undefined}
                    newRecipe={<button type="button">New recipe</button>}
                />
                <HomeTabBar
                    chrome={chrome}
                    locale="en"
                    liveCapabilities={[RECIPE_HOME_WIDGET_CAPABILITY]}
                    activeId="home"
                />
            </ScrollHost>,
        );

        expect(screen.getAllByRole('navigation')).toHaveLength(2);
        expect(screen.getByRole('navigation', { name: chrome.primaryNavLabel })).toBeTruthy();
        expect(screen.getByRole('navigation', { name: chrome.tabNavLabel })).toBeTruthy();
    });
});
