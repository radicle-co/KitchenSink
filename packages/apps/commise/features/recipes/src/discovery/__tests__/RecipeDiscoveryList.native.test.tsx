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

    it('clears the 44pt touch floor on the retry action', () => {
        renderDiscovery({ status: 'error' });

        // Every other control on this leaf carries `minHeight: 44` (sort chips, load-more, the recent-search
        // rows, back-to-browse); the retry was a bare `Pressable` wrapping a `Text` — a ~20pt target.
        const retry = screen.getByRole('button', { name: 'Try again' });
        const surface = [retry, ...Array.from(retry.querySelectorAll<HTMLElement>('*'))].find(
            (node) => window.getComputedStyle(node).minHeight === '44px',
        );

        expect(surface, 'the retry action does not reach a 44pt target').toBeDefined();
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

/**
 * Resolve the value react-native-web actually APPLIED for a CSS property, by walking the element's atomic
 * `r-*` classes back to their compiled rules. `getComputedStyle` does not resolve these, and a `style`
 * attribute check would miss `StyleSheet.create` styles entirely — so this is the only honest read of the
 * geometry that ships. Mirrors the `appliedStyle` helper in `RecipeHero.native.test.tsx`.
 */
function appliedStyle(element: Element, property: string): string | undefined {
    const classNames = element.className.split(' ').filter((name) => name.startsWith('r-'));
    const sheets = document.styleSheets;
    let resolved: string | undefined;

    for (const className of classNames) {
        for (let sheetIndex = 0; sheetIndex < sheets.length; sheetIndex += 1) {
            const rules = sheets[sheetIndex]?.cssRules;

            for (let ruleIndex = 0; ruleIndex < (rules?.length ?? 0); ruleIndex += 1) {
                const rule = rules?.[ruleIndex];

                if (rule instanceof CSSStyleRule && rule.selectorText === `.${className}`) {
                    const value = rule.style.getPropertyValue(property);

                    if (value !== '') {
                        resolved = value;
                    }
                }
            }
        }
    }

    return resolved;
}

/** Whether `element` or any ancestor is a scroll container react-native-web actually made scrollable. */
function hasScrollableAncestor(element: Element): boolean {
    for (let node: Element | null = element; node !== null; node = node.parentElement) {
        const overflowY = appliedStyle(node, 'overflow-y');

        if (overflowY === 'auto' || overflowY === 'scroll') {
            return true;
        }
    }

    return false;
}

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

    // Regression (Maestro `discover-browse`/`search-navigation`): the browse surface — the DEFAULT state of
    // the Discover tab — is three curated rails plus cuisine shortcuts, which is far taller than a phone
    // viewport. It used to render as a bare fragment inside the screen's `flex: 1` container, so NOTHING
    // scrolled: Maestro swiped up 13 times without the surface moving, and the third rail ("Quick") plus the
    // cuisine shortcuts were unreachable on a device. The result state was always virtualized (FlashList) and
    // therefore fine; only browse was stranded.
    it('puts the browse slot in a scrollable container so content below the fold is reachable', () => {
        renderDiscovery({ status: 'ready', results: [], searchValue: '', browseSlot: <>{'CURATED RAILS'}</> });

        expect(hasScrollableAncestor(screen.getByText('CURATED RAILS'))).toBe(true);
    });

    it('keeps the browse surface rendered and scrollable when a refresh control is wired', () => {
        // `RefreshControl` itself is inert under jsdom (same limitation the result-state and `RecipeList`
        // pull-to-refresh tests document), so what is assertable here is that wiring it neither drops the
        // browse content nor costs it its scroll container. The gesture itself is a device/Maestro concern.
        renderDiscovery({
            status: 'ready',
            results: [],
            searchValue: '',
            browseSlot: <>{'CURATED RAILS'}</>,
            refresh: { refreshing: true, onRefresh: noop },
        });

        expect(hasScrollableAncestor(screen.getByText('CURATED RAILS'))).toBe(true);
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

describe('RecipeDiscoveryList (native) — recent searches (U7)', () => {
    const recent = { queries: ['risotto', 'pasta'], onSelect: noop, onClear: noop };

    /**
     * Focus the keyword field — the panel is an idle-state affordance, not always-on chrome. `focusIn` (not
     * `fireEvent.focus`) because React delegates `onFocus` to the BUBBLING `focusin` event; a bare,
     * non-bubbling `focus` event never reaches its listener and the field would silently stay unfocused.
     */
    function focusSearch(): void {
        fireEvent.focusIn(screen.getByLabelText('Search public recipes'));
    }

    it('renders nothing when the surface wires no recent-search memory', () => {
        renderDiscovery({ searchValue: '' });

        focusSearch();

        expect(screen.queryByLabelText('Recent searches')).toBeNull();
    });

    it('stays hidden until the keyword field is focused', () => {
        renderDiscovery({ searchValue: '', recentSearches: recent });

        expect(screen.queryByLabelText('Recent searches')).toBeNull();
    });

    it('lists the recent searches, newest first, once focused with a blank query', () => {
        renderDiscovery({ searchValue: '', recentSearches: recent });

        focusSearch();

        expect(screen.getByLabelText('Recent searches')).toBeTruthy();
        const options = screen.getAllByRole('button', { name: /^Search for/ });
        expect(options.map((option) => option.textContent)).toEqual(['risotto', 'pasta']);
    });

    it('stays hidden while a query is active, even when focused (that is the RESULT state, not idle)', () => {
        renderDiscovery({ searchValue: 'lamb', recentSearches: recent });

        focusSearch();

        expect(screen.queryByLabelText('Recent searches')).toBeNull();
    });

    it('renders no panel at all when the history is empty', () => {
        renderDiscovery({ searchValue: '', recentSearches: { ...recent, queries: [] } });

        focusSearch();

        expect(screen.queryByLabelText('Recent searches')).toBeNull();
    });

    it('reports the chosen recent search upward (so the container runs it)', () => {
        const onSelect = vi.fn();
        renderDiscovery({ searchValue: '', recentSearches: { ...recent, onSelect } });

        focusSearch();
        fireEvent.click(screen.getByRole('button', { name: 'Search for “pasta”' }));

        expect(onSelect).toHaveBeenCalledWith('pasta');
    });

    it('reports clear-all upward', () => {
        const onClear = vi.fn();
        renderDiscovery({ searchValue: '', recentSearches: { ...recent, onClear } });

        focusSearch();
        fireEvent.click(screen.getByRole('button', { name: 'Clear recent searches' }));

        expect(onClear).toHaveBeenCalledTimes(1);
    });

    it('hides again once the keyword field is blurred', () => {
        renderDiscovery({ searchValue: '', recentSearches: recent });

        focusSearch();
        expect(screen.getByLabelText('Recent searches')).toBeTruthy();

        fireEvent.focusOut(screen.getByLabelText('Search public recipes'));

        expect(screen.queryByLabelText('Recent searches')).toBeNull();
    });
});
