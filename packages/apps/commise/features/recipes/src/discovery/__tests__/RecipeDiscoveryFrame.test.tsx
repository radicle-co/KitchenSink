// @vitest-environment jsdom
/**
 * The web discovery FRAME — the chrome that renders outside the discovery suspense boundary
 * (`docs/design/uiOverhaul/buildSpec.md` §3.3, §4.4, §4.5): the large title, the search field with its recent-search
 * panel, the filters (a sticky panel beside the results at a 960 container, otherwise a Filters button, the applied-filter
 * chips and the sheet), the sort, back-to-browse, and the ONE line that is both the visible result count and the polite
 * live region. Whatever the boundary renders below it arrives as `children`.
 *
 * ⚠️ REWRITTEN for slice 5. The frame used to take a `filterSlot` and draw sort as a row of radio chips, kept the count in
 * a visually hidden region and had a raw `<input>`. It now takes the filters as a discriminated union (a panel, or a
 * trigger + applied chips + sheet — never both), draws the design-system `SearchField`, shows the count line that is also
 * the live region, and its sort is a menu. The placeholder-contrast, focus-ring and touch-floor-by-class assertions are
 * deleted with the raw `<input>` and bespoke buttons they measured: those are the design system's own tests' now. The
 * heading, recent-searches, back-to-browse and announcement assertions are kept.
 */
import { RecipeSearchSortBy } from '@kitchensink/recipe-core';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@commise/i18n/react';

import { RecipeDiscoveryFrame } from '../RecipeDiscoveryFrame.js';
import type { RecipeDiscoveryFrameProps } from '../model.js';

afterEach(cleanup);

const noop = () => undefined;

const SHEET_FILTERS: NonNullable<RecipeDiscoveryFrameProps['filters']> = {
    presentation: 'sheet',
    trigger: <button type="button">FILTERS TRIGGER</button>,
    applied: <p>APPLIED CHIPS</p>,
    sheet: <p>FILTER SHEET</p>,
};

const PANEL_FILTERS: NonNullable<RecipeDiscoveryFrameProps['filters']> = {
    presentation: 'panel',
    panel: <aside aria-label="Filters">FILTER PANEL</aside>,
};

function frame(overrides: Partial<RecipeDiscoveryFrameProps> = {}) {
    return (
        <LocaleProvider locale="en">
            <RecipeDiscoveryFrame
                searchValue=""
                onSearchChange={noop}
                searching={false}
                headingFocusSignal={0}
                filters={SHEET_FILTERS}
                {...overrides}
            >
                {overrides.children ?? <button type="button">boundary content</button>}
            </RecipeDiscoveryFrame>
        </LocaleProvider>
    );
}

function renderFrame(overrides: Partial<RecipeDiscoveryFrameProps> = {}) {
    return render(frame(overrides));
}

