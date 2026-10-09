// @vitest-environment jsdom
/**
 * Component tests for the web discovery RESULTS — what renders inside the discovery suspense boundary once the search
 * has settled: the browse rails (while browsing), the empty and no-match bodies, the counted and query-naming header,
 * the result grid with its clone actions and load-more control, the notice for a failed refresh, and the busy state
 * while newer results are pending.
 *
 * ⚠️ REWRITTEN for slice 5 of the UI overhaul (`docs/design/uiOverhaul/buildSpec.md` §4.5, §4.6). The result count and its
 * query-naming sentence moved to the frame (one element that is both the visible line and the polite live region); the
 * clone cases became Save a copy on the footer; the single no-match body became three states (a search, filters, both) plus
 * the empty catalogue, each ending in "Try one of these" tag chips and the Trending rail. The grid cards are `compact` below
 * a 600 container and `grid` from 600, chosen by the host. The pending-bar, load-more, browse-slot and refresh-notice
 * assertions are kept.
 *
 * Moved from the retired `RecipeDiscoveryList.test.tsx` ("empty state", "no-match state", "populated state" minus its
 * sort cases, "browse slot (U7)" minus sort and back-to-browse, "clone", the load-more touch floor, and "a failed
 * refresh of the rows on screen" minus its focus hand-off). The browse cases that paired `browseSlot` with `status`
 * ("surfaces a failure while browsing", "shows the loading skeleton while browsing") are structural now — a pending or
 * failed read never reaches this leaf — and `RecipeDiscoveryContainer.test.tsx` covers both on the browse default.
 *
 * NEW here: the header names `query`, the term the results BELONG TO, which is not the field's current value while a
 * newer search is pending; and `stale` mounts the pending bar. REWRITTEN (EVALUATE R1): the region is deliberately NOT
 * `aria-busy` — JAWS hides busy content, and these results must stay readable while the next ones load.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Recipe, RecipeSearchResult } from '@kitchensink/recipe-core';

import { makeRecipe } from '../../__fixtures__/index.js';
import type { SaveCopy } from '../../hooks/useSaveCopy.js';
import { RecipeDiscoveryResults } from '../RecipeDiscoveryResults.js';
import type { RecipeDiscoveryResultsProps } from '../model.js';

afterEach(cleanup);

const noop = () => undefined;

/** A save-a-copy surface where nothing has been copied. */
const SAVE_COPY: SaveCopy = { stateOf: () => ({ kind: 'idle' }), save: noop };

/** Inline factory: wrap a {@link Recipe} in a search-result envelope. */
function makeSearchResult(recipe: Partial<Recipe> = {}): RecipeSearchResult {
    return { recipe: makeRecipe(recipe) };
}

const threeResults = [
    makeSearchResult({ id: 'rec_1', title: 'Mediterranean Grilled Lamb', sourceAttribution: 'Serious Eats' }),
    makeSearchResult({ id: 'rec_2', title: 'Asparagus with Green Sauce' }),
    makeSearchResult({ id: 'rec_3', title: 'Gourmet Garden Salad', sourceAttribution: 'Bon Appétit' }),
];

const NO_RESULT: NonNullable<RecipeDiscoveryResultsProps['noResult']> = {
    onClearSearch: noop,
    onClearFilters: noop,
    tryTags: [],
    onPickTag: noop,
};

