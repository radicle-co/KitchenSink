// @vitest-environment jsdom
/**
 * Component tests for the web recipe-SOURCE switcher (L5) — the shared strip both recipe-source surfaces
 * mount. It covers the two owner-reported defects directly:
 *
 *  1. **The inactive tab did not look like a control.** It was `border-transparent text-slate
 *     hover:text-charcoal`: no box, no fill, and a hover-only signal that does not exist on touch. The
 *     affordance block below measures the RESTING pair (label + boundary) and the hover pair, so a future edit
 *     that removes the fill or the hairline — or re-themes either token under its floor — fails here rather
 *     than on a phone.
 *  2. **Link semantics.** Each source is a route, so each tab is an `<a>` with a real `href` and the active one
 *     carries `aria-current="page"`. Asserting the ROLE is what pins that: a `<button onClick={router.push}>`
 *     cannot satisfy `getByRole('link')`, and `role="tab"` without a tabpanel cannot either.
 *
 * Contrast is measured with `utilityContrast` against the ACTUAL rendered class list, alpha-composited, per
 * variant — never by asserting a class spelling, which passes just as happily after a re-theme.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';

import { contrastRatio, utilityContrast } from '@commise/test-utils';
import { palette, semantic } from '@commise/ui';

import { RecipeSourceTabs } from '../RecipeSourceTabs.js';
import type { RecipeListTabControl } from '../model.js';

afterEach(cleanup);

const HREF = { mine: '/en/recipes', community: '/en/discover' } as const;

function renderTabs(overrides: Partial<RecipeListTabControl> = {}) {
    const tab: RecipeListTabControl = { active: 'mine', href: HREF, ...overrides };
    render(<RecipeSourceTabs tab={tab} />);

    return tab;
}

describe('RecipeSourceTabs (web) — navigation semantics', () => {
    it('renders both sources as real links inside a labelled nav', () => {
        renderTabs();

        const nav = screen.getByRole('navigation', { name: 'Recipe source' });
        const links = within(nav).getAllByRole('link');

        expect(links.map((link) => link.textContent)).toEqual(['My Recipes', 'Community']);
        expect(within(nav).getByRole('link', { name: 'My Recipes' }).getAttribute('href')).toBe('/en/recipes');
        expect(within(nav).getByRole('link', { name: 'Community' }).getAttribute('href')).toBe('/en/discover');
    });

    it('marks the active source with aria-current="page" and leaves the other unmarked', () => {
        renderTabs({ active: 'community' });

        expect(screen.getByRole('link', { name: 'Community' }).getAttribute('aria-current')).toBe('page');
        expect(screen.getByRole('link', { name: 'My Recipes' }).getAttribute('aria-current')).toBeNull();
    });

    it('does NOT announce itself as an in-page tab set (no tab/tablist, no aria-selected)', () => {
        // The ARIA tab pattern describes layered panels within one document. These controls REPLACE the
        // document, so `role="tab"` would be a lie — and it is what cost the strip its link semantics.
        renderTabs();

        expect(screen.queryByRole('tablist')).toBeNull();
        expect(screen.queryAllByRole('tab')).toHaveLength(0);
        expect(screen.getByRole('link', { name: 'Community' }).getAttribute('aria-selected')).toBeNull();
    });

    it('navigates by href alone — it never needs the control’s onChange', async () => {
        // Web's switcher is a link, so a container that supplies no `onChange` (the discovery + list
        // containers do not) must still be fully navigable. Nothing to call, nothing to forget.
        const onChange = vi.fn();
        renderTabs({ onChange });

        const community = screen.getByRole('link', { name: 'Community' });
        community.addEventListener('click', (event) => event.preventDefault());
        community.click();

        expect(onChange).not.toHaveBeenCalled();
        expect(community.getAttribute('href')).toBe('/en/discover');
    });
});

describe('RecipeSourceTabs (web) — the INACTIVE tab’s resting affordance (WCAG 2.1 AA)', () => {
    it('paints a resting fill and boundary, so the control is visible without a pointer', () => {
        renderTabs({ active: 'mine' });
        const inactive = screen.getByRole('link', { name: 'Community' });

        // The label is body-grade text on the tab's own fill: 4.5:1 (SC 1.4.3).
        expect(
            utilityContrast(inactive.className, { surface: semantic.background }),
            'inactive source-tab label on its resting fill',
        ).toBeGreaterThanOrEqual(4.5);
        // The hairline is the BOUNDARY that makes it perceivable as a control at all, so it owes the 3:1
        // SC 1.4.11 floor against that fill. `mist` — the instinctive choice — is 1.87:1 and fails.
        expect(
            utilityContrast(inactive.className, { surface: semantic.background, foreground: 'border' }),
            'inactive source-tab boundary against its own fill',
        ).toBeGreaterThanOrEqual(3);
    });

    it('keeps both floors in the HOVER state (a tint that passes at rest can fail on hover)', () => {
        renderTabs({ active: 'mine' });
        const inactive = screen.getByRole('link', { name: 'Community' });

        // `hover:bg-*` REPLACES the resting fill rather than stacking on it, so the hover tint is composited
        // over the PAGE — measured exactly as a reader experiences it.
        expect(
            utilityContrast(inactive.className, { surface: semantic.background, variant: 'hover' }),
            'inactive source-tab label on its hover fill',
        ).toBeGreaterThanOrEqual(4.5);
        expect(
            utilityContrast(inactive.className, {
                surface: semantic.background,
                variant: 'hover',
                foreground: 'border',
            }),
            'inactive source-tab boundary on its hover fill',
        ).toBeGreaterThanOrEqual(3);
    });

    it('does not rest on a transparent border (the defect, stated as an assertion)', () => {
        renderTabs({ active: 'mine' });

        expect(screen.getByRole('link', { name: 'Community' }).className).not.toContain('border-transparent');
    });

    it('keeps a keyboard-focus indicator that clears the 3:1 non-text floor', () => {
        renderTabs({ active: 'mine' });
        const inactive = screen.getByRole('link', { name: 'Community' });

        // The ring token is read off the rendered class list and then measured through the palette, so both
        // halves stay load-bearing: change the class and the lookup moves, re-theme the token and the ratio
        // moves. `seafoam-light` — the DS default elsewhere — is 2.78:1 on white and would fail this.
        expect(inactive.className).toContain('focus-visible:ring-ocean-dark');
        expect(
            contrastRatio(palette['ocean-dark'], semantic.background),
            'focus ring against the page',
        ).toBeGreaterThanOrEqual(3);
    });
});

describe('RecipeSourceTabs (web) — the ACTIVE tab', () => {
    it('keeps the seafoam underline with a legible ocean-dark label (the palette rule)', () => {
        renderTabs({ active: 'mine' });
        const active = screen.getByRole('link', { name: 'My Recipes' });

        expect(
            utilityContrast(active.className, { surface: semantic.background }),
            'active source-tab label',
        ).toBeGreaterThanOrEqual(4.5);
        // The 2px seafoam indicator is a non-text graphic on the 3:1 floor, and it is what reads as "selected".
        expect(active.className, 'the seafoam selection underline must survive').toContain('border-seafoam');
        expect(
            utilityContrast(active.className, { surface: semantic.background, foreground: 'border' }),
            'active source-tab underline',
        ).toBeGreaterThanOrEqual(3);
    });
});

describe('RecipeSourceTabs (web) — touch targets', () => {
    it('gives every source tab the 44px touch floor, reset for the mouse at md', () => {
        renderTabs();

        for (const name of ['My Recipes', 'Community']) {
            const tab = screen.getByRole('link', { name });
            expect(tab.className).toContain('min-h-11');
            expect(tab.className).toContain('md:min-h-0');
        }
    });
});
