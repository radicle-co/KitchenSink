/**
 * Native component tests for the public-discovery view (T076), rendered via react-native-web under jsdom.
 * Mirrors the web leaf across EVERY state — loading, error, empty, populated — plus the search chrome, the
 * interaction contracts (search change, select, clone, per-row clone-busy, retry), and attribution, so the
 * two platform renders cannot drift.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { RecipeSearchSortBy, type Recipe, type RecipeSearchResult } from '@kitchensink/recipe-core';

import { makeRecipe } from '../../__fixtures__/index.js';
// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { RecipeDiscoveryList } from '../RecipeDiscoveryList.native.js';
import type { RecipeDiscoveryListProps } from '../model.js';

afterEach(cleanup);

const noop = () => undefined;

/** Inline factory: wrap a {@link Recipe} in a search-result envelope, with an optional relevance rank. */
function makeSearchResult(recipe: Partial<Recipe> = {}, rank?: number): RecipeSearchResult {
    return rank === undefined ? { recipe: makeRecipe(recipe) } : { recipe: makeRecipe(recipe), rank };
}

function renderDiscovery(overrides: Partial<RecipeDiscoveryListProps> = {}) {
    const props: RecipeDiscoveryListProps = {
        status: 'ready',
        results: [],
        searchValue: '',
        onSearchChange: noop,
        onSelectRecipe: noop,
        onClone: noop,
        onRetry: noop,
        ...overrides,
    };
    render(<RecipeDiscoveryList {...props} />);

    return props;
}

const threeResults = [
    makeSearchResult({ id: 'rec_1', title: 'Mediterranean Grilled Lamb', sourceAttribution: 'Serious Eats' }),
    makeSearchResult({ id: 'rec_2', title: 'Asparagus with Green Sauce' }),
    makeSearchResult({ id: 'rec_3', title: 'Gourmet Garden Salad', sourceAttribution: 'Bon Appétit' }),
];

describe('RecipeDiscoveryList (native) — chrome', () => {
    it('always renders the heading and search field', () => {
        renderDiscovery({ status: 'loading' });

        expect(screen.getByRole('heading', { name: 'Discover recipes' })).toBeTruthy();
        expect(screen.getByLabelText('Search public recipes')).toBeTruthy();
    });

    it('reports search input changes upward', () => {
        const onSearchChange = vi.fn();
        renderDiscovery({ onSearchChange });

        fireEvent.change(screen.getByLabelText('Search public recipes'), { target: { value: 'lamb' } });

        expect(onSearchChange).toHaveBeenCalledWith('lamb');
    });
});

describe('RecipeDiscoveryList (native) — loading state', () => {
    it('shows the loading label and no recipe rows', () => {
        renderDiscovery({ status: 'loading' });

        expect(screen.getByLabelText('Loading recipes')).toBeTruthy();
        expect(screen.queryByRole('button', { name: /Grilled Lamb/ })).toBeNull();
    });
});

describe('RecipeDiscoveryList (native) — error state', () => {
    it('shows an alert with a retry action that reports upward', () => {
        const onRetry = vi.fn();
        renderDiscovery({ status: 'error', onRetry });

        expect(screen.getByRole('alert')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        expect(onRetry).toHaveBeenCalledTimes(1);
    });
});

describe('RecipeDiscoveryList (native) — empty state', () => {
    it('shows the empty message when a successful search returns nothing', () => {
        renderDiscovery({ status: 'ready', results: [] });

        expect(screen.getByText('No recipes found')).toBeTruthy();
    });
});

describe('RecipeDiscoveryList (native) — no-match state', () => {
    it('shows the no-match copy (NOT the browse-empty copy) when a search matched nothing', () => {
        renderDiscovery({ status: 'ready', results: [], searchValue: 'tiramisu' });

        expect(screen.getByText('No matching recipes')).toBeTruthy();
        expect(screen.queryByText('No recipes found')).toBeNull();
    });

    it('shows the no-match copy when only a filter (no term) matched nothing', () => {
        renderDiscovery({ status: 'ready', results: [], searchValue: '', hasActiveFilters: true });

        expect(screen.getByText('No matching recipes')).toBeTruthy();
        expect(screen.queryByText('No recipes found')).toBeNull();
    });
});

describe('RecipeDiscoveryList (native) — populated state', () => {
    it('renders a pluralized result count when browsing (no query)', () => {
        renderDiscovery({ status: 'ready', results: threeResults });

        expect(screen.getByText('3 recipes')).toBeTruthy();
    });

    it('echoes the active query in the results header (S5)', () => {
        renderDiscovery({ status: 'ready', results: threeResults, searchValue: 'pasta' });

        expect(screen.getByText('Showing 3 recipes for “pasta”')).toBeTruthy();
    });

    it('composes the compound card fields — author handle, cuisine, calories (S1)', () => {
        renderDiscovery({
            status: 'ready',
            results: [
                makeSearchResult({
                    id: 'rec_x',
                    title: 'Ribollita',
                    authorHandle: 'tuscan_cook',
                    cuisine: 'Tuscan',
                    leadCaloriesPerServing: 320,
                }),
            ],
        });

        expect(screen.getByText('by @tuscan_cook')).toBeTruthy();
        expect(screen.getByText('Tuscan')).toBeTruthy();
        expect(screen.getByText('320 cal')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Ribollita' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Clone Ribollita' })).toBeTruthy();
    });

    it('renders a Load more button that fetches the next page, hidden on the last page (S4)', () => {
        const onLoadMore = vi.fn();
        renderDiscovery({
            status: 'ready',
            results: threeResults,
            loadMore: { hasMore: true, loading: false, onLoadMore },
        });

        fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
        expect(onLoadMore).toHaveBeenCalledTimes(1);
        cleanup();

        renderDiscovery({
            status: 'ready',
            results: threeResults,
            loadMore: { hasMore: false, loading: false, onLoadMore: vi.fn() },
        });
        expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
    });

    it('renders the sort options and reports a change (S3)', () => {
        const onChange = vi.fn();
        renderDiscovery({
            status: 'ready',
            results: threeResults,
            sort: { active: RecipeSearchSortBy.RELEVANCE, onChange },
        });

        expect(screen.getByText('Relevance')).toBeTruthy();
        fireEvent.click(screen.getByText('Quickest'));

        expect(onChange).toHaveBeenCalledWith('quickest');
    });

    it('renders one row per result and reports selection upward', () => {
        const onSelectRecipe = vi.fn();
        renderDiscovery({ status: 'ready', results: threeResults, onSelectRecipe });

        expect(screen.getByRole('button', { name: 'Mediterranean Grilled Lamb' })).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Asparagus with Green Sauce' }));
        expect(onSelectRecipe).toHaveBeenCalledWith('rec_2');
    });

    it('renders source attribution only when present', () => {
        renderDiscovery({ status: 'ready', results: threeResults });

        expect(screen.getByText('From Serious Eats')).toBeTruthy();
        expect(screen.getByText('From Bon Appétit')).toBeTruthy();
        expect(screen.queryByText(/From undefined/)).toBeNull();
    });
});