function results(overrides: Partial<RecipeDiscoveryResultsProps> = {}) {
    return (
        <RecipeDiscoveryResults
            results={[]}
            query=""
            kind={undefined}
            stale={false}
            cardVariant="grid"
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

/** The results region, located as assistive tech reaches it: a region named "Search results". */
function resultsRegion(_container: HTMLElement): HTMLElement {
    return screen.getByRole('region', { name: 'Search results' });
}

describe('RecipeDiscoveryResults (web) — empty catalogue and no-result states', () => {
    it('says the catalogue is empty when nothing was searched, with neither rows nor recovery', () => {
        renderResults();

        expect(screen.getByRole('heading', { level: 2, name: 'No public recipes yet.' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: /Clear/u })).toBeNull();
        expect(screen.queryByRole('list')).toBeNull();
    });

    it('a search alone: names the term, advises on spelling, and offers Clear search', async () => {
        const user = userEvent.setup();
        const onClearSearch = vi.fn();
        renderResults({ kind: 'query', query: 'lamb', noResult: { ...NO_RESULT, onClearSearch } });
        const status = screen.getByRole('status');

        expect(within(status).getByRole('heading', { level: 2, name: 'No recipes for “lamb”' })).toBeTruthy();
        expect(within(status).getByText('Check the spelling, or try a shorter search.')).toBeTruthy();
        expect(within(status).queryByRole('button', { name: 'Clear filters' })).toBeNull();

        await user.click(within(status).getByRole('button', { name: 'Clear search' }));

        expect(onClearSearch).toHaveBeenCalledOnce();
    });

    it('filters alone: says so, advises removing one, and offers Clear filters', async () => {
        const user = userEvent.setup();
        const onClearFilters = vi.fn();
        renderResults({ kind: 'filters', noResult: { ...NO_RESULT, onClearFilters } });
        const status = screen.getByRole('status');

        expect(within(status).getByRole('heading', { level: 2, name: 'No recipes match these filters' })).toBeTruthy();
        expect(within(status).getByText('Remove a filter to see more.')).toBeTruthy();
        expect(within(status).queryByRole('button', { name: 'Clear search' })).toBeNull();

        await user.click(within(status).getByRole('button', { name: 'Clear filters' }));

        expect(onClearFilters).toHaveBeenCalledOnce();
    });

    it('both: names the term and the filters, and offers both clears', async () => {
        const user = userEvent.setup();
        const onClearSearch = vi.fn();
        const onClearFilters = vi.fn();
        renderResults({ kind: 'both', query: 'lamb', noResult: { ...NO_RESULT, onClearSearch, onClearFilters } });
        const status = screen.getByRole('status');

        expect(
            within(status).getByRole('heading', { level: 2, name: 'No recipes for “lamb” with these filters' }),
        ).toBeTruthy();

        await user.click(within(status).getByRole('button', { name: 'Clear filters' }));
        await user.click(within(status).getByRole('button', { name: 'Clear search' }));

        expect(onClearFilters).toHaveBeenCalledOnce();
        expect(onClearSearch).toHaveBeenCalledOnce();
    });

    it('takes no focus: the heading is not focusable, so focus stays in the search field', () => {
        renderResults({ kind: 'query', query: 'lamb' });

        expect(screen.getByRole('heading', { level: 2 }).hasAttribute('tabindex')).toBe(false);
    });

    it('every narrowed state ends with “Try one of these” tag chips, then the Trending rail — never a dead end', async () => {
        const user = userEvent.setup();
        const onPickTag = vi.fn();
        renderResults({
            kind: 'query',
            query: 'lamb',
            noResult: {
                ...NO_RESULT,
                tryTags: ['quick', 'vegan', 'dinner'],
                onPickTag,
                trendingSlot: <p>TRENDING RAIL</p>,
            },
        });

        expect(screen.getByText('Try one of these')).toBeTruthy();
        const tags = screen.getByRole('group', { name: 'Popular tags' });

        expect(
            within(tags)
                .getAllByRole('button')
                .map((button) => button.textContent),
        ).toEqual(['quick', 'vegan', 'dinner']);
        expect(screen.getByText('TRENDING RAIL')).toBeTruthy();

        await user.click(within(tags).getByRole('button', { name: 'vegan' }));

        expect(onPickTag).toHaveBeenCalledExactlyOnceWith('vegan');
    });

    it('hides the tag chips when there are none to offer, but still shows the Trending rail', () => {
        renderResults({ kind: 'filters', noResult: { ...NO_RESULT, tryTags: [], trendingSlot: <p>TRENDING RAIL</p> } });

        expect(screen.queryByText('Try one of these')).toBeNull();
        expect(screen.getByText('TRENDING RAIL')).toBeTruthy();
    });

    it('offers no tags and no Trending rail for an empty catalogue', () => {
        renderResults({
            kind: undefined,
            noResult: { ...NO_RESULT, tryTags: ['a', 'b', 'c'], trendingSlot: <p>TRENDING RAIL</p> },
        });

        expect(screen.queryByText('Try one of these')).toBeNull();
        expect(screen.queryByText('TRENDING RAIL')).toBeNull();
    });
});

describe('RecipeDiscoveryResults (web) — populated', () => {
    it('renders one card per result in a list, each a link named by its title', () => {
        renderResults({ results: threeResults, hrefOf: (id) => `/en/recipes/${id}` });

        expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(3);
        expect(screen.getByRole('link', { name: 'Mediterranean Grilled Lamb' }).getAttribute('href')).toBe(
            '/en/recipes/rec_1',
        );
        expect(screen.getByRole('link', { name: 'Asparagus with Green Sauce' })).toBeTruthy();
        expect(screen.getByRole('link', { name: 'Gourmet Garden Salad' })).toBeTruthy();
    });

    it('draws grid cards from a 600 container and compact cards below it, in a grid that fits their width', () => {
        const { rerender } = renderResults({ results: threeResults, cardVariant: 'grid' });

        expect(screen.getAllByRole('article').map((card) => card.getAttribute('data-card-variant'))).toEqual([
            'grid',
            'grid',
            'grid',
        ]);
        expect(screen.getByRole('list').className).toContain('auto-fill');

        rerender(results({ results: threeResults, cardVariant: 'compact' }));

        expect(screen.getAllByRole('article').map((card) => card.getAttribute('data-card-variant'))).toEqual([
            'compact',
            'compact',
            'compact',
        ]);
        expect(screen.getByRole('list').className).toContain('grid-cols-2');
    });

    it('reports the selected recipe id upward', async () => {
        const user = userEvent.setup();
        const onSelectRecipe = vi.fn();
        renderResults({ results: threeResults, onSelectRecipe });

        await user.click(screen.getByRole('button', { name: 'Asparagus with Green Sauce' }));

        expect(onSelectRecipe).toHaveBeenCalledWith('rec_2');
    });

    it('renders source attribution only when the recipe has no author handle', () => {
        renderResults({ results: threeResults });

        expect(screen.getByText('From Serious Eats')).toBeTruthy();
        expect(screen.getByText('From Bon Appétit')).toBeTruthy();
        expect(screen.queryByText(/From undefined/u)).toBeNull();
    });

    it('shows the author as @handle in the card footer, and no fabricated 0 cal', () => {
        renderResults({
            results: [
                makeSearchResult({ id: 'rec_x', title: 'Ribollita', authorHandle: 'tuscan_cook', cuisine: 'Tuscan' }),
            ],
        });

        expect(screen.getByText('@tuscan_cook')).toBeTruthy();
        expect(screen.getByText('Tuscan')).toBeTruthy();
        expect(screen.queryByText('0 cal')).toBeNull();
        expect(screen.getByRole('button', { name: 'Save a copy of Ribollita' })).toBeTruthy();
    });

    it('renders each card’s nutrition from the host’s renderer, keyed by recipe id', () => {
        renderResults({ results: threeResults, renderNutrition: (id) => <span>{`kcal for ${id}`}</span> });

        expect(screen.getByText('kcal for rec_1')).toBeTruthy();
        expect(screen.getByText('kcal for rec_3')).toBeTruthy();
    });

    it('does not draw the count: the frame owns the one line that is also the live region', () => {
        renderResults({ results: threeResults, query: 'pasta', kind: 'query' });

        expect(screen.queryByText(/for “pasta”/u)).toBeNull();
    });
});

describe('RecipeDiscoveryResults (web) — load more (S4)', () => {
    it('renders a Load more button that fetches the next page when more pages exist', async () => {
        const user = userEvent.setup();
        const onLoadMore = vi.fn();
        renderResults({
            results: threeResults,
            loadMore: { hasMore: true, loading: false, onLoadMore, failed: false },
        });

        await user.click(screen.getByRole('button', { name: 'Load more' }));
        expect(onLoadMore).toHaveBeenCalledTimes(1);
    });

    it('⛔ a failed NEXT page keeps the loaded results and offers Try again beside the reason', async () => {
        const user = userEvent.setup();
        const onLoadMore = vi.fn();
        renderResults({ results: threeResults, loadMore: { hasMore: true, loading: false, failed: true, onLoadMore } });

        expect(screen.getByText('Mediterranean Grilled Lamb')).toBeTruthy();
        expect(screen.getByText('We couldn’t load more recipes.')).toBeTruthy();

        await user.click(screen.getByRole('button', { name: 'Try again' }));
        expect(onLoadMore).toHaveBeenCalledTimes(1);
    });

    /**
     * ⛔ The Load more control is the one just pressed when the next page starts loading, so it keeps focus: busy,
     * `aria-disabled`, never natively disabled (which drops focus to <body>), and a second press fetches nothing.
     */
    it('⛔ keeps Load more FOCUSABLE while the next page loads, and refuses a second fetch', async () => {
        const user = userEvent.setup();
        const onLoadMore = vi.fn();
        renderResults({ results: threeResults, loadMore: { hasMore: true, loading: true, onLoadMore, failed: false } });

        const control = screen.getByRole('button', { name: 'Loading…' });
        expect(control.getAttribute('aria-disabled')).toBe('true');
        expect(control.getAttribute('aria-busy')).toBe('true');
        expect(control.hasAttribute('disabled')).toBe(false);

        await user.click(control);
        expect(onLoadMore).not.toHaveBeenCalled();
    });

    it('hides the Load more button on the last page (no infinite scroll)', () => {
        renderResults({
            results: threeResults,
            loadMore: { hasMore: false, loading: false, onLoadMore: vi.fn(), failed: false },
        });

        expect(screen.queryByRole('button', { name: /Load more|Loading/ })).toBeNull();
    });

    it('gives the load-more action the 44px touch floor, reset for the mouse at md', () => {
        renderResults({
            results: threeResults,
            loadMore: { onLoadMore: noop, loading: false, hasMore: true, failed: false },
        });

        const control = screen.getByRole('button', { name: 'Load more' });
        expect(control.className).toContain('min-h-11');
        expect(control.className).toContain('md:min-h-0');
    });
});

describe('RecipeDiscoveryResults (web) — browse slot (U7)', () => {
    const browseSlot = <div>CURATED RAILS</div>;

    it('renders the browse slot, not the browse-empty copy, when the container supplies one', () => {
        renderResults({ browseSlot });

        expect(screen.getByText('CURATED RAILS')).toBeTruthy();
        expect(screen.queryByText('No public recipes yet.')).toBeNull();
    });

    it('takes precedence over the flat result body', () => {
        renderResults({ results: threeResults, browseSlot });

        expect(screen.getByText('CURATED RAILS')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Mediterranean Grilled Lamb' })).toBeNull();
    });
});

describe('RecipeDiscoveryResults (web) — Save a copy', () => {
    it('reports the recipe to copy upward', async () => {
        const user = userEvent.setup();
        const save = vi.fn();
        renderResults({ results: threeResults, saveCopy: { stateOf: () => ({ kind: 'idle' }), save } });

        await user.click(screen.getByRole('button', { name: 'Save a copy of Asparagus with Green Sauce' }));

        expect(save).toHaveBeenCalledExactlyOnceWith('rec_2');
    });

    it('shows each card its own copy state, leaving the others actionable', async () => {
        const user = userEvent.setup();
        const save = vi.fn();
        renderResults({
            results: threeResults,
            saveCopy: { stateOf: (id) => (id === 'rec_2' ? { kind: 'saving' } : { kind: 'idle' }), save },
        });

        const busy = screen.getByRole('button', { name: 'Saving a copy of Asparagus with Green Sauce' });

        expect(busy.getAttribute('aria-busy')).toBe('true');

        await user.click(busy);
        expect(save).not.toHaveBeenCalled();

        await user.click(screen.getByRole('button', { name: 'Save a copy of Gourmet Garden Salad' }));
        expect(save).toHaveBeenCalledExactlyOnceWith('rec_3');
    });
});

describe('RecipeDiscoveryResults (web) — newer results pending', () => {
    it('mounts the pending bar inside the results region while stale, without marking the results busy', () => {
        const { container } = renderResults({ results: threeResults, query: 'past', kind: 'query', stale: true });

        const region = resultsRegion(container);
        // The bar is absolutely placed, so the region must be its containing block or it floats to the page top.
        expect(region.className).toContain('relative');
        const bar = region.querySelector('.animate-pending-bar-reveal');
        expect(bar, 'the pending bar sits inside the results region').not.toBeNull();
        expect(bar?.getAttribute('aria-hidden')).toBe('true');
        // ⛔ Not `aria-busy`: JAWS hides busy content, and the previous results must stay readable (EVALUATE R1).
        expect(container.querySelector('[aria-busy="true"]')).toBeNull();
    });

    it('⛔ keeps the previous results readable and usable', async () => {
        const user = userEvent.setup();
        const onSelectRecipe = vi.fn();
        renderResults({ results: threeResults, query: 'past', kind: 'query', stale: true, onSelectRecipe });

        await user.click(screen.getByRole('button', { name: 'Gourmet Garden Salad' }));
        expect(onSelectRecipe).toHaveBeenCalledWith('rec_3');
    });

    it('draws the pending bar over the rails too while browsing results are being replaced', () => {
        const { container } = renderResults({ browseSlot: <div>CURATED RAILS</div>, stale: true });

        expect(resultsRegion(container).querySelector('.animate-pending-bar-reveal')).not.toBeNull();
        expect(within(resultsRegion(container)).getByText('CURATED RAILS')).toBeTruthy();
    });

    it('draws no bar once settled', () => {
        const { container } = renderResults({ results: threeResults });

        expect(container.querySelector('.animate-pending-bar-reveal')).toBeNull();
    });
});

describe('RecipeDiscoveryResults (web) — a failed refresh of the rows on screen', () => {
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
            browseSlot: <p>Browse rails</p>,
            refreshNotice: notice({ failed: true }),
        });

        expect(screen.getByText('Browse rails')).toBeTruthy();
        expect(screen.queryByText('We couldn’t refresh these results.')).toBeNull();
    });

    it('keeps the notice mounted while browsing, so its announcement region exists before the results return', () => {
        const { rerender } = renderResults({
            results: threeResults,
            browseSlot: <p>Browse rails</p>,
            refreshNotice: notice({ failed: true }),
        });
        const regionsWhileBrowsing = screen.queryAllByRole('status').length;

        rerender(results({ results: threeResults, refreshNotice: notice({ failed: true }) }));

        expect(regionsWhileBrowsing).toBeGreaterThan(0);
        expect(screen.getAllByText('We couldn’t refresh these results.').length).toBeGreaterThan(0);
    });
});
