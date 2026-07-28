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
import userEvent from '@testing-library/user-event';
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

    it('reports search input changes upward', async () => {
        const user = userEvent.setup();
        const onSearchChange = vi.fn();
        renderDiscovery({ onSearchChange });

        // user.paste (not user.type): this is a controlled input backed by an inert vi.fn() — with no
        // state update between keystrokes, React's controlled-input value enforcement resets the DOM node
        // back to the unchanged `searchValue` prop after every keystroke, so char-by-char typing would
        // report 'l', 'a', 'm', 'b' as four separate single-character calls instead of the full string. A
        // paste fires one atomic input event carrying the whole value, sidestepping that test-harness
        // artifact (a real consumer re-renders with the updated value each keystroke, so this does not
        // reflect a production bug) while still exercising the same onChange wiring.
        const searchbox = screen.getByRole('searchbox');
        await user.click(searchbox);
        await user.paste('lamb');

        expect(onSearchChange).toHaveBeenCalledWith('lamb');
    });
});

describe('RecipeDiscoveryList (web) — loading state', () => {
    it('shows a busy status and no recipe rows', () => {
        renderDiscovery({ status: 'loading' });

        expect(screen.getByRole('status')).toBeTruthy();
        expect(screen.queryByRole('button', { name: /Grilled Lamb/ })).toBeNull();
    });

    it('announces the localized loading label as the live region CONTENT, not only its aria-label', () => {
        renderDiscovery({ status: 'loading' });

        // A `role="status"` node rendered EMPTY is doubly broken: it is zero-height (nothing for a sighted
        // viewer, and Playwright resolves it as `hidden`) AND it is silent, because a live region announces
        // its CONTENT, not its label. The label must therefore be the visible caption.
        expect(screen.getByRole('status').textContent).toContain('Loading recipes');
    });

    it('renders real shimmer skeleton cards (not blank spans) inside the busy region', () => {
        renderDiscovery({ status: 'loading' });

        // The old loading body was three EMPTY `<span>`s — a blank page while the query was in flight, where
        // the mockup shows a card skeleton grid (and native already paints one).
        const status = screen.getByRole('status');
        const shimmer = status.querySelectorAll('.animate-pulse');
        expect(shimmer.length).toBeGreaterThanOrEqual(3);
        // Every placeholder is decorative — the region's caption alone announces the wait.
        for (const node of Array.from(shimmer)) {
            expect(node.closest('[aria-hidden="true"]')).not.toBeNull();
        }
    });

    it('mirrors the populated grid column rhythm so the layout does not jump when results land', () => {
        renderDiscovery({ status: 'loading' });

        // Same 1 / sm:2 / lg:3 / xl:4 rhythm the populated `<ul>` uses — a skeleton on a different grid
        // reflows the whole page the moment the first page arrives.
        const skeletonGrid = screen.getByRole('status').querySelector('.grid');
        expect(skeletonGrid).not.toBeNull();
        for (const columnClass of ['grid-cols-1', 'sm:grid-cols-2', 'lg:grid-cols-3', 'xl:grid-cols-4']) {
            expect(skeletonGrid?.classList.contains(columnClass)).toBe(true);
        }
    });
});

