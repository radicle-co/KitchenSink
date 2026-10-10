// @vitest-environment jsdom
/**
 * The web sidebar at 840 and wider (`buildSpec.md` §3.2; slice 3): sticky and full height, New recipe FIRST, the three
 * destinations, a divider, the profile row (truncated, named "Profile, {name}"), and the collapse control on the foot
 * with `aria-expanded`. Collapsed it is the 80 px rail and every control keeps its name.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

import { RECIPE_HOME_WIDGET_CAPABILITY } from '@commise/features-recipes';

import { webMessages } from '@/i18n/messages';

import { HomeSidebar, type HomeSidebarProps } from '../HomeSidebar';

afterEach(cleanup);

const chrome = webMessages.en.home.chrome;

const renderSidebar = (overrides: Partial<HomeSidebarProps> = {}) =>
    render(
        <HomeSidebar
            chrome={chrome}
            locale="en"
            liveCapabilities={[RECIPE_HOME_WIDGET_CAPABILITY]}
            activeId="recipes"
            profile={{ status: 'ready', name: 'Eliza Montgomery-Hargreaves' }}
            collapsed={false}
            onToggleCollapse={() => undefined}
            newRecipe={<button type="button">New recipe</button>}
            {...overrides}
        />,
    );

describe('HomeSidebar (web)', () => {
    it('is sticky, full height and shown only from 840', () => {
        const { container } = renderSidebar();
        const root = container.firstElementChild;

        expect(root?.className).toContain('sticky');
        expect(root?.className).toContain('h-dvh');
        expect(root?.className).toContain('hidden');
        expect(root?.className).toContain('nav:flex');
    });

    it('puts New recipe FIRST, before the destinations', () => {
        renderSidebar();

        const newRecipe = screen.getByRole('button', { name: 'New recipe' });
        const nav = screen.getByRole('navigation', { name: chrome.primaryNavLabel });

        expect(newRecipe.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('lists Home, Recipes and Discover with the active one marked, and no "Soon" item', () => {
        renderSidebar();
        const nav = screen.getByRole('navigation', { name: chrome.primaryNavLabel });

        expect(
            within(nav)
                .getAllByRole('link')
                .map((link) => link.textContent),
        ).toEqual(['Home', 'Recipes', 'Discover']);
        expect(within(nav).getByRole('link', { name: 'Recipes' }).getAttribute('aria-current')).toBe('page');
        expect(within(nav).getByRole('link', { name: 'Recipes' }).querySelector('.bg-here-bar')).not.toBeNull();
        expect(nav.textContent).not.toMatch(/soon/i);
    });

    it('has a profile row to Profile, named "Profile, {name}", whose long name truncates', () => {
        renderSidebar();

        const row = screen.getByRole('link', { name: 'Profile, Eliza Montgomery-Hargreaves' });

        expect(row.getAttribute('href')).toBe('/en/profile');
        expect(within(row).getByText('Eliza Montgomery-Hargreaves').className).toContain('truncate');
        expect(row.textContent).toContain('EM');
    });

    it('names the profile row "Profile" and shows the glyph when there is no name', () => {
        renderSidebar({ profile: { status: 'ready', name: undefined } });

        const row = screen.getByRole('link', { name: 'Profile' });

        expect(row.querySelector('svg')).not.toBeNull();
    });

    it('shows a blank disc while the profile loads, and the glyph — no error — when it failed', () => {
        renderSidebar({ profile: { status: 'loading', name: undefined } });
        expect(screen.getByRole('link', { name: 'Profile' }).querySelector('svg')).toBeNull();
        cleanup();

        renderSidebar({ profile: { status: 'failed', name: undefined } });
        expect(screen.getByRole('link', { name: 'Profile' }).querySelector('svg')).not.toBeNull();
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('puts the collapse control on the foot, expanded: "Collapse" with aria-expanded true', () => {
        const onToggleCollapse = vi.fn();
        renderSidebar({ onToggleCollapse });

        const control = screen.getByRole('button', { name: 'Collapse' });
        fireEvent.click(control);

        expect(control.getAttribute('aria-expanded')).toBe('true');
        expect(onToggleCollapse).toHaveBeenCalledOnce();
    });

    it('collapsed: the 80 px rail, every control still named, "Expand sidebar" with aria-expanded false', () => {
        const { container } = renderSidebar({ collapsed: true });

        expect(container.firstElementChild?.className).toContain('w-20');
        expect(screen.getByRole('link', { name: 'Recipes' })).toBeTruthy();
        expect(screen.getByRole('link', { name: 'Profile, Eliza Montgomery-Hargreaves' }).textContent).toBe('EM');
        expect(screen.getByRole('button', { name: 'Expand sidebar' }).getAttribute('aria-expanded')).toBe('false');
    });
});
