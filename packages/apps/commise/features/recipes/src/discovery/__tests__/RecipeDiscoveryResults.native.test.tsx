/**
 * ⚠️ REWRITTEN for slice 5 of the UI overhaul, with the web leaf's test (`docs/design/uiOverhaul/buildSpec.md` §4.5, §4.6):
 * the count line moved to the frame, the clone cases became Save a copy, and the single no-match body became three states
 * plus the empty catalogue, each ending in tag chips and the Trending rail. The pending-bar, load-more, browse-slot and
 * refresh-notice assertions are kept.
 *
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
import type { SaveCopy } from '../../hooks/useSaveCopy.js';
// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { RecipeDiscoveryResults } from '../RecipeDiscoveryResults.native.js';
import type { RecipeDiscoveryResultsProps } from '../model.js';

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

const noop = () => undefined;

/** A save-a-copy surface where nothing has been copied. */
const SAVE_COPY: SaveCopy = { stateOf: () => ({ kind: 'idle' }), save: noop };

const NO_RESULT: NonNullable<RecipeDiscoveryResultsProps['noResult']> = {
    onClearSearch: noop,
    onClearFilters: noop,
    tryTags: [],
    onPickTag: noop,
};

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
            kind={undefined}
            stale={false}
            cardVariant="compact"
            saveCopy={SAVE_COPY}
            onSelectRecipe={noop}
            noResult={NO_RESULT}
            {...overrides}
        />
    );
}

function renderResults(overrides: Partial<RecipeDiscoveryResultsProps> = {}) {
    return render(results(overrides));
}

describe('RecipeDiscoveryResults (native) — empty catalogue and no-result states', () => {
    it('says the catalogue is empty when nothing was searched, with no recovery', () => {
        renderResults();

        expect(screen.getByRole('heading', { name: 'No public recipes yet.' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: /Clear/u })).toBeNull();
    });

    it('a search alone: names the term, advises on spelling, and offers Clear search', () => {
        const onClearSearch = vi.fn();
        renderResults({ kind: 'query', query: 'lamb', noResult: { ...NO_RESULT, onClearSearch } });

        expect(screen.getByRole('heading', { name: 'No recipes for “lamb”' })).toBeTruthy();
        expect(screen.getByText('Check the spelling, or try a shorter search.')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));

        expect(onClearSearch).toHaveBeenCalledOnce();
    });

    it('filters alone: says so, advises removing one, and offers Clear filters', () => {
        const onClearFilters = vi.fn();
        renderResults({ kind: 'filters', noResult: { ...NO_RESULT, onClearFilters } });

        expect(screen.getByRole('heading', { name: 'No recipes match these filters' })).toBeTruthy();
        expect(screen.getByText('Remove a filter to see more.')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));

        expect(onClearFilters).toHaveBeenCalledOnce();
    });

    it('both: names the term and the filters, and offers both clears', () => {
        const onClearSearch = vi.fn();
        const onClearFilters = vi.fn();
        renderResults({ kind: 'both', query: 'lamb', noResult: { ...NO_RESULT, onClearSearch, onClearFilters } });

        expect(screen.getByRole('heading', { name: 'No recipes for “lamb” with these filters' })).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
        fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));

        expect(onClearFilters).toHaveBeenCalledOnce();
        expect(onClearSearch).toHaveBeenCalledOnce();
    });

    it('every narrowed state ends with “Try one of these” tag chips, then the Trending rail', () => {
        const onPickTag = vi.fn();
        renderResults({
            kind: 'query',
            query: 'lamb',
            noResult: {
                ...NO_RESULT,
                tryTags: ['quick', 'vegan', 'dinner'],
                onPickTag,
                trendingSlot: <Text>TRENDING RAIL</Text>,
            },
        });

        expect(screen.getByText('Try one of these')).toBeTruthy();
        expect(screen.getByText('TRENDING RAIL')).toBeTruthy();

        fireEvent.click(
            within(screen.getByRole('group', { name: 'Popular tags' })).getByRole('checkbox', { name: 'vegan' }),
        );

        expect(onPickTag).toHaveBeenCalledExactlyOnceWith('vegan');
    });

    it('offers no tags and no Trending rail for an empty catalogue, and no tag row without three tags', () => {
        renderResults({
            kind: undefined,
            noResult: { ...NO_RESULT, tryTags: ['a', 'b', 'c'], trendingSlot: <Text>TRENDING RAIL</Text> },
        });

        expect(screen.queryByText('Try one of these')).toBeNull();
        expect(screen.queryByText('TRENDING RAIL')).toBeNull();
        cleanup();

        renderResults({ kind: 'filters', noResult: { ...NO_RESULT, tryTags: [] } });

        expect(screen.queryByText('Try one of these')).toBeNull();
    });
});