describe('RecipeDiscoveryList (web) — error state', () => {
    it('shows an alert with a retry action that reports upward', async () => {
        const user = userEvent.setup();
        const onRetry = vi.fn();
        renderDiscovery({ status: 'error', onRetry });

        expect(screen.getByRole('alert')).toBeTruthy();

        await user.click(screen.getByRole('button', { name: 'Try again' }));
        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('renders the failure as a styled card surface, not bare unstyled text', () => {
        renderDiscovery({ status: 'error' });

        // Same card treatment every sibling web surface uses for a settled failure (see
        // `CollectionRecipePicker`): a rounded card on the `card` surface with a shadow, so the error reads as
        // a deliberate state rather than a stray line of text on a blank page.
        const alert = screen.getByRole('alert');
        expect(alert.textContent).toContain('We couldn’t load recipes.');
        for (const surfaceClass of ['rounded-2xl', 'bg-card', 'shadow-sm']) {
            expect(alert.classList.contains(surfaceClass)).toBe(true);
        }
    });

    it('gives the retry action real control styling (a pill, not a bare button)', () => {
        renderDiscovery({ status: 'error' });

        const retry = screen.getByRole('button', { name: 'Try again' });
        expect(retry.classList.contains('rounded-full')).toBe(true);
        expect(retry.classList.contains('font-semibold')).toBe(true);
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

    it('renders the sort control with the active option checked and reports a change (S3)', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        renderDiscovery({
            status: 'ready',
            results: threeResults,
            sort: { active: RecipeSearchSortBy.RELEVANCE, onChange },
        });

        const group = screen.getByRole('radiogroup', { name: 'Sort by' });
        expect(within(group).getByRole('radio', { name: 'Relevance' }).getAttribute('aria-checked')).toBe('true');
        expect(within(group).getByRole('radio', { name: 'Quickest' }).getAttribute('aria-checked')).toBe('false');

        await user.click(within(group).getByRole('radio', { name: 'Quickest' }));
        expect(onChange).toHaveBeenCalledWith('quickest');
    });

    it('renders no sort control when no sort prop is given', () => {
        renderDiscovery({ status: 'ready', results: threeResults });

        expect(screen.queryByRole('radiogroup', { name: 'Sort by' })).toBeNull();
    });

    it('renders a Load more button that fetches the next page when more pages exist (S4)', async () => {
        const user = userEvent.setup();
        const onLoadMore = vi.fn();
        renderDiscovery({
            status: 'ready',
            results: threeResults,
            loadMore: { hasMore: true, loading: false, onLoadMore },
        });

        await user.click(screen.getByRole('button', { name: 'Load more' }));
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

    it('reports the selected recipe id upward', async () => {
        const user = userEvent.setup();
        const onSelectRecipe = vi.fn();
        renderDiscovery({ status: 'ready', results: threeResults, onSelectRecipe });

        await user.click(screen.getByRole('button', { name: 'Asparagus with Green Sauce' }));

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

describe('RecipeDiscoveryList (web) — browse slot (U7)', () => {
    const browseSlot = <div>CURATED RAILS</div>;

    it('renders the browse slot (not a bare search) when no query/filter is active', () => {
        renderDiscovery({ status: 'ready', results: [], searchValue: '', browseSlot });

        expect(screen.getByText('CURATED RAILS')).toBeTruthy();
        // The browse-empty copy must NOT show — the rails ARE the browse experience.
        expect(screen.queryByText('No recipes found')).toBeNull();
    });

    it('surfaces a FAILURE while browsing, with the retry, instead of swallowing it', async () => {
        const user = userEvent.setup();
        const onRetry = vi.fn();
        renderDiscovery({ status: 'error', results: [], searchValue: '', browseSlot, onRetry });

        // Browsing is the DEFAULT state of /discover, so a browse branch that outranks `status` makes the
        // error body — and the only "Try again" this surface has — unreachable on the surface's own default.
        // Observed live: /discover settled with no retry at all while /recipes offered one on the same load.
        expect(screen.getByRole('alert').textContent).toContain('We couldn’t load recipes.');
        await user.click(screen.getByRole('button', { name: 'Try again' }));
        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('shows the loading skeleton while browsing, not curated rails with no data behind them', () => {
        renderDiscovery({ status: 'loading', results: [], searchValue: '', browseSlot });

        expect(screen.getByRole('status', { name: 'Loading recipes' })).toBeTruthy();
        expect(screen.queryByText('CURATED RAILS')).toBeNull();
    });

    it('returns to the browse slot once the load settles', () => {
        renderDiscovery({ status: 'ready', results: [], searchValue: '', browseSlot });

        expect(screen.getByText('CURATED RAILS')).toBeTruthy();
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('takes precedence over the flat result body while browsing', () => {
        renderDiscovery({ status: 'ready', results: threeResults, searchValue: '', browseSlot });

        expect(screen.getByText('CURATED RAILS')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Mediterranean Grilled Lamb' })).toBeNull();
    });

    it('shows the result list (not the browse slot) once a query is active', () => {
        renderDiscovery({ status: 'ready', results: threeResults, searchValue: 'lamb', browseSlot });

        expect(screen.queryByText('CURATED RAILS')).toBeNull();
        expect(screen.getByRole('button', { name: 'Mediterranean Grilled Lamb' })).toBeTruthy();
    });

    it('shows the result list (not the browse slot) once a filter is active', () => {
        renderDiscovery({ status: 'ready', results: threeResults, hasActiveFilters: true, browseSlot });

        expect(screen.queryByText('CURATED RAILS')).toBeNull();
        expect(screen.getByRole('button', { name: 'Mediterranean Grilled Lamb' })).toBeTruthy();
    });

    it('hides the sort control while browsing', () => {
        renderDiscovery({
            status: 'ready',
            searchValue: '',
            browseSlot,
            sort: { active: RecipeSearchSortBy.RELEVANCE, onChange: noop },
        });

        expect(screen.queryByRole('radiogroup', { name: 'Sort by' })).toBeNull();
    });

    it('renders a back-to-browse action in the result list and reports it', async () => {
        const user = userEvent.setup();
        const onExitToBrowse = vi.fn();
        renderDiscovery({ status: 'ready', results: threeResults, searchValue: '', onExitToBrowse });

        await user.click(screen.getByRole('button', { name: 'Back to browse' }));

        expect(onExitToBrowse).toHaveBeenCalledTimes(1);
    });
});

describe('RecipeDiscoveryList (web) — clone', () => {
    it('reports the cloned recipe id upward', async () => {
        const user = userEvent.setup();
        const onClone = vi.fn();
        renderDiscovery({ status: 'ready', results: threeResults, onClone });

        await user.click(screen.getByRole('button', { name: 'Clone Asparagus with Green Sauce' }));

        expect(onClone).toHaveBeenCalledWith('rec_2');
    });

    it('marks only the cloning row busy and disabled, leaving the others actionable', async () => {
        const user = userEvent.setup();
        const onClone = vi.fn();
        renderDiscovery({ status: 'ready', results: threeResults, cloningId: 'rec_2', onClone });

        const busy = screen.getByRole('button', { name: 'Cloning Asparagus with Green Sauce' });
        expect(busy.getAttribute('aria-busy')).toBe('true');
        expect((busy as HTMLButtonElement).disabled).toBe(true);

        // A disabled busy row must not re-fire clone. userEvent respects the native `disabled` state
        // (matching real browsers), so this click is a documented no-op rather than a thrown error.
        await user.click(busy);
        expect(onClone).not.toHaveBeenCalled();

        // Sibling rows are still cloneable.
        expect(screen.getByRole('button', { name: 'Clone Mediterranean Grilled Lamb' })).toBeTruthy();
        await user.click(screen.getByRole('button', { name: 'Clone Gourmet Garden Salad' }));
        expect(onClone).toHaveBeenCalledWith('rec_3');
    });
});

describe('RecipeDiscoveryList (web) — recent searches (U7)', () => {
    const recent = { queries: ['risotto', 'pasta'], onSelect: noop, onClear: noop };

    /** Focus the search field — the panel is an idle-state affordance, not always-on chrome. */
    async function focusSearch(user: ReturnType<typeof userEvent.setup>): Promise<void> {
        await user.click(screen.getByRole('searchbox', { name: 'Search public recipes' }));
    }

    it('renders nothing when the surface wires no recent-search memory', async () => {
        const user = userEvent.setup();
        renderDiscovery({ searchValue: '' });

        await focusSearch(user);

        expect(screen.queryByRole('region', { name: 'Recent searches' })).toBeNull();
    });

    it('stays hidden until the search field is focused', () => {
        renderDiscovery({ searchValue: '', recentSearches: recent });

        expect(screen.queryByRole('region', { name: 'Recent searches' })).toBeNull();
    });

    it('lists the recent searches, newest first, once focused with a blank query', async () => {
        const user = userEvent.setup();
        renderDiscovery({ searchValue: '', recentSearches: recent });

        await focusSearch(user);

        const panel = screen.getByRole('region', { name: 'Recent searches' });
        const options = within(panel).getAllByRole('button', { name: /^Search for/ });
        expect(options.map((option) => option.textContent)).toEqual(['risotto', 'pasta']);
    });

    it('stays hidden while a query is active, even when focused (that is the RESULT state, not idle)', async () => {
        const user = userEvent.setup();
        renderDiscovery({ searchValue: 'lamb', recentSearches: recent });

        await focusSearch(user);

        expect(screen.queryByRole('region', { name: 'Recent searches' })).toBeNull();
    });

    it('stays hidden when a FILTER is active with a blank query — also the RESULT state, not idle', async () => {
        // The blank query is what made this slip: the panel gated on `searchValue` being empty, but the
        // surface's own definition of idle is `!searching`, and `searching` is query OR filters. So a
        // filter applied from the sheet (which leaves the query blank) left the idle-only panel drawn over
        // the result list. On a phone it covers the middle of the screen — the Maestro flow could no longer
        // scroll the results at all, and a real user would have the same problem.
        const user = userEvent.setup();
        renderDiscovery({ searchValue: '', hasActiveFilters: true, recentSearches: recent });

        await focusSearch(user);

        expect(screen.queryByRole('region', { name: 'Recent searches' })).toBeNull();
    });

    it('renders no panel at all when the history is empty', async () => {
        const user = userEvent.setup();
        renderDiscovery({ searchValue: '', recentSearches: { ...recent, queries: [] } });

        await focusSearch(user);

        expect(screen.queryByRole('region', { name: 'Recent searches' })).toBeNull();
    });

    it('reports the chosen recent search upward (so the container runs it)', async () => {
        const user = userEvent.setup();
        const onSelect = vi.fn();
        renderDiscovery({ searchValue: '', recentSearches: { ...recent, onSelect } });

        await focusSearch(user);
        // Clicking a suggestion moves focus INTO the panel: if a blur handler tore the panel down first,
        // this click would never land — the regression this asserts.
        await user.click(screen.getByRole('button', { name: 'Search for “pasta”' }));

        expect(onSelect).toHaveBeenCalledWith('pasta');
    });

    it('reports clear-all upward', async () => {
        const user = userEvent.setup();
        const onClear = vi.fn();
        renderDiscovery({ searchValue: '', recentSearches: { ...recent, onClear } });

        await focusSearch(user);
        await user.click(screen.getByRole('button', { name: 'Clear recent searches' }));

        expect(onClear).toHaveBeenCalledTimes(1);
    });

    it('gives the clear control the 44px touch floor, reset for the mouse at md', async () => {
        const user = userEvent.setup();
        renderDiscovery({ searchValue: '', recentSearches: recent });

        await focusSearch(user);

        // The native leaf already carries `minHeight: 44` on this row (`styles.recentClear`); the web leaf had
        // `px-2 py-1` and nothing else, i.e. a ~24px target — well under the floor the rest of the app holds.
        const clear = screen.getByRole('button', { name: 'Clear recent searches' });
        expect(clear.className).toContain('min-h-11');
        expect(clear.className).toContain('md:min-h-0');
    });

    it('gives every recent-search row the 44px touch floor, reset for the mouse at md', async () => {
        const user = userEvent.setup();
        renderDiscovery({ searchValue: '', recentSearches: recent });

        await focusSearch(user);

        const panel = screen.getByRole('region', { name: 'Recent searches' });
        for (const option of within(panel).getAllByRole('button', { name: /^Search for/ })) {
            expect(option.className).toContain('min-h-11');
            expect(option.className).toContain('md:min-h-0');
        }
    });

    it('hides again once focus leaves the search area entirely', async () => {
        const user = userEvent.setup();
        renderDiscovery({ status: 'ready', results: threeResults, searchValue: '', recentSearches: recent });

        await focusSearch(user);
        expect(screen.getByRole('region', { name: 'Recent searches' })).toBeTruthy();

        await user.click(screen.getByRole('button', { name: 'Clone Asparagus with Green Sauce' }));

        expect(screen.queryByRole('region', { name: 'Recent searches' })).toBeNull();
    });
});

describe('RecipeDiscoveryList (web) — touch targets (44px floor)', () => {
    /**
     * Every interactive control on this surface must clear the 44px floor the rest of the app was raised to
     * (`min-h-11` at base, reset at `md:` for the mouse density — the `@commise/ui` Button recipe's own
     * treatment). The native leaf already carries `minHeight: 44` on its equivalents, so a web control without
     * the floor is also a cross-platform parity break.
     */
    function expectTouchFloor(control: HTMLElement, what: string): void {
        expect(control.className, `${what} has no 44px touch floor`).toContain('min-h-11');
        expect(control.className, `${what} does not reset the floor for the mouse`).toContain('md:min-h-0');
    }

    it('gives the error state’s retry action the floor', () => {
        renderDiscovery({ status: 'error' });

        expectTouchFloor(screen.getByRole('button', { name: 'Try again' }), 'retry');
    });

    it('gives the load-more action the floor', () => {
        renderDiscovery({
            status: 'ready',
            results: threeResults,
            searchValue: 'lamb',
            loadMore: { onLoadMore: noop, loading: false, hasMore: true },
        });

        expectTouchFloor(screen.getByRole('button', { name: 'Load more' }), 'load more');
    });

    it('gives the back-to-browse action the floor', () => {
        renderDiscovery({ status: 'ready', results: [], searchValue: 'lamb', onExitToBrowse: noop });

        expectTouchFloor(screen.getByRole('button', { name: 'Back to browse' }), 'back to browse');
    });

    it('gives every sort option the floor', () => {
        renderDiscovery({
            status: 'ready',
            results: threeResults,
            searchValue: 'lamb',
            sort: { active: RecipeSearchSortBy.RELEVANCE, onChange: noop },
        });

        const group = screen.getByRole('radiogroup', { name: 'Sort by' });
        for (const option of within(group).getAllByRole('radio')) {
            expectTouchFloor(option, `sort option ${option.textContent ?? ''}`);
        }
    });
});