describe('RecipeDiscoveryList (native) — loading skeleton (U7)', () => {
    it('renders skeleton cards (not a blank view) while loading', () => {
        renderDiscovery({ status: 'loading' });

        // The loading region is still labelled for assistive tech, but now carries inert skeleton cards.
        const region = screen.getByLabelText('Loading recipes');
        expect(region.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThan(0);
    });
});

describe('RecipeDiscoveryList (native) — browse slot (U7)', () => {
    it('renders the browse slot (not a bare search) when no query/filter is active', () => {
        renderDiscovery({ status: 'ready', results: [], searchValue: '', browseSlot: <>{'CURATED RAILS'}</> });

        expect(screen.getByText('CURATED RAILS')).toBeTruthy();
        expect(screen.queryByText('No recipes found')).toBeNull();
    });

    it('shows the result list once a query is active', () => {
        renderDiscovery({
            status: 'ready',
            results: threeResults,
            searchValue: 'lamb',
            browseSlot: <>{'CURATED RAILS'}</>,
        });

        expect(screen.queryByText('CURATED RAILS')).toBeNull();
        expect(screen.getByRole('button', { name: 'Mediterranean Grilled Lamb' })).toBeTruthy();
    });
});

describe('RecipeDiscoveryList (native) — compact grid (U7)', () => {
    it('lays the result cards out in a grid of one cell per result', () => {
        renderDiscovery({ status: 'ready', results: threeResults });

        // The results now live in a wrapping 2-col grid (role=list) — one cell (listitem) per result — rather
        // than a single full-bleed column; the row selection contract is preserved.
        const grid = screen.getByRole('list');
        expect(within(grid).getAllByRole('listitem')).toHaveLength(3);
        expect(screen.getByRole('button', { name: 'Mediterranean Grilled Lamb' })).toBeTruthy();
    });
});

describe('RecipeDiscoveryList (native) — pull-to-refresh (U4/L8)', () => {
    it('still renders the result grid when a refresh control is wired (RefreshControl is inert in jsdom)', () => {
        // The pull gesture + spinner are a device/Maestro concern; this guards that wiring the control through
        // the virtualized results list does not break the grid.
        renderDiscovery({
            status: 'ready',
            results: threeResults,
            refresh: { refreshing: true, onRefresh: noop },
        });

        expect(screen.getByRole('button', { name: 'Mediterranean Grilled Lamb' })).toBeTruthy();
        expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(3);
    });
});

describe('RecipeDiscoveryList (native) — clone', () => {
    it('reports the cloned recipe id upward', () => {
        const onClone = vi.fn();
        renderDiscovery({ status: 'ready', results: threeResults, onClone });

        fireEvent.click(screen.getByRole('button', { name: 'Clone Asparagus with Green Sauce' }));

        expect(onClone).toHaveBeenCalledWith('rec_2');
    });

    it('marks only the cloning row busy, leaving the others actionable', () => {
        const onClone = vi.fn();
        renderDiscovery({ status: 'ready', results: threeResults, cloningId: 'rec_2', onClone });

        expect(screen.getByRole('button', { name: 'Cloning Asparagus with Green Sauce' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Clone Mediterranean Grilled Lamb' })).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Clone Gourmet Garden Salad' }));
        expect(onClone).toHaveBeenCalledWith('rec_3');
    });
});