describe('RecipeDiscoveryResults (native) — populated', () => {
    it('lays the result cards out in a list of one cell per result, each a link named by its title', () => {
        const onSelectRecipe = vi.fn();
        renderResults({ results: threeResults, onSelectRecipe });

        expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(3);

        fireEvent.click(screen.getByRole('link', { name: 'Asparagus with Green Sauce' }));
        expect(onSelectRecipe).toHaveBeenCalledWith('rec_2');
    });

    it('draws the variant the host decided', () => {
        renderResults({ results: threeResults, cardVariant: 'grid' });

        expect(screen.getAllByRole('link')).toHaveLength(3);
    });

    it('shows the author as @handle in the footer, and no fabricated 0 cal', () => {
        renderResults({
            results: [
                makeSearchResult({ id: 'rec_x', title: 'Ribollita', authorHandle: 'tuscan_cook', cuisine: 'Tuscan' }),
            ],
            cardVariant: 'grid',
        });

        expect(screen.getByText('@tuscan_cook')).toBeTruthy();
        expect(screen.getByText('Tuscan')).toBeTruthy();
        expect(screen.queryByText('0 cal')).toBeNull();
        expect(screen.getByRole('button', { name: 'Save a copy of Ribollita' })).toBeTruthy();
    });

    it('renders source attribution only when the recipe has no author handle', () => {
        renderResults({ results: threeResults });

        expect(screen.getByText('From Serious Eats')).toBeTruthy();
        expect(screen.queryByText(/From undefined/u)).toBeNull();
    });

    it('renders each card’s nutrition from the host’s renderer, keyed by recipe id', () => {
        renderResults({
            results: threeResults,
            cardVariant: 'grid',
            renderNutrition: (id) => <Text>{`kcal for ${id}`}</Text>,
        });

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
        expect(screen.queryByText('No public recipes yet.')).toBeNull();
    });

    it('takes precedence over the flat result grid', () => {
        renderResults({ results: threeResults, browseSlot: <Text>CURATED RAILS</Text> });

        expect(screen.getByText('CURATED RAILS')).toBeTruthy();
        expect(screen.queryByRole('link', { name: 'Mediterranean Grilled Lamb' })).toBeNull();
    });
});

describe('RecipeDiscoveryResults (native) — Save a copy', () => {
    it('reports the recipe to copy upward', () => {
        const save = vi.fn();
        renderResults({ results: threeResults, saveCopy: { stateOf: () => ({ kind: 'idle' }), save } });

        fireEvent.click(screen.getByRole('button', { name: 'Save a copy of Asparagus with Green Sauce' }));

        expect(save).toHaveBeenCalledExactlyOnceWith('rec_2');
    });

    it('shows each card its own copy state, leaving the others actionable', () => {
        const save = vi.fn();
        renderResults({
            results: threeResults,
            saveCopy: { stateOf: (id) => (id === 'rec_2' ? { kind: 'saving' } : { kind: 'idle' }), save },
        });

        expect(screen.getByRole('button', { name: 'Saving a copy of Asparagus with Green Sauce' })).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Save a copy of Gourmet Garden Salad' }));
        expect(save).toHaveBeenCalledExactlyOnceWith('rec_3');
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

    it('keeps the previous results usable, without marking them busy', () => {
        const onSelectRecipe = vi.fn();
        const { container } = renderResults({
            results: threeResults,
            query: 'past',
            kind: 'query',
            stale: true,
            onSelectRecipe,
        });

        fireEvent.click(screen.getByRole('link', { name: 'Gourmet Garden Salad' }));
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

/** A scroll host's bind that records what its scroller does with it. */
function recordingBind() {
    return { ref: vi.fn(), onScroll: vi.fn(), onScrollBeginDrag: vi.fn(), scrollEventThrottle: 16 as const };
}

/** The node the bind's ref was last handed. */
function boundScroller(bind: ReturnType<typeof recordingBind>): Element {
    const node: unknown = bind.ref.mock.calls.at(-1)?.[0];

    if (!(node instanceof Element)) {
        throw new Error('the scroller never took the bind');
    }

    return node;
}

/**
 * The screen's ONE vertical scroller takes its scroll host's bind (blueprint A7), so the host reads the scroll — the
 * floating create button shrinks as the cook scrolls down, and a second tap on the tab returns to the top.
 */
describe("RecipeDiscoveryResults (native) — the scroll host's bind", () => {
    it("binds its scroller to the screen's scroll host, and reports each scroll to it", () => {
        const bind = recordingBind();
        renderResults({ scrollBind: bind });

        fireEvent.scroll(boundScroller(bind), { target: { scrollTop: 240 } });

        expect(bind.onScroll).toHaveBeenCalled();
    });
});