const before = (earlier: HTMLElement, later: HTMLElement): boolean =>
    (earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

describe('RecipeDiscoveryFrame (web) — chrome', () => {
    it('renders the heading “Discover”, the search field and whatever the boundary renders below it', () => {
        renderFrame();

        expect(screen.getByRole('heading', { level: 1, name: 'Discover' })).toBeTruthy();
        expect(screen.getByRole('searchbox', { name: 'Search recipes' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'boundary content' })).toBeTruthy();
    });

    it('reflects the controlled search value, and reports changes upward', async () => {
        const user = userEvent.setup();
        const onSearchChange = vi.fn();
        renderFrame({ searchValue: 'risotto', onSearchChange });

        expect(screen.getByRole<HTMLInputElement>('searchbox').value).toBe('risotto');

        await user.click(screen.getByRole('searchbox'));
        await user.paste('lamb');

        expect(onSearchChange).toHaveBeenCalledWith('risottolamb');
    });

    it('clears the field from its own clear control', async () => {
        const user = userEvent.setup();
        const onSearchChange = vi.fn();
        renderFrame({ searchValue: 'risotto', onSearchChange });

        await user.click(screen.getByRole('button', { name: 'Clear search' }));

        expect(onSearchChange).toHaveBeenCalledWith('');
    });

    it('is the page’s one H1 with the avatar the app supplies as its action, even over a failed body', () => {
        renderFrame({
            headerAction: { kind: 'avatar', avatar: <button type="button">Profile</button> },
            children: <div role="alert">load failed</div>,
        });

        expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
        expect(screen.getByRole('heading', { level: 1 }).id).toBe('discover-title');
        expect(screen.getByRole('button', { name: 'Profile' })).toBeTruthy();
        expect(screen.getByRole('alert')).toBeTruthy();
    });

    it('draws no source switcher: Discover is a tab of its own', () => {
        renderFrame();

        expect(screen.queryByRole('navigation', { name: 'Recipe source' })).toBeNull();
    });
});

describe('RecipeDiscoveryFrame (web) — filters', () => {
    it('in the sheet presentation: the trigger, the applied chips and the sheet — and no panel', () => {
        renderFrame({ filters: SHEET_FILTERS });

        expect(screen.getByRole('button', { name: 'FILTERS TRIGGER' })).toBeTruthy();
        expect(screen.getByText('APPLIED CHIPS')).toBeTruthy();
        expect(screen.getByText('FILTER SHEET')).toBeTruthy();
        expect(screen.queryByText('FILTER PANEL')).toBeNull();
    });

    it('in the panel presentation: the panel beside the results — and no trigger, no applied chips, no sheet', () => {
        renderFrame({ filters: PANEL_FILTERS });

        expect(screen.getByRole('complementary', { name: 'Filters' })).toBeTruthy();
        expect(screen.queryByText('FILTERS TRIGGER')).toBeNull();
        expect(screen.queryByText('APPLIED CHIPS')).toBeNull();
        expect(screen.queryByText('FILTER SHEET')).toBeNull();
    });

    it('draws the facets once whichever presentation it is in', () => {
        const { rerender } = renderFrame({ filters: SHEET_FILTERS });
        expect(screen.getAllByText(/FILTER (PANEL|SHEET)/u)).toHaveLength(1);

        rerender(frame({ filters: PANEL_FILTERS }));
        expect(screen.getAllByText(/FILTER (PANEL|SHEET)/u)).toHaveLength(1);
    });

    it('the sheet presentation reads: search, then the trigger, then the applied chips, then the results', () => {
        renderFrame({ filters: SHEET_FILTERS });
        const search = screen.getByRole('searchbox');
        const trigger = screen.getByRole('button', { name: 'FILTERS TRIGGER' });
        const applied = screen.getByText('APPLIED CHIPS');
        const results = screen.getByRole('button', { name: 'boundary content' });

        expect(before(search, trigger)).toBe(true);
        expect(before(trigger, applied)).toBe(true);
        expect(before(applied, results)).toBe(true);
    });

    it('the panel presentation puts the panel before the search field, which sits above the results beside it', () => {
        renderFrame({ filters: PANEL_FILTERS });
        const panel = screen.getByRole('complementary');
        const search = screen.getByRole('searchbox');
        const results = screen.getByRole('button', { name: 'boundary content' });

        expect(before(panel, search)).toBe(true);
        expect(before(search, results)).toBe(true);
    });

    it('draws no filters when none are given', () => {
        renderFrame({ filters: undefined });

        expect(screen.queryByText(/FILTER/u)).toBeNull();
    });
});

describe('RecipeDiscoveryFrame (web) — sort (S3)', () => {
    it('renders the sort menu with the sort in use on its button and reports a change', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        renderFrame({ searching: true, sort: { active: RecipeSearchSortBy.RELEVANCE, onChange } });

        await user.click(screen.getByRole('button', { name: 'Sort: Relevance' }));
        await user.click(await screen.findByRole('menuitemradio', { name: 'Quickest' }));

        expect(onChange).toHaveBeenCalledWith('quickest');
    });

    it('renders no sort when none is given (the container omits it while browsing)', () => {
        renderFrame();

        expect(screen.queryByRole('button', { name: /^Sort:/u })).toBeNull();
    });

    it('sits at the end of the Filters row in the sheet presentation, and at the end of the count line in the panel one', () => {
        const sort = { active: RecipeSearchSortBy.RELEVANCE, onChange: noop };
        const { rerender } = renderFrame({
            filters: SHEET_FILTERS,
            sort,
            resultsSummary: { count: 9, query: '', kind: undefined },
        });

        expect(
            before(
                screen.getByRole('button', { name: 'FILTERS TRIGGER' }),
                screen.getByRole('button', { name: 'Sort: Relevance' }),
            ),
        ).toBe(true);

        rerender(frame({ filters: PANEL_FILTERS, sort, resultsSummary: { count: 9, query: '', kind: undefined } }));

        expect(before(screen.getByText('9 recipes'), screen.getByRole('button', { name: 'Sort: Relevance' }))).toBe(
            true,
        );
    });
});

describe('RecipeDiscoveryFrame (web) — back to browse (U7)', () => {
    it('renders a back-to-browse action and reports it', async () => {
        const user = userEvent.setup();
        const onExitToBrowse = vi.fn();
        renderFrame({ onExitToBrowse });

        await user.click(screen.getByRole('button', { name: 'Back to browse' }));

        expect(onExitToBrowse).toHaveBeenCalledTimes(1);
    });

    it('renders no back-to-browse action when none is offered', () => {
        renderFrame();

        expect(screen.queryByRole('button', { name: 'Back to browse' })).toBeNull();
    });
});

