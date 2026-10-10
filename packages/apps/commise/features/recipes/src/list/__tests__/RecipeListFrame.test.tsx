// @vitest-environment jsdom
/**
 * The web My recipes FRAME — the chrome outside the list's suspense boundary (`docs/design/uiOverhaul/buildSpec.md`
 * §4.3): the heading, the My recipes · Collections segments and the design-system search field, so a pending or failed
 * read never unmounts the field a cook is typing in.
 *
 * ⚠️ REWRITTEN for slice 4 of the UI overhaul. The My Recipes / Community source switcher is replaced by the route
 * segments (Discover is its own destination now), the hand-built search input by `SearchField` (whose contrast and
 * focus ring its own tests pin), and the field hides on the first run. The heading's focus-on-recovery is kept.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

import { LocaleProvider } from '@commise/i18n/react';

import { RecipeListFrame } from '../RecipeListFrame.js';
import type { RecipeListFrameProps } from '../model.js';

afterEach(cleanup);

const noop = () => undefined;
const HREF = { mine: '/en/recipes', collections: '/en/collections' } as const;

function frame(overrides: Partial<RecipeListFrameProps> = {}) {
    return (
        <LocaleProvider locale="en">
            <RecipeListFrame searchValue="" onSearchChange={noop} searchVisible headingFocusSignal={0} {...overrides}>
                {overrides.children ?? <p>boundary content</p>}
            </RecipeListFrame>
        </LocaleProvider>
    );
}

describe('RecipeListFrame (web)', () => {
    it('renders the heading, the search field and the boundary under it', () => {
        render(frame());

        expect(screen.getByRole('heading', { level: 1, name: 'Recipes' })).toBeTruthy();
        expect(screen.getByRole('searchbox', { name: 'Search your recipes' })).toBeTruthy();
        expect(screen.getByText('boundary content')).toBeTruthy();
    });

    it('reports each edit, and clearing returns an empty query', () => {
        const onSearchChange = vi.fn();
        const { rerender } = render(frame({ onSearchChange }));

        fireEvent.change(screen.getByRole('searchbox', { name: 'Search your recipes' }), {
            target: { value: 'lamb' },
        });
        expect(onSearchChange).toHaveBeenLastCalledWith('lamb');

        rerender(frame({ onSearchChange, searchValue: 'lamb' }));
        fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));

        expect(onSearchChange).toHaveBeenLastCalledWith('');
    });

    it('hides the search field when the host says so (the first run), keeping the boundary', () => {
        render(frame({ searchVisible: false }));

        expect(screen.queryByRole('searchbox')).toBeNull();
        expect(screen.getByText('boundary content')).toBeTruthy();
    });

    it('keeps the search field sticky at the top while the list scrolls on a narrow container', () => {
        render(frame());
        const field = screen.getByRole('searchbox', { name: 'Search your recipes' });
        const sticky = field.closest('[data-sticky-search]');

        expect(sticky?.className).toContain('sticky');
        expect(sticky?.className).toContain('bg-canvas');
    });

    it('renders no segments without a segments control', () => {
        render(frame());

        expect(screen.queryByRole('navigation', { name: 'Recipes' })).toBeNull();
    });

    it('renders My recipes · Collections as route segments, the current one marked, a plain click handed over', () => {
        const onSelect = vi.fn();
        render(frame({ segments: { current: 'mine', href: HREF, onSelect } }));
        const nav = screen.getByRole('navigation', { name: 'Recipes' });
        const mine = within(nav).getByRole('link', { name: 'My recipes' });
        const collections = within(nav).getByRole('link', { name: 'Collections' });

        expect(mine.getAttribute('aria-current')).toBe('page');
        expect(collections.getAttribute('href')).toBe('/en/collections');

        fireEvent.click(collections, { button: 0 });

        expect(onSelect).toHaveBeenCalledWith('collections');
    });

    it('⛔ moves focus to the heading when the recovery signal advances, and not on mount', () => {
        const { rerender } = render(frame());

        expect(document.activeElement).not.toBe(screen.getByRole('heading', { name: 'Recipes' }));

        rerender(frame({ headingFocusSignal: 1 }));

        expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Recipes' }));
    });
});
