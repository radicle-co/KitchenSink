/**
 * Native component tests for the recipe-SOURCE switcher (L5), rendered via react-native-web under jsdom —
 * the mirror of `RecipeSourceTabs.test.tsx`, so the two platforms cannot drift on the switcher.
 *
 * The affordance block is the native half of the owner-reported defect: an unselected tab used to be a
 * transparent border over no fill, i.e. bare text. Touch has NO hover, so the web leaf's hover-only signal was
 * never available here at all — the resting fill and hairline are the only thing a thumb can see, and both are
 * measured (label against the fill for the 4.5:1 SC 1.4.3 text floor, the hairline against that same fill for
 * the 3:1 SC 1.4.11 boundary floor) off what the leaf ACTUALLY rendered.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

import { compositeOver, computedContrast, contrastRatio } from '@commise/test-utils';
import { palette } from '@commise/ui';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { RecipeSourceTabs } from '../RecipeSourceTabs.native.js';
import type { RecipeListTabControl } from '../model.js';

afterEach(cleanup);

const HREF = { mine: '/en/recipes', community: '/en/discover' } as const;

function renderTabs(overrides: Partial<RecipeListTabControl> = {}) {
    const tab: RecipeListTabControl = { active: 'mine', href: HREF, onChange: () => undefined, ...overrides };
    render(<RecipeSourceTabs tab={tab} />);

    return tab;
}

/** The opaque colour a tab's own fill resolves to, read off the DOM and flattened onto the screen. */
function fillOf(tab: Element): string {
    return compositeOver(window.getComputedStyle(tab).backgroundColor, palette.sand);
}

describe('RecipeSourceTabs (native) — semantics', () => {
    it('renders both sources as tabs in a labelled tablist, the active one selected', () => {
        renderTabs({ active: 'community' });

        const tablist = screen.getByLabelText('Recipe source');
        expect(within(tablist).getAllByRole('tab')).toHaveLength(2);
        // Native has no URL, no address bar and no new tab: the platform trait for a top-level destination
        // switcher IS the tab trait (see the leaf's JSDoc for why web is a link instead).
        expect(screen.getByRole('tab', { name: 'Community' }).getAttribute('aria-selected')).toBe('true');
        expect(screen.getByRole('tab', { name: 'My Recipes' }).getAttribute('aria-selected')).not.toBe('true');
    });

    it('reports the chosen source upward', () => {
        const onChange = vi.fn();
        renderTabs({ active: 'community', onChange });

        fireEvent.click(screen.getByRole('tab', { name: 'My Recipes' }));

        expect(onChange).toHaveBeenCalledWith('mine');
    });

    it('offers BOTH sources while community is active, so the surface is never a one-way trip', () => {
        renderTabs({ active: 'community' });

        expect(screen.getByRole('tab', { name: 'My Recipes' })).toBeTruthy();
        expect(screen.getByRole('tab', { name: 'Community' })).toBeTruthy();
    });
});

describe('RecipeSourceTabs (native) — the INACTIVE tab’s resting affordance (WCAG 2.1 AA)', () => {
    it('rests on a real fill whose label clears the 4.5:1 text floor', () => {
        renderTabs({ active: 'mine' });
        const inactive = screen.getByRole('tab', { name: 'Community' });

        // A transparent tab (the defect) composites to the bare screen background — this measures the fill the
        // leaf really painted, so removing it changes the number.
        expect(window.getComputedStyle(inactive).backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
        expect(
            computedContrast(within(inactive).getByText('Community'), { surface: fillOf(inactive) }),
            'inactive source-tab label on its resting fill',
        ).toBeGreaterThanOrEqual(4.5);
    });

    it('rests on a visible boundary that clears the 3:1 non-text floor', () => {
        renderTabs({ active: 'mine' });
        const inactive = screen.getByRole('tab', { name: 'Community' });
        const style = window.getComputedStyle(inactive);

        // The hairline is what makes the control perceivable AS a control on a touch device. `transparent`
        // (the defect) and `mist` (1.87:1, the instinctive choice) both fail this.
        expect(Number.parseFloat(style.borderBottomWidth)).toBeGreaterThan(0);
        expect(
            contrastRatio(compositeOver(style.borderBottomColor, fillOf(inactive)), fillOf(inactive)),
            'inactive source-tab boundary against its own fill',
        ).toBeGreaterThanOrEqual(3);
    });
});

describe('RecipeSourceTabs (native) — the ACTIVE tab', () => {
    it('keeps the seafoam underline with a legible ocean-dark label (the palette rule)', () => {
        renderTabs({ active: 'mine' });
        const active = screen.getByRole('tab', { name: 'My Recipes' });
        const style = window.getComputedStyle(active);

        expect(
            computedContrast(within(active).getByText('My Recipes'), { surface: fillOf(active) }),
            'active source-tab label',
        ).toBeGreaterThanOrEqual(4.5);
        // The 2px seafoam indicator is a non-text graphic on the 3:1 floor, and it is what reads as selected.
        expect(
            contrastRatio(compositeOver(style.borderBottomColor, fillOf(active)), fillOf(active)),
            'active source-tab underline',
        ).toBeGreaterThanOrEqual(3);
        expect(style.borderBottomColor, 'the seafoam selection underline must survive').toBe('rgb(61, 139, 133)');
    });
});

describe('RecipeSourceTabs (native) — touch targets (RC-3)', () => {
    it('gives every source tab the 44pt minimum hit area', () => {
        renderTabs();

        for (const tab of screen.getAllByRole('tab')) {
            expect(window.getComputedStyle(tab).minHeight).toBe('44px');
        }
    });
});