describe('RecipeDiscoveryFrame (web) — recent searches (U7)', () => {
    const recent = { queries: ['risotto', 'pasta'], onSelect: noop, onClear: noop };

    /** Focus the search field — the panel is an idle-state affordance, not always-on chrome. */
    async function focusSearch(user: ReturnType<typeof userEvent.setup>): Promise<void> {
        await user.click(screen.getByRole('searchbox', { name: 'Search recipes' }));
    }

    it('renders nothing when the surface wires no recent-search memory', async () => {
        const user = userEvent.setup();
        renderFrame();

        await focusSearch(user);

        expect(screen.queryByRole('region', { name: 'Recent searches' })).toBeNull();
    });

    it('stays hidden until the search field is focused', () => {
        renderFrame({ recentSearches: recent });

        expect(screen.queryByRole('region', { name: 'Recent searches' })).toBeNull();
    });

    it('lists the recent searches, newest first, once focused while not searching', async () => {
        const user = userEvent.setup();
        renderFrame({ recentSearches: recent });

        await focusSearch(user);

        const panel = screen.getByRole('region', { name: 'Recent searches' });
        const options = within(panel).getAllByRole('button', { name: /^Search for/u });
        expect(options.map((option) => option.textContent)).toEqual(['risotto', 'pasta']);
    });

    it('stays hidden while searching, even when focused — a typed query OR an active filter is the RESULT state', async () => {
        // `searching` is query OR filters. A filter applied from the sheet leaves the query blank, and gating on the
        // query alone once left this idle-only panel drawn over the result list.
        const user = userEvent.setup();
        renderFrame({ searchValue: '', searching: true, recentSearches: recent });

        await focusSearch(user);

        expect(screen.queryByRole('region', { name: 'Recent searches' })).toBeNull();
    });

    it('renders no panel at all when the history is empty', async () => {
        const user = userEvent.setup();
        renderFrame({ recentSearches: { ...recent, queries: [] } });

        await focusSearch(user);

        expect(screen.queryByRole('region', { name: 'Recent searches' })).toBeNull();
    });

    it('reports the chosen recent search upward (so the container runs it)', async () => {
        const user = userEvent.setup();
        const onSelect = vi.fn();
        renderFrame({ recentSearches: { ...recent, onSelect } });

        await focusSearch(user);
        // Clicking a suggestion moves focus INTO the panel: if a blur handler tore the panel down first, this click
        // would never land — the regression this asserts.
        await user.click(screen.getByRole('button', { name: 'Search for “pasta”' }));

        expect(onSelect).toHaveBeenCalledWith('pasta');
    });

    it('reports clear-all upward', async () => {
        const user = userEvent.setup();
        const onClear = vi.fn();
        renderFrame({ recentSearches: { ...recent, onClear } });

        await focusSearch(user);
        await user.click(screen.getByRole('button', { name: 'Clear recent searches' }));

        expect(onClear).toHaveBeenCalledTimes(1);
    });

    it('hides again once focus leaves the search area entirely', async () => {
        const user = userEvent.setup();
        renderFrame({ recentSearches: recent });

        await focusSearch(user);
        expect(screen.getByRole('region', { name: 'Recent searches' })).toBeTruthy();

        await user.click(screen.getByRole('button', { name: 'boundary content' }));

        expect(screen.queryByRole('region', { name: 'Recent searches' })).toBeNull();
    });
});

describe('RecipeDiscoveryFrame (web) — the count line, which is also the live region', () => {
    /**
     * The region is mounted EMPTY with the frame, outside the boundary, so it exists before any result does: a live
     * region that mounts with its text already inside is not reliably announced, and the results body is swapped out for
     * loading, error and no-result states. Its text is the visible count, so what is announced is what is seen.
     */
    function countLine(): HTMLElement {
        const regions = screen.getAllByRole('status');
        expect(regions, 'exactly one count line').toHaveLength(1);

        return regions[0] as HTMLElement;
    }

    it('mounts empty while no results have settled', () => {
        renderFrame();

        expect(countLine().textContent).toBe('');
    });

    it('says the count in words, naming the query the results belong to, and it is visible', () => {
        const { rerender } = renderFrame();

        rerender(frame({ resultsSummary: { count: 12, query: 'lamb', kind: 'query' } }));

        expect(countLine().textContent).toBe('12 recipes for “lamb”');
        expect(countLine().classList.contains('sr-only')).toBe(false);
    });

    it('says the count alone when no term was searched', () => {
        renderFrame({ resultsSummary: { count: 1, query: '', kind: 'filters' } });

        expect(countLine().textContent).toBe('1 recipe');
    });

    it('says the no-result heading when a search settled on nothing', () => {
        renderFrame({ resultsSummary: { count: 0, query: 'tiramisu', kind: 'query' } });

        expect(countLine().textContent).toBe('No recipes for “tiramisu”');
    });

    it('keeps the line outside the boundary’s body, so swapping the body never remounts it', () => {
        const { rerender } = renderFrame({ resultsSummary: { count: 2, query: '', kind: undefined } });
        const first = countLine();

        rerender(frame({ resultsSummary: { count: 2, query: '', kind: undefined }, children: <p>loading</p> }));

        expect(countLine()).toBe(first);
    });
});

describe('RecipeDiscoveryFrame (web) — heading focus', () => {
    it('⛔ moves focus to the heading when the recovery signal changes, since the notice’s button is gone', () => {
        const { rerender } = renderFrame({ headingFocusSignal: 0 });

        rerender(frame({ headingFocusSignal: 1 }));

        expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Discover' }));
    });

    it('leaves focus alone on the first render', () => {
        renderFrame({ headingFocusSignal: 0 });

        expect(document.activeElement).toBe(document.body);
    });
});
