// @vitest-environment jsdom
/**
 * Component tests for the web discovery RESULTS — what renders inside the discovery suspense boundary once the search
 * has settled: the browse rails (while browsing), the empty and no-match bodies, the counted and query-naming header,
 * the result grid with its clone actions and load-more control, the notice for a failed refresh, and the busy state
 * while newer results are pending.
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
import { RecipeDiscoveryResults } from '../RecipeDiscoveryResults.js';
import type { RecipeDiscoveryResultsProps } from '../model.js';

afterEach(cleanup);

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

/** The results region, located as assistive tech reaches it: a region named "Search results". */
function resultsRegion(_container: HTMLElement): HTMLElement {
    return screen.getByRole('region', { name: 'Search results' });
}

describe('RecipeDiscoveryResults (web) — empty and no-match', () => {
    it('shows the browse-empty copy, with neither a count nor rows, when nothing was searched', () => {
        renderResults();

        expect(screen.getByText('No recipes found')).toBeTruthy();
        expect(screen.queryByText('No matching recipes')).toBeNull();
        expect(screen.queryByText('0 recipes')).toBeNull();
        expect(screen.queryByRole('list')).toBeNull();
    });

    it('shows the no-match copy (NOT the browse-empty copy) when a search or filter matched nothing', () => {
        renderResults({ query: 'tiramisu', searching: true });

        expect(screen.getByText('No matching recipes')).toBeTruthy();
        expect(screen.queryByText('No recipes found')).toBeNull();
    });

    it('shows the no-match copy when only a filter (no term) matched nothing', () => {
        renderResults({ query: '', searching: true });

        expect(screen.getByText('No matching recipes')).toBeTruthy();
    });
});

describe('RecipeDiscoveryResults (web) — populated', () => {
    it('renders a pluralized result count when no query is typed', () => {
        renderResults({ results: threeResults });

        expect(screen.getByText('3 recipes')).toBeTruthy();
    });

    it('names the query the results belong to in the header (S5)', () => {
        renderResults({ results: threeResults, query: 'pasta', searching: true });

        expect(screen.getByText('Showing 3 recipes for “pasta”')).toBeTruthy();
    });

    it('renders one row per result in a list structure', () => {
        renderResults({ results: threeResults });

        expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(3);
        expect(screen.getByRole('button', { name: 'Mediterranean Grilled Lamb' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Asparagus with Green Sauce' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Gourmet Garden Salad' })).toBeTruthy();
    });

    it('reports the selected recipe id upward', async () => {
        const user = userEvent.setup();
        const onSelectRecipe = vi.fn();
        renderResults({ results: threeResults, onSelectRecipe });

        await user.click(screen.getByRole('button', { name: 'Asparagus with Green Sauce' }));

        expect(onSelectRecipe).toHaveBeenCalledWith('rec_2');
    });

    it('renders source attribution only when present', () => {
        renderResults({ results: threeResults });

        expect(screen.getByText('From Serious Eats')).toBeTruthy();
        expect(screen.getByText('From Bon Appétit')).toBeTruthy();
        expect(screen.queryByText(/From undefined/)).toBeNull();
    });

    // The `leadCaloriesPerServing` fixture line left with the field (ADR-0021's "Follow-up owed"), so what still has
    // teeth is that no fabricated `0 cal` renders; the figure's real states live in `RecipeCalorieChip.test.tsx`.
    it('composes the compound card fields — author handle, cuisine, visibility (S1), and no fabricated 0', () => {
        renderResults({
            results: [
                makeSearchResult({
                    id: 'rec_x',
                    title: 'Ribollita',
                    authorHandle: 'tuscan_cook',
                    cuisine: 'Tuscan',
                    visibility: 'public',
                    status: 'published',
                }),
            ],
        });

        expect(screen.getByText('by @tuscan_cook')).toBeTruthy();
        expect(screen.getByText('Tuscan')).toBeTruthy();
        expect(screen.queryByText('0 cal')).toBeNull();
        expect(screen.getByText('Public')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Ribollita' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Clone Ribollita' })).toBeTruthy();
    });

    it('renders each card’s nutrition from the host’s renderer, keyed by recipe id', () => {
        renderResults({ results: threeResults, renderNutrition: (id) => <span>{`kcal for ${id}`}</span> });

        expect(screen.getByText('kcal for rec_1')).toBeTruthy();
        expect(screen.getByText('kcal for rec_3')).toBeTruthy();
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
        expect(screen.queryByText('No recipes found')).toBeNull();
    });

    it('takes precedence over the flat result body', () => {
        renderResults({ results: threeResults, browseSlot });

        expect(screen.getByText('CURATED RAILS')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Mediterranean Grilled Lamb' })).toBeNull();
        expect(screen.queryByText('3 recipes')).toBeNull();
    });
});

describe('RecipeDiscoveryResults (web) — clone', () => {
    it('reports the cloned recipe id upward', async () => {
        const user = userEvent.setup();
        const onClone = vi.fn();
        renderResults({ results: threeResults, onClone });

        await user.click(screen.getByRole('button', { name: 'Clone Asparagus with Green Sauce' }));

        expect(onClone).toHaveBeenCalledWith('rec_2');
    });

    it('marks only the cloning row busy, leaving the others actionable', async () => {
        const user = userEvent.setup();
        const onClone = vi.fn();
        renderResults({ results: threeResults, cloningId: 'rec_2', onClone });

        const busy = screen.getByRole('button', { name: 'Cloning Asparagus with Green Sauce' });
        expect(busy.getAttribute('aria-busy')).toBe('true');
        // Busy is `aria-disabled` and stays focusable (native `disabled` drops focus — WCAG 2.2 SC 2.4.3).
        expect(busy.getAttribute('aria-disabled')).toBe('true');
        expect((busy as HTMLButtonElement).disabled).toBe(false);

        await user.click(busy);
        expect(onClone).not.toHaveBeenCalled();

        await user.click(screen.getByRole('button', { name: 'Clone Gourmet Garden Salad' }));
        expect(onClone).toHaveBeenCalledWith('rec_3');
    });
});

describe('RecipeDiscoveryResults (web) — newer results pending', () => {
    it('mounts the pending bar inside the results region while stale, without marking the results busy', () => {
        const { container } = renderResults({ results: threeResults, query: 'past', searching: true, stale: true });

        const region = resultsRegion(container);
        // The bar is absolutely placed, so the region must be its containing block or it floats to the page top.
        expect(region.className).toContain('relative');
        const bar = region.querySelector('.animate-pending-bar-reveal');
        expect(bar, 'the pending bar sits inside the results region').not.toBeNull();
        expect(bar?.getAttribute('aria-hidden')).toBe('true');
        // ⛔ Not `aria-busy`: JAWS hides busy content, and the previous results must stay readable (EVALUATE R1).
        expect(container.querySelector('[aria-busy="true"]')).toBeNull();
    });

    it('⛔ keeps the previous results readable and usable, still naming the query they belong to', async () => {
        const user = userEvent.setup();
        const onSelectRecipe = vi.fn();
        renderResults({ results: threeResults, query: 'past', searching: true, stale: true, onSelectRecipe });

        expect(screen.getByText('Showing 3 recipes for “past”')).toBeTruthy();
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
