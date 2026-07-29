// @vitest-environment jsdom
/**
 * Component tests for the mobile navigation drawer (US-000 / FR-046, B6/CR-003).
 *
 * The drawer is the fuller rendering of the SAME shared nav model the sidebar and the tab bar render, so the
 * behaviours pinned here are its own: it is absent from the DOM while closed; reachable destinations are
 * links; gated ones are non-interactive "coming soon" controls that never navigate; the active destination is
 * marked `aria-current` and stays legible over its gradient pill; activating a link closes the drawer; and
 * every Radix dismissal path lands on the one `onClose`. Selectors are role/label only (repo policy).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { RECIPE_HOME_WIDGET_CAPABILITY } from '@commise/features-recipes';
import { compositeOver, utilityContrast } from '@commise/test-utils';
import { palette } from '@commise/ui';

import { webMessages } from '@/i18n/messages';

import { HomeMobileNav } from '../HomeMobileNav';

afterEach(cleanup);

const chrome = webMessages.en.home.chrome;

/** Home v1 live capabilities: only the recipe service. Meal-plan/grocery/nutrition are gated. */
const LIVE = [RECIPE_HOME_WIDGET_CAPABILITY];

const renderDrawer = (overrides: Partial<Parameters<typeof HomeMobileNav>[0]> = {}): void => {
    render(
        <HomeMobileNav
            open
            onClose={vi.fn()}
            chrome={chrome}
            locale="en"
            liveCapabilities={LIVE}
            activeId="home"
            {...overrides}
        />,
    );
};

/**
 * Activate `element` with the anchor's default navigation suppressed. jsdom cannot navigate, so letting an
 * `<a href>`'s default run logs an "unimplemented navigation" error that is pure noise — the destination's
 * route is asserted from its `href` elsewhere; what these cases test is the handler the drawer attaches.
 *
 * @sideEffect Adds and removes a document-level `click` listener, and dispatches a click.
 */
async function activateWithoutNavigating(element: Element): Promise<void> {
    const suppressNavigation = (event: Event): void => event.preventDefault();

    document.addEventListener('click', suppressNavigation);

    try {
        await userEvent.setup().click(element);
    } finally {
        document.removeEventListener('click', suppressNavigation);
    }
}

describe('HomeMobileNav', () => {
    it('renders nothing while closed — the drawer is absent, not merely hidden', () => {
        renderDrawer({ open: false });

        expect(screen.queryByRole('link', { name: 'Recipes' })).toBeNull();
    });

    it('renders the reachable destinations as links with locale-prefixed routes', () => {
        renderDrawer();

        expect(screen.getByRole('link', { name: 'Home' }).getAttribute('href')).toBe('/en');
        expect(screen.getByRole('link', { name: 'Recipes' }).getAttribute('href')).toBe('/en/recipes');
        expect(screen.getByRole('link', { name: 'Profile' }).getAttribute('href')).toBe('/en/profile');
    });

    it('marks the active destination with aria-current', () => {
        renderDrawer({ activeId: 'recipes' });

        expect(screen.getByRole('link', { name: 'Recipes' }).getAttribute('aria-current')).toBe('page');
        expect(screen.getByRole('link', { name: 'Home' }).getAttribute('aria-current')).toBeNull();
    });

    it('keeps the ACTIVE destination’s label WCAG-AA legible over BOTH stops of its gradient pill', () => {
        renderDrawer({ activeId: 'home' });

        const active = screen.getByRole('link', { name: 'Home' });

        // Same treatment as the sidebar's active pill, and measured the same way: the background is an
        // arbitrary-value GRADIENT that no single `bg-*` utility describes, so each stop is composited over
        // the surface and measured on its own. Seafoam scored 3.49:1 on the darker 0.12 stop and 3.67:1 on
        // the 0.08 stop — both under the 4.5:1 body floor — and the class colours the visible label span,
        // which is text a reader reads. The gradient itself is a non-text accent and stays.
        expect(active.className, 'the measured stops must still be the ones the pill paints').toContain(
            'from-seafoam/[0.12] to-seafoam/[0.08]',
        );
        expect(
            utilityContrast(active.className, { surface: compositeOver(`${palette.seafoam}1f`, palette.white) }),
            'active drawer item over the 0.12 gradient stop',
        ).toBeGreaterThanOrEqual(4.5);
        expect(
            utilityContrast(active.className, { surface: compositeOver(`${palette.seafoam}14`, palette.white) }),
            'active drawer item over the 0.08 gradient stop',
        ).toBeGreaterThanOrEqual(4.5);
    });

    it('renders gated destinations as non-interactive "coming soon" controls, NOT links', () => {
        renderDrawer();

        for (const label of ['Meal Plan', 'Grocery', 'Nutrition']) {
            const control = screen.getByRole('link', { name: `${label}, ${chrome.comingSoonSuffix}` });

            expect(control.getAttribute('aria-disabled')).toBe('true');
            expect(control.getAttribute('href')).toBeNull();
        }
    });

    it('reveals a gated destination as a real link once its capability goes live', () => {
        renderDrawer({ liveCapabilities: [...LIVE, 'nutrition'] });

        expect(screen.queryByRole('link', { name: `Nutrition, ${chrome.comingSoonSuffix}` })).toBeNull();
        // A real, enabled link. Its route is still the locale root — `homeNavHref` has no nutrition surface to
        // point at yet — so reachability, not the href, is what going live changes here.
        expect(screen.getByRole('link', { name: 'Nutrition' }).getAttribute('aria-disabled')).toBeNull();
    });

    it('closes when a destination is activated, so the drawer never covers where it just navigated', async () => {
        const onClose = vi.fn();
        renderDrawer({ onClose });

        await activateWithoutNavigating(screen.getByRole('link', { name: 'Recipes' }));

        expect(onClose).toHaveBeenCalledOnce();
    });

    it('closes from the explicit close control', async () => {
        const onClose = vi.fn();
        renderDrawer({ onClose });

        await userEvent.setup().click(screen.getByRole('button', { name: chrome.closeNav }));

        expect(onClose).toHaveBeenCalledOnce();
    });

    it('routes Escape onto the SAME onClose the close control uses (one exit path, not two)', async () => {
        const onClose = vi.fn();
        renderDrawer({ onClose });

        await userEvent.setup().keyboard('{Escape}');

        expect(onClose).toHaveBeenCalledOnce();
    });
});

describe('HomeMobileNav — gated destination labels stay legible (#113)', () => {
    it('names a gated destination in an OPAQUE tone, not an alpha-dimmed one', () => {
        renderDrawer();

        // `text-slate/60` measures 2.41:1 once composited onto the surface: the TOKEN passes (slate is
        // 5.24:1 on white) and the rendered pixel does not, which is exactly why an alpha suffix on a text
        // colour is unauditable by inspection. These controls are deliberately focusable and announced (so a
        // user can discover what is coming), which is what puts them past SC 1.4.3's "inactive component"
        // exemption in spirit — and the NATIVE tab bar already resolved this to the opaque `palette.slate`,
        // carrying a comment saying so. The web half was never brought along.
        const gated = screen.getByRole('link', {
            name: `${chrome.destinations.nutrition}, ${chrome.comingSoonSuffix}`,
        });

        expect(utilityContrast(gated.className), 'gated destination label').toBeGreaterThanOrEqual(4.5);
    });
});
