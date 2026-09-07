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

import { computedContrast, placeholderContrast } from '@commise/test-utils';
import { palette } from '@commise/ui';

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

/** The source switcher's destinations. Native ignores them (no URLs) — see the control's JSDoc. */
const HREF = { mine: '/en/recipes', community: '/en/discover' } as const;

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

describe('RecipeDiscoveryList (native) — source switcher (L5)', () => {
    // Parity with the web leaf: a host that composes this surface without a shell tab bar must still offer the
    // way back. (Mobile's recipe shell owns its own switcher, so the app passes no `tab` — hence the first
    // case.) The strip's own contract lives in `../../list/__tests__/RecipeSourceTabs.native.test.tsx`.
    it('renders no source switcher when no tab prop is given (the shell owns it on mobile)', () => {
        renderDiscovery({ status: 'ready', results: threeResults });

        expect(screen.queryByLabelText('Recipe source')).toBeNull();
    });

    it('offers a way BACK to My Recipes, with Community marked as the current source', () => {
        const onChange = vi.fn();
        renderDiscovery({
            status: 'ready',
            results: threeResults,
            tab: { active: 'community', href: HREF, onChange },
        });

        expect(screen.getByRole('tab', { name: 'Community' }).getAttribute('aria-selected')).toBe('true');
        fireEvent.click(screen.getByRole('tab', { name: 'My Recipes' }));

        expect(onChange).toHaveBeenCalledWith('mine');
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

    // Same move as the web leaf, including its second narrowing: the `leadCaloriesPerServing: 320` fixture
    // line is gone because the field has left the wire `Recipe` (ADR-0021's "Follow-up owed"), so the
    // "320 cal" assertion could no longer fail for any implementation. The no-fabricated-`0` assertion
    // still can. The figure's states are covered by `nutrition/__tests__/RecipeCalorieChip.native.test.tsx`.
    it('composes the compound card fields — author handle, cuisine (S1), and no fabricated 0', () => {
        renderDiscovery({
            status: 'ready',
            results: [
                makeSearchResult({
                    id: 'rec_x',
                    title: 'Ribollita',
                    authorHandle: 'tuscan_cook',
                    cuisine: 'Tuscan',
                }),
            ],
        });

        expect(screen.getByText('by @tuscan_cook')).toBeTruthy();
        expect(screen.getByText('Tuscan')).toBeTruthy();
        expect(screen.queryByText('0 cal')).toBeNull();
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

    /**
     * The SAME react-native-web gap as the sort radios below (#123), on this leaf's other `accessibilityState`
     * key: `busy` is projected to no DOM attribute either, so the in-flight load-more control announced nothing
     * beyond its own relabel. `aria-busy` is RN's own first-class ALIAS for `accessibilityState.busy`
     * (`ViewAccessibility.d.ts`), so it is device-correct too; the `|| undefined` shape (matching
     * `PressScale.native` and `AccountEraseDialog.native`) omits it while idle, since ARIA already defaults
     * `aria-busy` to false.
     */
    it('marks the load-more control busy in the DOM while the next page is in flight', () => {
        renderDiscovery({
            status: 'ready',
            results: threeResults,
            loadMore: { hasMore: true, loading: true, onLoadMore: noop },
        });

        const loadMore = screen.getByRole('button', { name: 'Loading…' });
        expect(loadMore.getAttribute('aria-busy')).toBe('true');
        expect(loadMore.getAttribute('aria-disabled')).toBe('true');
    });

    it('leaves the load-more control unmarked while idle', () => {
        renderDiscovery({
            status: 'ready',
            results: threeResults,
            loadMore: { hasMore: true, loading: false, onLoadMore: noop },
        });

        expect(screen.getByRole('button', { name: 'Load more' }).getAttribute('aria-busy')).toBeNull();
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

    /**
     * The sort strip's SELECTED option has to reach assistive tech on the mobile-WEB build too, and
     * `accessibilityState={{ checked }}` alone does not get there (#123).
     *
     * react-native-web 0.20.0 forwards literal `aria-*` props but projects `accessibilityState` for NOTHING
     * (its sole consumer in the package, `AccessibilityUtil/isDisabled`, reads the LEGACY
     * `accessibilityStates` array), so every chip rendered `<button role="radio">` with no state attribute at
     * all. On a radio that is the whole meaning of the control: a `radiogroup` of four radios, none of which
     * reports a checked state, tells a screen-reader user nothing about which sort is in force — and the only
     * other signal this leaf gives (`sortChipActive`'s fill) is COLOUR, which is sighted-only and would itself
     * be an SC 1.4.1 failure as the sole channel.
     *
     * `aria-checked` is the correct attribute for `role="radio"` — not `aria-selected` (ARIA supports that
     * only on `option`/`tab`/`row`/`gridcell`-family roles) and not `aria-pressed` (a toggle-BUTTON attribute,
     * which is what the #114 `selected` chips correctly took). `accessibilityState` stays alongside it because
     * RN reverse-maps `aria-checked` into `accessibilityState.checked`, so the device keeps its native trait.
     */
    it('marks the ACTIVE sort option checked and every other one unchecked (present-and-false)', () => {
        renderDiscovery({
            status: 'ready',
            results: threeResults,
            sort: { active: RecipeSearchSortBy.MOST_CLONED, onChange: noop },
        });

        const states = within(screen.getByRole('radiogroup', { name: 'Sort by' }))
            .getAllByRole('radio')
            .map((radio) => [radio.textContent, radio.getAttribute('aria-checked')]);

        // Present-and-false on the three inactive options, not absent: an omitted `aria-checked` makes a radio
        // stateless, so a reader cannot tell "not this one" from "unknown".
        expect(states).toEqual([
            ['Relevance', 'false'],
            ['Newest', 'false'],
            ['Most cloned', 'true'],
            ['Quickest', 'false'],
        ]);
    });

    it('moves the checked state when a different sort becomes active', () => {
        // Mutation guard: a hard-coded `aria-checked` — or one wired to the wrong option — cannot satisfy both
        // this and the case above.
        renderDiscovery({
            status: 'ready',
            results: threeResults,
            sort: { active: RecipeSearchSortBy.QUICKEST, onChange: noop },
        });

        const checked = within(screen.getByRole('radiogroup', { name: 'Sort by' }))
            .getAllByRole('radio')
            .filter((radio) => radio.getAttribute('aria-checked') === 'true')
            .map((radio) => radio.textContent);

        expect(checked).toEqual(['Quickest']);
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

    it('surfaces a FAILURE while browsing, with the retry, instead of swallowing it', () => {
        const onRetry = vi.fn();
        renderDiscovery({
            status: 'error',
            results: [],
            searchValue: '',
            browseSlot: <>{'CURATED RAILS'}</>,
            onRetry,
        });

        // Browsing is the DEFAULT state of Discover, so a browse branch that outranks `status` makes the
        // error body — and the only retry this surface has — unreachable on the surface's own default.
        expect(screen.getByRole('alert')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('shows the loading skeleton while browsing, not curated rails with no data behind them', () => {
        renderDiscovery({ status: 'loading', results: [], searchValue: '', browseSlot: <>{'CURATED RAILS'}</> });

        expect(screen.getByLabelText('Loading recipes')).toBeTruthy();
        expect(screen.queryByText('CURATED RAILS')).toBeNull();
    });

    it('returns to the browse slot once the load settles', () => {
        renderDiscovery({ status: 'ready', results: [], searchValue: '', browseSlot: <>{'CURATED RAILS'}</> });

        expect(screen.getByText('CURATED RAILS')).toBeTruthy();
        expect(screen.queryByRole('alert')).toBeNull();
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

    it('stays hidden when a FILTER is active with a blank query — also the RESULT state, not idle', () => {
        // The blank query is what made this slip: the panel gated on `searchValue` being empty, but the
        // surface's own definition of idle is `!searching`, and `searching` is query OR filters. Applying a
        // filter from the sheet leaves the query blank, so the idle-only panel stayed drawn over the result
        // list — covering the middle of a phone screen, where a swipe to scroll the results lands.
        renderDiscovery({ searchValue: '', hasActiveFilters: true, recentSearches: recent });

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

describe('RecipeDiscoveryList (native) — text contrast (WCAG 2.1 AA)', () => {
    /**
     * The native mirror of the web leaf's contrast contract. `seafoam` as a FOREGROUND misses the 4.5:1
     * SC 1.4.3 floor these labels owe — 4.02:1 on the recent-search panel's white card, 3.73:1 on the screen's
     * `sand` background — and the palette JSDoc in `@commise/ui`'s `tokens/colors.ts` states once where it
     * stays and where `ocean-dark` takes over.
     *
     * `computedContrast` reads the leaf's colour back off the atomic CSS react-native-web compiled, rather
     * than comparing it to a token spelling: an equality check would still pass if the palette re-themed the
     * token to near-white, a ratio cannot. Neither leaf paints a tint of its own, so the surface is the opaque
     * colour its container spells (`recentPanel` → `palette.white`; the screen container → `palette.sand`).
     */
    it('keeps the clear-recent-searches label legible on the recent-search panel', () => {
        renderDiscovery({ searchValue: '', recentSearches: { queries: ['risotto'], onSelect: noop, onClear: noop } });
        fireEvent.focusIn(screen.getByLabelText('Search public recipes'));

        const label = within(screen.getByRole('button', { name: 'Clear recent searches' })).getByText('Clear');
        expect(
            computedContrast(label, { surface: palette.white }),
            'clear-recent label on the white recent-search panel',
        ).toBeGreaterThanOrEqual(4.5);
    });

    it('keeps the back-to-browse label legible on the screen background', () => {
        renderDiscovery({ status: 'ready', results: threeResults, searchValue: 'lamb', onExitToBrowse: noop });

        const label = within(screen.getByRole('button', { name: 'Back to browse' })).getByText('Back to browse');
        expect(
            computedContrast(label, { surface: palette.sand }),
            'back-to-browse label on the sand screen background',
        ).toBeGreaterThanOrEqual(4.5);
    });

    it('keeps the search field’s PLACEHOLDER text legible on the field', () => {
        renderDiscovery({ searchValue: '' });

        // Placeholder copy is TEXT a reader reads — the field's only visible instruction before they type — so
        // it owes the 4.5:1 of SC 1.4.3; `placeholderTextColor={palette.mist}` measured 1.90:1 on the white
        // field. `placeholderContrast` reads the colour react-native-web actually paints, so this fails if the
        // token drifts AND if the prop stops being passed.
        expect(
            placeholderContrast(screen.getByLabelText('Search public recipes'), { surface: palette.sand }),
            'discovery search placeholder on its white field',
        ).toBeGreaterThanOrEqual(4.5);
    });
});
