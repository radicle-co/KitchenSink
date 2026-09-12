/**
 * Native component tests for the discovery RESULTS (react-native-web under jsdom) — what renders inside the discovery
 * suspense boundary once the search has settled. Mirrors `RecipeDiscoveryResults.test.tsx`.
 *
 * Moved from the retired `RecipeDiscoveryList.native.test.tsx` ("empty state", "no-match state", "populated state"
 * minus its sort cases, "browse slot (U7)" minus the status pairings, "compact grid (U7)", "pull-to-refresh (U4/L8)",
 * "clone", and "a failed refresh of the rows on screen" minus its focus hand-off). Back-to-browse moved to the frame;
 * see `RecipeDiscoveryFrame.native.test.tsx`. The browse surface's scroll container and ITS pull-to-refresh moved into the
 * rails block (review D1: the pull refreshed the main search, not the rails on screen); see
 * `RecipeBrowseRails.native.test.tsx`.
 */
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Recipe, RecipeSearchResult } from '@kitchensink/recipe-core';
import { Text } from 'react-native';

import { PENDING_BAR_DELAY_MS } from '@commise/ui/pending-bar';

import { makeRecipe } from '../../__fixtures__/index.js';
// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { RecipeDiscoveryResults } from '../RecipeDiscoveryResults.native.js';
import type { RecipeDiscoveryResultsProps } from '../model.js';

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

const noop = () => undefined;

/** Inline factory: wrap a {@link Recipe} in a search-result envelope. */
function makeSearchResult(recipe: Partial<Recipe> = {}): RecipeSearchResult {
    return { recipe: makeRecipe(recipe) };
}

const threeResults = [
    makeSearchResult({ id: 'rec_1', title: 'Mediterranean Grilled Lamb', sourceAttribution: 'Serious Eats' }),
    makeSearchResult({ id: 'rec_2', title: 'Asparagus with Green Sauce' }),
    makeSearchResult({ id: 'rec_3', title: 'Gourmet Garden Salad', sourceAttribution: 'Bon Appétit' }),
];

function results(overrides: Partial<RecipeDiscoveryResultsProps> = {}) {
    return (
        <RecipeDiscoveryResults
            results={[]}
            query=""
            searching={false}
            stale={false}
            onSelectRecipe={noop}
            onClone={noop}
            {...overrides}
        />
    );
}

function renderResults(overrides: Partial<RecipeDiscoveryResultsProps> = {}) {
    return render(results(overrides));
}

describe('RecipeDiscoveryResults (native) — empty and no-match', () => {
    it('shows the browse-empty copy when nothing was searched', () => {
        renderResults();

        expect(screen.getByText('No recipes found')).toBeTruthy();
        expect(screen.queryByText('No matching recipes')).toBeNull();
    });

    it('shows the no-match copy (NOT the browse-empty copy) when a search or filter matched nothing', () => {
        renderResults({ query: 'tiramisu', searching: true });

        expect(screen.getByText('No matching recipes')).toBeTruthy();
        expect(screen.queryByText('No recipes found')).toBeNull();
    });
});

