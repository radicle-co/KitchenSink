// @vitest-environment jsdom
/**
 * Component tests for the web public-discovery view (T076). Covers EVERY UI state the testing mandate
 * requires — loading, error, empty, and populated — plus the persistent search chrome and the interaction
 * contracts (search change, select, clone, per-row clone-busy, retry) and source-attribution rendering.
 * Assertions are on role/name/text and on mock-call arguments, so a wrong branch, a dropped handler
 * argument, or a missing busy/disabled state fails the test.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { RecipeSearchSortBy, type Recipe, type RecipeSearchResult } from '@kitchensink/recipe-core';

import { makeRecipe } from '../../__fixtures__/index.js';
import { RecipeDiscoveryList } from '../RecipeDiscoveryList.js';
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

describe('RecipeDiscoveryList (web) — chrome', () => {
    it('always renders the heading and search box', () => {
        renderDiscovery({ status: 'loading' });

        expect(screen.getByRole('heading', { name: 'Discover recipes' })).toBeTruthy();
        expect(screen.getByRole('searchbox', { name: 'Search public recipes' })).toBeTruthy();
    });

    it('reflects the controlled search value', () => {
        renderDiscovery({ searchValue: 'risotto' });

        expect(screen.getByRole<HTMLInputElement>('searchbox').value).toBe('risotto');
    });

    it('reports search input changes upward', () => {
        const onSearchChange = vi.fn();
        renderDiscovery({ onSearchChange });

        fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'lamb' } });

        expect(onSearchChange).toHaveBeenCalledWith('lamb');
    });
});

describe('RecipeDiscoveryList (web) — loading state', () => {
    it('shows a busy status and no recipe rows', () => {
        renderDiscovery({ status: 'loading' });

        expect(screen.getByRole('status')).toBeTruthy();
        expect(screen.queryByRole('button', { name: /Grilled Lamb/ })).toBeNull();
    });
});

describe('RecipeDiscoveryList (web) — error state', () => {
    it('shows an alert with a retry action that reports upward', () => {
        const onRetry = vi.fn();
        renderDiscovery({ status: 'error', onRetry });

        expect(screen.getByRole('alert')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('does not render recipe rows in the error state', () => {
        renderDiscovery({ status: 'error', results: threeResults });

        expect(screen.queryByRole('button', { name: /Grilled Lamb/ })).toBeNull();
    });
});

describe('RecipeDiscoveryList (web) — empty state', () => {
    it('shows the empty message when a successful search returns nothing', () => {
        renderDiscovery({ status: 'ready', results: [] });

        expect(screen.getByText('No recipes found')).toBeTruthy();
    });

    it('renders neither a count nor rows when empty', () => {
        renderDiscovery({ status: 'ready', results: [] });

        expect(screen.queryByText('0 recipes')).toBeNull();
        expect(screen.queryByRole('list')).toBeNull();
    });
});

describe('RecipeDiscoveryList (web) — no-match state', () => {
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

    it('shows the browse-empty copy when nothing is active', () => {
        renderDiscovery({ status: 'ready', results: [], searchValue: '' });

        expect(screen.getByText('No recipes found')).toBeTruthy();
        expect(screen.queryByText('No matching recipes')).toBeNull();
    });
});

describe('RecipeDiscoveryList (web) — populated state', () => {
    it('renders a pluralized result count when browsing (no query)', () => {
        renderDiscovery({ status: 'ready', results: threeResults });

        expect(screen.getByText('3 recipes')).toBeTruthy();
    });

    it('echoes the active query in the results header (S5)', () => {
        renderDiscovery({ status: 'ready', results: threeResults, searchValue: 'pasta' });

        expect(screen.getByText('Showing 3 recipes for “pasta”')).toBeTruthy();
    });

    it('renders the sort control with the active option checked and reports a change (S3)', () => {
        const onChange = vi.fn();
        renderDiscovery({
            status: 'ready',
            results: threeResults,
            sort: { active: RecipeSearchSortBy.RELEVANCE, onChange },
        });

        const group = screen.getByRole('radiogroup', { name: 'Sort by' });
        expect(within(group).getByRole('radio', { name: 'Relevance' }).getAttribute('aria-checked')).toBe('true');
        expect(within(group).getByRole('radio', { name: 'Quickest' }).getAttribute('aria-checked')).toBe('false');

        fireEvent.click(within(group).getByRole('radio', { name: 'Quickest' }));
        expect(onChange).toHaveBeenCalledWith('quickest');
    });

    it('renders no sort control when no sort prop is given', () => {
        renderDiscovery({ status: 'ready', results: threeResults });

        expect(screen.queryByRole('radiogroup', { name: 'Sort by' })).toBeNull();
    });

    it('renders a Load more button that fetches the next page when more pages exist (S4)', () => {
        const onLoadMore = vi.fn();
        renderDiscovery({
            status: 'ready',
            results: threeResults,
            loadMore: { hasMore: true, loading: false, onLoadMore },
        });

        fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
        expect(onLoadMore).toHaveBeenCalledTimes(1);
    });

    it('hides the Load more button on the last page (no infinite scroll) (S4)', () => {
        renderDiscovery({
            status: 'ready',
            results: threeResults,
            loadMore: { hasMore: false, loading: false, onLoadMore: vi.fn() },
        });

        expect(screen.queryByRole('button', { name: /Load more|Loading/ })).toBeNull();
    });

    it('renders one row per result in a list structure', () => {
        renderDiscovery({ status: 'ready', results: threeResults });

        const list = screen.getByRole('list');
        expect(within(list).getAllByRole('listitem')).toHaveLength(3);
        expect(screen.getByRole('button', { name: 'Mediterranean Grilled Lamb' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Asparagus with Green Sauce' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Gourmet Garden Salad' })).toBeTruthy();
    });

    it('reports the selected recipe id upward', () => {
        const onSelectRecipe = vi.fn();
        renderDiscovery({ status: 'ready', results: threeResults, onSelectRecipe });

        fireEvent.click(screen.getByRole('button', { name: 'Asparagus with Green Sauce' }));

        expect(onSelectRecipe).toHaveBeenCalledWith('rec_2');
    });

    it('renders source attribution only when present', () => {
        renderDiscovery({ status: 'ready', results: threeResults });

        expect(screen.getByText('From Serious Eats')).toBeTruthy();
        expect(screen.getByText('From Bon Appétit')).toBeTruthy();
        // The middle result carries no attribution — nothing rendered for it.
        expect(screen.queryByText(/From undefined/)).toBeNull();
    });

    it('composes the compound card fields — author handle, cuisine, calories, visibility (S1)', () => {
        renderDiscovery({
            status: 'ready',
            results: [
                makeSearchResult({
                    id: 'rec_x',
                    title: 'Ribollita',
                    authorHandle: 'tuscan_cook',
                    cuisine: 'Tuscan',
                    leadCaloriesPerServing: 320,
                    visibility: 'public',
                    status: 'published',
                }),
            ],
        });

        expect(screen.getByText('by @tuscan_cook')).toBeTruthy();
        expect(screen.getByText('Tuscan')).toBeTruthy();
        expect(screen.getByText('320 cal')).toBeTruthy();
        expect(screen.getByText('Public')).toBeTruthy();
        // Still selectable by title and cloneable — the compound composition keeps the row contract.
        expect(screen.getByRole('button', { name: 'Ribollita' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Clone Ribollita' })).toBeTruthy();
    });
});

describe('RecipeDiscoveryList (web) — clone', () => {
    it('reports the cloned recipe id upward', () => {
        const onClone = vi.fn();
        renderDiscovery({ status: 'ready', results: threeResults, onClone });

        fireEvent.click(screen.getByRole('button', { name: 'Clone Asparagus with Green Sauce' }));

        expect(onClone).toHaveBeenCalledWith('rec_2');
    });

    it('marks only the cloning row busy and disabled, leaving the others actionable', () => {
        const onClone = vi.fn();
        renderDiscovery({ status: 'ready', results: threeResults, cloningId: 'rec_2', onClone });

        const busy = screen.getByRole('button', { name: 'Cloning Asparagus with Green Sauce' });
        expect(busy.getAttribute('aria-busy')).toBe('true');
        expect((busy as HTMLButtonElement).disabled).toBe(true);

        // A disabled busy row must not re-fire clone.
        fireEvent.click(busy);
        expect(onClone).not.toHaveBeenCalled();

        // Sibling rows are still cloneable.
        expect(screen.getByRole('button', { name: 'Clone Mediterranean Grilled Lamb' })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Clone Gourmet Garden Salad' }));
        expect(onClone).toHaveBeenCalledWith('rec_3');
    });
});
