// @vitest-environment jsdom
/**
 * Component tests for the desktop Home sidebar (US-000 / FR-046 / FR-044).
 *
 * The load-bearing behaviours: it renders the shared six-destination nav model; reachable destinations are
 * links, gated ones are NON-interactive "coming soon" controls (never dead links to a 404); the active
 * destination is marked `aria-current`; and collapsing hides labels visually WITHOUT stripping accessible
 * names. Selectors are role/label only (repo policy).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';

import { RECIPE_HOME_WIDGET_CAPABILITY } from '@commise/features-recipes';
import { compositeOver, utilityContrast } from '@commise/test-utils';
import { palette } from '@commise/ui';

import { webMessages } from '@/i18n/messages';

import { HomeSidebar } from '../HomeSidebar';

afterEach(cleanup);

const chrome = webMessages.en.home.chrome;

/** Home v1 live capabilities: only the recipe service. Meal-plan/grocery/nutrition are gated. */
const LIVE = [RECIPE_HOME_WIDGET_CAPABILITY];

const renderSidebar = (overrides: Partial<Parameters<typeof HomeSidebar>[0]> = {}): void => {
    render(
        <HomeSidebar
            chrome={chrome}
            locale="en"
            liveCapabilities={LIVE}
            activeId="home"
            collapsed={false}
            onToggleCollapse={vi.fn()}
            {...overrides}
        />,
    );
};

describe('HomeSidebar', () => {
    it('exposes a primary navigation landmark', () => {
        renderSidebar();

        expect(screen.getByRole('navigation', { name: chrome.primaryNavLabel })).toBeTruthy();
    });

    it('renders the reachable destinations as links with locale-prefixed routes', () => {
        renderSidebar();

        expect(screen.getByRole('link', { name: 'Home' }).getAttribute('href')).toBe('/en');
        expect(screen.getByRole('link', { name: 'Recipes' }).getAttribute('href')).toBe('/en/recipes');
        expect(screen.getByRole('link', { name: 'Profile' }).getAttribute('href')).toBe('/en/profile');
    });

    it('marks the active destination with aria-current', () => {
        renderSidebar({ activeId: 'home' });

        expect(screen.getByRole('link', { name: 'Home' }).getAttribute('aria-current')).toBe('page');
    });

    it('keeps the ACTIVE destination’s label WCAG-AA legible over BOTH stops of its gradient pill', () => {
        renderSidebar({ activeId: 'home' });

        const active = screen.getByRole('link', { name: 'Home' });

        // The active pill's background is an arbitrary-value GRADIENT, which is not one `bg-*` utility a class
        // reader can resolve — so it is measured STOP BY STOP, each stop composited over the surface, and both
        // asserted (the darker 0.12 end is the worse case at 3.49:1, the 0.08 end 3.67:1 — both under the
        // 4.5:1 body floor for seafoam). The class colours the icon AND the visible label span, and the label
        // is text a reader reads, so it takes `ocean-dark`; the `border-seafoam` rail and the gradient itself
        // are non-text accents and stay (see the palette JSDoc in `@commise/ui`).
        expect(active.className, 'the measured stops must still be the ones the pill paints').toContain(
            'from-seafoam/[0.12] to-seafoam/[0.08]',
        );
        expect(
            utilityContrast(active.className, { surface: compositeOver(`${palette.seafoam}1f`, palette.white) }),
            'active nav item over the 0.12 gradient stop',
        ).toBeGreaterThanOrEqual(4.5);
        expect(
            utilityContrast(active.className, { surface: compositeOver(`${palette.seafoam}14`, palette.white) }),
            'active nav item over the 0.08 gradient stop',
        ).toBeGreaterThanOrEqual(4.5);
    });

    it('renders gated destinations as non-interactive "coming soon" controls, NOT links', () => {
        renderSidebar();

        for (const label of ['Meal Plan', 'Grocery', 'Nutrition']) {
            const control = screen.getByRole('button', { name: `${label}, ${chrome.comingSoonSuffix}` });

            // Announced as disabled, and crucially NOT a link — a gated destination must never navigate.
            expect(control.getAttribute('aria-disabled')).toBe('true');
            expect(screen.queryByRole('link', { name: label })).toBeNull();
        }
    });

    it('reveals a gated destination as a real link once its capability goes live', () => {
        // The same fact (capability liveness) that lights up the widget must light up the nav — so adding the
        // capability turns the "coming soon" control into a link, with no separate edit.
        renderSidebar({ liveCapabilities: [...LIVE, 'nutrition'] });

        expect(screen.queryByRole('button', { name: `Nutrition, ${chrome.comingSoonSuffix}` })).toBeNull();
        expect(screen.getByRole('link', { name: 'Nutrition' })).toBeTruthy();
    });

    it('labels the collapse control by its current action, and keeps link names when collapsed', () => {
        const { rerender } = render(
            <HomeSidebar
                chrome={chrome}
                locale="en"
                liveCapabilities={LIVE}
                activeId="home"
                collapsed={false}
                onToggleCollapse={vi.fn()}
            />,
        );

        expect(screen.getByRole('button', { name: chrome.collapseNav })).toBeTruthy();

        rerender(
            <HomeSidebar
                chrome={chrome}
                locale="en"
                liveCapabilities={LIVE}
                activeId="home"
                collapsed
                onToggleCollapse={vi.fn()}
            />,
        );

        // Collapsed: the control now offers to EXPAND, and the links keep their accessible names even though
        // the visible label text is gone (icon-only rail must still be navigable by screen reader).
        expect(screen.getByRole('button', { name: chrome.expandNav })).toBeTruthy();
        expect(screen.getByRole('link', { name: 'Recipes' })).toBeTruthy();
    });

    it('toggles collapse when the control is activated', async () => {
        const { default: userEvent } = await import('@testing-library/user-event');
        const onToggleCollapse = vi.fn();
        renderSidebar({ onToggleCollapse });

        await userEvent.setup().click(screen.getByRole('button', { name: chrome.collapseNav }));

        expect(onToggleCollapse).toHaveBeenCalledOnce();
    });
});

describe('HomeSidebar — no fabricated notification counts', () => {
    it('renders no numeric badge anywhere in the rail', () => {
        renderSidebar();

        // The mockup shows a fake "3" on Meal Plan; v1 has no such feed, so no digit may appear in the nav.
        expect(within(screen.getByRole('navigation', { name: chrome.primaryNavLabel })).queryByText(/\d/u)).toBeNull();
    });
});

describe('HomeSidebar — gated destination labels stay legible (#113)', () => {
    it('names a gated destination in an OPAQUE tone, not an alpha-dimmed one', () => {
        renderSidebar();

        // `text-slate/60` measures 2.41:1 once composited onto the surface: the TOKEN passes (slate is
        // 5.24:1 on white) and the rendered pixel does not, which is exactly why an alpha suffix on a text
        // colour is unauditable by inspection. These controls are deliberately focusable and announced (so a
        // user can discover what is coming), which is what puts them past SC 1.4.3's "inactive component"
        // exemption in spirit — and the NATIVE tab bar already resolved this to the opaque `palette.slate`,
        // carrying a comment saying so. The web half was never brought along.
        const gated = screen.getByRole('button', {
            name: `${chrome.destinations.nutrition}, ${chrome.comingSoonSuffix}`,
        });

        expect(utilityContrast(gated.className), 'gated destination label').toBeGreaterThanOrEqual(4.5);
    });
});