describe('RecipeDiscoveryResults (native) — populated', () => {
    it('renders a pluralized result count when no query is typed', () => {
        renderResults({ results: threeResults });

        expect(screen.getByText('3 recipes')).toBeTruthy();
    });

    it('names the query the results belong to in the header (S5)', () => {
        renderResults({ results: threeResults, query: 'pasta', searching: true });

        expect(screen.getByText('Showing 3 recipes for “pasta”')).toBeTruthy();
    });

    it('composes the compound card fields — author handle, cuisine (S1), and no fabricated 0', () => {
        renderResults({
            results: [
                makeSearchResult({ id: 'rec_x', title: 'Ribollita', authorHandle: 'tuscan_cook', cuisine: 'Tuscan' }),
            ],
        });

        expect(screen.getByText('by @tuscan_cook')).toBeTruthy();
        expect(screen.getByText('Tuscan')).toBeTruthy();
        expect(screen.queryByText('0 cal')).toBeNull();
        expect(screen.getByRole('button', { name: 'Ribollita' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Clone Ribollita' })).toBeTruthy();
    });

    it('lays the result cards out in a grid of one cell per result, and reports selection upward', () => {
        const onSelectRecipe = vi.fn();
        renderResults({ results: threeResults, onSelectRecipe });

        expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(3);

        fireEvent.click(screen.getByRole('button', { name: 'Asparagus with Green Sauce' }));
        expect(onSelectRecipe).toHaveBeenCalledWith('rec_2');
    });

    it('renders source attribution only when present', () => {
        renderResults({ results: threeResults });

        expect(screen.getByText('From Serious Eats')).toBeTruthy();
        expect(screen.getByText('From Bon Appétit')).toBeTruthy();
        expect(screen.queryByText(/From undefined/)).toBeNull();
    });

    it('renders each card’s nutrition from the host’s renderer, keyed by recipe id', () => {
        renderResults({ results: threeResults, renderNutrition: (id) => <Text>{`kcal for ${id}`}</Text> });

        expect(screen.getByText('kcal for rec_2')).toBeTruthy();
    });

    it('still renders the result grid when a refresh control is wired (RefreshControl is inert in jsdom)', () => {
        renderResults({ results: threeResults, refresh: { refreshing: true, onRefresh: noop } });

        expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(3);
    });
});

describe('RecipeDiscoveryResults (native) — load more (S4)', () => {
    it('renders a Load more button that fetches the next page, hidden on the last page', () => {
        const onLoadMore = vi.fn();
        const { rerender } = renderResults({
            results: threeResults,
            loadMore: { hasMore: true, loading: false, onLoadMore, failed: false },
        });

        fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
        expect(onLoadMore).toHaveBeenCalledTimes(1);

        rerender(
            results({ results: threeResults, loadMore: { hasMore: false, loading: false, onLoadMore, failed: false } }),
        );
        expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
    });

    it('⛔ a failed NEXT page keeps the loaded results and offers Try again beside the reason', () => {
        const onLoadMore = vi.fn();
        renderResults({ results: threeResults, loadMore: { hasMore: true, loading: false, failed: true, onLoadMore } });

        expect(screen.getByText('We couldn’t load more recipes.')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        expect(onLoadMore).toHaveBeenCalledTimes(1);
    });

    /**
     * react-native-web projects `accessibilityState.busy` to no DOM attribute, so the in-flight control announced
     * nothing beyond its relabel. `aria-busy` is RN's own alias for it, and is omitted while idle.
     */
    it('marks the load-more control busy in the DOM while the next page is in flight, and unmarked while idle', () => {
        const { rerender } = renderResults({
            results: threeResults,
            loadMore: { hasMore: true, loading: true, onLoadMore: noop, failed: false },
        });

        const loading = screen.getByRole('button', { name: 'Loading…' });
        expect(loading.getAttribute('aria-busy')).toBe('true');
        expect(loading.getAttribute('aria-disabled')).toBe('true');

        rerender(
            results({
                results: threeResults,
                loadMore: { hasMore: true, loading: false, onLoadMore: noop, failed: false },
            }),
        );
        expect(screen.getByRole('button', { name: 'Load more' }).getAttribute('aria-busy')).toBeNull();
    });
});

describe('RecipeDiscoveryResults (native) — browse slot (U7)', () => {
    it('renders the browse slot, not the browse-empty copy, when the container supplies one', () => {
        renderResults({ browseSlot: <Text>CURATED RAILS</Text> });

        expect(screen.getByText('CURATED RAILS')).toBeTruthy();
        expect(screen.queryByText('No recipes found')).toBeNull();
    });

    it('takes precedence over the flat result grid', () => {
        renderResults({ results: threeResults, browseSlot: <Text>CURATED RAILS</Text> });

        expect(screen.getByText('CURATED RAILS')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Mediterranean Grilled Lamb' })).toBeNull();
    });
});

describe('RecipeDiscoveryResults (native) — clone', () => {
    it('reports the cloned recipe id upward', () => {
        const onClone = vi.fn();
        renderResults({ results: threeResults, onClone });

        fireEvent.click(screen.getByRole('button', { name: 'Clone Asparagus with Green Sauce' }));

        expect(onClone).toHaveBeenCalledWith('rec_2');
    });

    it('marks only the cloning row busy, leaving the others actionable', () => {
        const onClone = vi.fn();
        renderResults({ results: threeResults, cloningId: 'rec_2', onClone });

        expect(screen.getByRole('button', { name: 'Cloning Asparagus with Green Sauce' })).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Clone Gourmet Garden Salad' }));
        expect(onClone).toHaveBeenCalledWith('rec_3');
    });
});

/**
 * REWRITTEN (EVALUATE R1): staleness is the pending bar, never `aria-busy` on the region — JAWS hides busy content, and
 * the previous results must stay readable while the next ones load.
 */
describe('RecipeDiscoveryResults (native) — newer results pending', () => {
    it('exposes the results as a region named "Search results"', () => {
        renderResults({ results: threeResults });

        expect(screen.getByRole('region', { name: 'Search results' })).toBeTruthy();
    });

    it('keeps the previous results naming their own query and usable, without marking them busy', () => {
        const onSelectRecipe = vi.fn();
        const { container } = renderResults({
            results: threeResults,
            query: 'past',
            searching: true,
            stale: true,
            onSelectRecipe,
        });

        expect(screen.getByText('Showing 3 recipes for “past”')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Gourmet Garden Salad' }));
        expect(onSelectRecipe).toHaveBeenCalledWith('rec_3');
        expect(container.querySelector('[aria-busy="true"]')).toBeNull();
    });

    it('draws the pending bar once the delay has passed, and not before', () => {
        vi.useFakeTimers();
        const { container } = renderResults({ browseSlot: <Text>CURATED RAILS</Text>, stale: true });

        expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(0);

        act(() => {
            vi.advanceTimersByTime(PENDING_BAR_DELAY_MS);
        });

        expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(1);
    });

    it('draws no bar once settled, however long it waits', () => {
        vi.useFakeTimers();
        const { container } = renderResults({ browseSlot: <Text>CURATED RAILS</Text> });

        act(() => {
            vi.advanceTimersByTime(PENDING_BAR_DELAY_MS * 2);
        });

        expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(0);
    });
});

describe('RecipeDiscoveryResults (native) — a failed refresh of the rows on screen', () => {
    const notice = (overrides: Partial<NonNullable<RecipeDiscoveryResultsProps['refreshNotice']>> = {}) => ({
        failed: false,
        refreshing: false,
        onRetry: noop,
        recoveries: 0,
        ...overrides,
    });

    it('shows no notice while nothing has failed', () => {
        renderResults({ results: threeResults, refreshNotice: notice() });

        expect(screen.queryByText('We couldn’t refresh these results.')).toBeNull();
    });

    it('⛔ keeps the rows and says the refresh failed, with a Try again that retries', () => {
        const onRetry = vi.fn();
        renderResults({ results: threeResults, refreshNotice: notice({ failed: true, onRetry }) });

        expect(screen.getAllByText('Mediterranean Grilled Lamb').length).toBeGreaterThan(0);
        expect(screen.getAllByText('We couldn’t refresh these results.').length).toBeGreaterThan(0);
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('shows no results notice while BROWSING — the rails are on screen, not the results it would describe', () => {
        renderResults({
            results: threeResults,
            browseSlot: <Text>Browse rails</Text>,
            refreshNotice: notice({ failed: true }),
        });

        expect(screen.getByText('Browse rails')).toBeTruthy();
        expect(screen.queryByText('We couldn’t refresh these results.')).toBeNull();
    });
});
