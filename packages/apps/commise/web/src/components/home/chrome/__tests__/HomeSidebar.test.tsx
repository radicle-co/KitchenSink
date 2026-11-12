// @vitest-environment jsdom
/**
 * The web sidebar at 840 and wider (`buildSpec.md` §3.2; slice 3): sticky and full height; the profile row FIRST, in the
 * 64 px row the "Commise" wordmark used to hold (owner ruling 2026-11-11, N3; truncated, named "Profile, {name}", the
 * active style of a nav row on /profile); then New recipe, the three destinations and the collapse control on the foot
 * with `aria-expanded`. Collapsed it is the 80 px rail and every control keeps its name.
 *
 * Rewritten for the You tab (2026-11-11): the profile row used to sit after a divider near the foot and the wordmark
 * filled the first row, so the tests that pinned "New recipe first" and "the divider and foot row" now pin the new
 * order, and the wordmark and foot-row absences are asserted.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { homeMessages } from '@commise/features-core/home';
import { RECIPE_HOME_WIDGET_CAPABILITY } from '@commise/features-recipes';

import { webMessages } from '@/i18n/messages';

import { HomeSidebar, type HomeSidebarProps } from '../HomeSidebar';

afterEach(cleanup);

const chrome = { ...homeMessages.en.chrome, ...webMessages.en.home.chrome };

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

    it('puts the profile row FIRST, then New recipe, then the destinations', () => {
        renderSidebar();

        const profile = screen.getByRole('link', { name: 'Profile, Eliza Montgomery-Hargreaves' });
        const newRecipe = screen.getByRole('button', { name: 'New recipe' });
        const nav = screen.getByRole('navigation', { name: chrome.primaryNavLabel });

        expect(profile.compareDocumentPosition(newRecipe) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(newRecipe.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('is no longer headed by the wordmark, and has no profile row or divider at the foot', () => {
        const { container } = renderSidebar();

        expect(screen.queryByText('Commise')).toBeNull();
        expect(screen.getAllByRole('link', { name: /^Profile/u })).toHaveLength(1);
        expect(container.querySelector('.border-t')).toBeNull();
        expect(screen.getByRole('button', { name: 'Collapse' }).closest('.mt-auto')).not.toBeNull();
    });

    it('draws the profile row in the 64 px first row, a 32 px disc beside the name', () => {
        renderSidebar();

        const row = screen.getByRole('link', { name: 'Profile, Eliza Montgomery-Hargreaves' });

        expect(row.closest('.h-16')).not.toBeNull();
        expect(row.querySelector('.size-8')).not.toBeNull();
    });

    it('marks the profile row as the current page on /profile, in the style of an active nav row', () => {
        renderSidebar({ activeId: 'you' });

        const row = screen.getByRole('link', { name: 'Profile, Eliza Montgomery-Hargreaves' });

        expect(row.getAttribute('aria-current')).toBe('page');
        expect(row.className).toContain('bg-selected-fill');
        expect(row.querySelector('.bg-here-bar')).not.toBeNull();
        expect(
            within(screen.getByRole('navigation', { name: chrome.primaryNavLabel }))
                .getAllByRole('link')
                .every((link) => link.getAttribute('aria-current') === null),
        ).toBe(true);
    });

    it('leaves the profile row unmarked on any other page, and keeps You out of the destination list', () => {
        renderSidebar({ activeId: 'recipes' });

        expect(
            screen.getByRole('link', { name: 'Profile, Eliza Montgomery-Hargreaves' }).getAttribute('aria-current'),
        ).toBeNull();
        expect(within(screen.getByRole('navigation', { name: chrome.primaryNavLabel })).queryByText('You')).toBeNull();
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

    // Steel is an accent, never a large fill (redesign): the active row is a wide selected area, so it takes the
    // selected-fill wash, not a tint of the action colour.
    it('paints the active row with the selected fill, never the action colour', () => {
        renderSidebar();
        const active = within(screen.getByRole('navigation', { name: chrome.primaryNavLabel })).getByRole('link', {
            name: 'Recipes',
        });

        expect(active.className).toContain('bg-selected-fill');
        expect(active.className).not.toMatch(/bg-action/u);
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
        expect(screen.queryByText('Commise')).toBeNull();
        expect(screen.getByRole('button', { name: 'Expand sidebar' }).getAttribute('aria-expanded')).toBe('false');
    });

    // W-02: the rail clips anything past its 80 px, so a visual label for an icon-only row has to be drawn in a portal.
    // Every collapsed control already has its name; the tooltip is the sighted cook's label for it (SC 1.4.13).
    describe('the collapsed rail’s tooltips', () => {
        /** The portalled tip, which lives on `document.body`. */
        const tip = (): HTMLElement | null => document.body.querySelector('[data-tooltip]');

        it.each([
            ['a destination', () => screen.getByRole('link', { name: 'Recipes' }), 'Recipes'],
            [
                'the profile row',
                () => screen.getByRole('link', { name: 'Profile, Eliza Montgomery-Hargreaves' }),
                'Profile, Eliza Montgomery-Hargreaves',
            ],
            ['the expand control', () => screen.getByRole('button', { name: 'Expand sidebar' }), 'Expand sidebar'],
        ])('labels %s on hover, outside the rail', async (_what, control, words) => {
            const user = userEvent.setup();
            const { container } = renderSidebar({ collapsed: true });

            await user.hover(control());

            expect(tip()?.textContent).toBe(words);
            expect(container.contains(tip())).toBe(false);
        });

        // jsdom's `:focus-visible` is true for a button and false for a link, which a browser answers true for both, so
        // the keyboard path is exercised on the foot control (reached by shift-tabbing from the page onto the last stop).
        it('labels a control on keyboard focus too', async () => {
            const user = userEvent.setup();
            renderSidebar({ collapsed: true });

            await user.tab({ shift: true });

            expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Expand sidebar' }));
            expect(tip()?.textContent).toBe('Expand sidebar');
        });

        it('draws none while expanded, where every row shows its own words', async () => {
            const user = userEvent.setup();
            renderSidebar({ collapsed: false });

            await user.hover(screen.getByRole('link', { name: 'Recipes' }));

            expect(tip()).toBeNull();
        });

        it('keeps the expand control on the foot of the rail and the destinations full width', () => {
            renderSidebar({ collapsed: true });

            const expand = screen.getByRole('button', { name: 'Expand sidebar' });
            const nav = screen.getByRole('navigation', { name: chrome.primaryNavLabel });

            expect(expand.closest('.mt-auto')).not.toBeNull();
            expect(within(nav).getByRole('link', { name: 'Recipes' }).parentElement?.className).toContain('block');
        });
    });
});
