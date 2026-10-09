/**
 * ⚠️ REWRITTEN for slice 5 of the UI overhaul, with the web leaf's test (`docs/design/uiOverhaul/buildSpec.md` §4.4,
 * §4.5): the filters arrive as a discriminated union (a tablet panel, or a trigger + applied chips + sheet), the search is
 * the design-system `SearchField`, the sort is a sheet menu, and the count is one visible line that is also the polite live
 * region. The palette-based contrast assertions are deleted: the frame reads colour from roles, and the role pairs'
 * contrast is held by the token tests. The compact-height, recent-search, back-to-browse and N1-naming assertions are kept.
 *
 * Native component tests for the discovery FRAME (react-native-web under jsdom) — the chrome that renders outside the
 * discovery suspense boundary. Mirrors `RecipeDiscoveryFrame.test.tsx`.
 *
 * Moved from the retired `RecipeDiscoveryList.native.test.tsx` ("chrome", "source switcher (L5)", "recent searches
 * (U7)", the sort cases of "populated state", the frame's contrast cases, and the refresh notice's screen-reader
 * hand-off — which now arrives as `headingFocusSignal`).
 *
 * ⚠️ Back-to-browse MOVED here from the result grid's scrolling header. Inside the grid it existed only while results
 * rendered, so a "see all" whose list was still loading, or had failed, left no way back to the rails; in the frame it
 * is reachable in every body state, as `recipe-search.md`'s loading and load-error states require.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccessibilityInfo, Text, type ScrollView as ScrollViewType } from 'react-native';
import { createElement, type ComponentProps } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { RecipeSearchSortBy } from '@kitchensink/recipe-core';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { RecipeDiscoveryFrame } from '../RecipeDiscoveryFrame.native.js';
import type { RecipeDiscoveryFrameProps } from '../model.js';

// react-native-web does not implement `sendAccessibilityEvent`; the focus hand-off is asserted as the call it makes.
// The real ScrollView is wrapped to mark its element with its tap persistence: jsdom has no keyboard to tap through.
vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return {
        ...actual,
        AccessibilityInfo: { ...actual.AccessibilityInfo, sendAccessibilityEvent: vi.fn() },
        ScrollView: (props: ComponentProps<typeof ScrollViewType>) =>
            createElement(
                'div',
                { 'data-scroll-region': props.keyboardShouldPersistTaps ?? 'never' },
                createElement(actual.ScrollView, props),
            ),
    };
});

/** The window's height class and the frame's collapse, served by the test: jsdom has no window to turn, no keyboard. */
const layout = vi.hoisted(() => ({ compact: false, collapsed: false }));

vi.mock('@commise/ui/layout', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@commise/ui/layout')>()),
    useCompactHeight: () => layout.compact,
    useFrameCollapsed: () => layout.collapsed,
}));

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    layout.compact = false;
    layout.collapsed = false;
});

const noop = () => undefined;

const SHEET_FILTERS: NonNullable<RecipeDiscoveryFrameProps['filters']> = {
    presentation: 'sheet',
    trigger: <Text>FILTERS TRIGGER</Text>,
    applied: <Text>APPLIED CHIPS</Text>,
    sheet: <Text>FILTER SHEET</Text>,
};

const PANEL_FILTERS: NonNullable<RecipeDiscoveryFrameProps['filters']> = {
    presentation: 'panel',
    panel: <Text>FILTER PANEL</Text>,
};

/** The source switcher's destinations. Native ignores them (no URLs) — see the control's JSDoc. */

function frame(overrides: Partial<RecipeDiscoveryFrameProps> = {}) {
    return (
        <RecipeDiscoveryFrame
            searchValue=""
            onSearchChange={noop}
            searching={false}
            headingFocusSignal={0}
            filters={SHEET_FILTERS}
            {...overrides}
        >
            {overrides.children ?? <Text>boundary content</Text>}
        </RecipeDiscoveryFrame>
    );
}

function renderFrame(overrides: Partial<RecipeDiscoveryFrameProps> = {}) {
    return render(frame(overrides));
}

describe('RecipeDiscoveryFrame (native) — chrome', () => {
    it('renders the heading, the search field and whatever the boundary below it renders', () => {
        renderFrame();

        expect(screen.getByRole('heading', { name: 'Discover' })).toBeTruthy();
        expect(screen.getByRole('textbox', { name: 'Search recipes' })).toBeTruthy();
        expect(screen.getByText('boundary content')).toBeTruthy();
    });

    it('reports search input changes upward', () => {
        const onSearchChange = vi.fn();
        renderFrame({ onSearchChange });

        fireEvent.change(screen.getByRole('textbox', { name: 'Search recipes' }), { target: { value: 'lamb' } });

        expect(onSearchChange).toHaveBeenCalledWith('lamb');
    });

    it('clears the field from its own clear control', () => {
        const onSearchChange = vi.fn();
        renderFrame({ searchValue: 'risotto', onSearchChange });

        fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));

        expect(onSearchChange).toHaveBeenCalledWith('');
    });
});

describe('RecipeDiscoveryFrame (native) — filters', () => {
    it('in the sheet presentation: the trigger, the applied chips and the sheet — and no panel', () => {
        renderFrame({ filters: SHEET_FILTERS });

        expect(screen.getByText('FILTERS TRIGGER')).toBeTruthy();
        expect(screen.getByText('APPLIED CHIPS')).toBeTruthy();
        expect(screen.getByText('FILTER SHEET')).toBeTruthy();
        expect(screen.queryByText('FILTER PANEL')).toBeNull();
    });

    it('in the panel presentation: the panel beside the results — and no trigger, no applied chips, no sheet', () => {
        renderFrame({ filters: PANEL_FILTERS });

        expect(screen.getByText('FILTER PANEL')).toBeTruthy();
        expect(screen.queryByText('FILTERS TRIGGER')).toBeNull();
        expect(screen.queryByText('APPLIED CHIPS')).toBeNull();
        expect(screen.queryByText('FILTER SHEET')).toBeNull();
    });

    it('draws no filters when none are given', () => {
        renderFrame({ filters: undefined });

        expect(screen.queryByText(/FILTER/u)).toBeNull();
    });

    it('the panel sits beside the results: the search field is in the results column, not above the panel', () => {
        renderFrame({ filters: PANEL_FILTERS });
        const panel = screen.getByText('FILTER PANEL');
        const search = screen.getByRole('textbox', { name: 'Search recipes' });
        const results = screen.getByText('boundary content');

        expect(panel.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(search.compareDocumentPosition(results) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
});

/** Slice 3: Discover is a tab of its own — no source switcher — and its heading is the large title with the avatar. */
describe('RecipeDiscoveryFrame (native) — the large title', () => {
    it('draws no source switcher', () => {
        renderFrame();

        expect(screen.queryByLabelText('Recipe source')).toBeNull();
    });

    it('renders the heading as the large title, with the avatar the route supplies', () => {
        renderFrame({
            headerAction: {
                kind: 'avatar',
                avatar: (
                    <Text accessibilityRole="button" accessibilityLabel="Profile">
                        P
                    </Text>
                ),
            },
        });

        expect(screen.getAllByRole('heading')).toHaveLength(1);
        expect(screen.getByRole('button', { name: 'Profile' })).toBeTruthy();
    });
});

describe('RecipeDiscoveryFrame (native) — sort (S3)', () => {
    it('renders the sort with the sort in use on its button and reports a change', () => {
        const onChange = vi.fn();
        renderFrame({ searching: true, sort: { active: RecipeSearchSortBy.RELEVANCE, onChange } });

        fireEvent.click(screen.getByRole('button', { name: 'Sort: Relevance' }));
        fireEvent.click(screen.getByRole('radio', { name: 'Quickest' }));

        expect(onChange).toHaveBeenCalledWith('quickest');
    });

    it('renders no sort when none is given (the container omits it while browsing)', () => {
        renderFrame();

        expect(screen.queryByRole('button', { name: /^Sort:/u })).toBeNull();
    });
});

describe('RecipeDiscoveryFrame (native) — back to browse (U7)', () => {
    it('renders a back-to-browse action and reports it', () => {
        const onExitToBrowse = vi.fn();
        renderFrame({ onExitToBrowse });

        fireEvent.click(screen.getByRole('button', { name: 'Back to browse' }));

        expect(onExitToBrowse).toHaveBeenCalledTimes(1);
    });

    it('offers it above ANY body, so a list that is still loading or failed after "see all" is not a dead end', () => {
        renderFrame({ onExitToBrowse: noop, children: <Text accessibilityRole="alert">load failed</Text> });

        expect(screen.getByRole('button', { name: 'Back to browse' })).toBeTruthy();
        expect(screen.getByRole('alert')).toBeTruthy();
    });

    it('renders no back-to-browse action when none is offered', () => {
        renderFrame();

        expect(screen.queryByRole('button', { name: 'Back to browse' })).toBeNull();
    });
});

describe('RecipeDiscoveryFrame (native) — recent searches (U7)', () => {
    const recent = { queries: ['risotto', 'pasta'], onSelect: noop, onClear: noop };

    /**
     * Focus the keyword field. `focusIn`, not `fireEvent.focus`: React delegates `onFocus` to the BUBBLING `focusin`
     * event, so a bare `focus` event never reaches its listener.
     */
    function focusSearch(): void {
        fireEvent.focusIn(screen.getByRole('textbox', { name: 'Search recipes' }));
    }

    it('renders nothing when the surface wires no recent-search memory', () => {
        renderFrame();

        focusSearch();

        expect(screen.queryByRole('heading', { name: 'Recent searches' })).toBeNull();
    });

    it('stays hidden until the keyword field is focused', () => {
        renderFrame({ recentSearches: recent });

        expect(screen.queryByRole('heading', { name: 'Recent searches' })).toBeNull();
    });

    // The panel is named by its header (`docs/design/nativeContainerNames.md` N1 rule 2), so its rows are the ones that
    // follow that header. `queries` arrives newest first (`RecipeRecentSearchesControl`), and the frame keeps its order.
    it('lists the recent searches, newest first, once focused while not searching', () => {
        renderFrame({ searching: false, recentSearches: recent });

        focusSearch();

        const header = screen.getByRole('heading', { name: 'Recent searches' });
        const rows = screen.getAllByRole('button', { name: /^Search for/u });

        expect(rows.map((query) => query.getAttribute('aria-label'))).toEqual([
            'Search for “risotto”',
            'Search for “pasta”',
        ]);
        expect(rows.map((query) => query.textContent)).toEqual(['risotto', 'pasta']);

        for (const query of rows) {
            expect(header.compareDocumentPosition(query) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
        }
    });

    it('stays hidden while searching, even when focused — a typed query OR an active filter is the RESULT state', () => {
        // Applying a filter from the sheet leaves the query blank, and gating on the query alone kept the idle-only
        // panel drawn over the result list — the middle of a phone screen, where a swipe to scroll the results lands.
        renderFrame({ searchValue: '', searching: true, recentSearches: recent });

        focusSearch();

        expect(screen.queryByRole('heading', { name: 'Recent searches' })).toBeNull();
    });

    it('renders no panel at all when the history is empty', () => {
        renderFrame({ recentSearches: { ...recent, queries: [] } });

        focusSearch();

        expect(screen.queryByRole('heading', { name: 'Recent searches' })).toBeNull();
    });

    it('reports the chosen recent search upward (so the container runs it)', () => {
        const onSelect = vi.fn();
        renderFrame({ recentSearches: { ...recent, onSelect } });

        focusSearch();
        fireEvent.click(screen.getByRole('button', { name: 'Search for “pasta”' }));

        expect(onSelect).toHaveBeenCalledWith('pasta');
    });

    it('reports clear-all upward', () => {
        const onClear = vi.fn();
        renderFrame({ recentSearches: { ...recent, onClear } });

        focusSearch();
        fireEvent.click(screen.getByRole('button', { name: 'Clear recent searches' }));

        expect(onClear).toHaveBeenCalledTimes(1);
    });

    it('hides again once the keyword field is blurred', () => {
        renderFrame({ recentSearches: recent });
        focusSearch();
        expect(screen.getByRole('heading', { name: 'Recent searches' })).toBeTruthy();

        fireEvent.focusOut(screen.getByRole('textbox', { name: 'Search recipes' }));

        expect(screen.queryByRole('heading', { name: 'Recent searches' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Search for “risotto”' })).toBeNull();
    });
});

describe('RecipeDiscoveryFrame (native) — the count line, which is also the live region', () => {
    /** The frame's polite live region — mounted empty, before any result exists. */
    function countLine(container: HTMLElement): Element {
        const regions = container.querySelectorAll('[aria-live="polite"]');
        expect(regions, 'exactly one polite count line').toHaveLength(1);

        return regions[0] as Element;
    }

    it('mounts empty while no results have settled', () => {
        const { container } = renderFrame();

        expect(countLine(container).textContent).toBe('');
    });

    it('says the count in words, naming the query the results belong to', () => {
        const { container, rerender } = renderFrame();

        rerender(frame({ resultsSummary: { count: 12, query: 'lamb', kind: 'query' } }));

        expect(countLine(container).textContent).toBe('12 recipes for “lamb”');
    });

    it('says the no-result heading when a search settled on nothing', () => {
        const { container } = renderFrame({ resultsSummary: { count: 0, query: 'tiramisu', kind: 'query' } });

        expect(countLine(container).textContent).toBe('No recipes for “tiramisu”');
    });
});

describe('RecipeDiscoveryFrame (native) — heading focus', () => {
    it('⛔ moves the screen-reader cursor to the heading when the recovery signal changes', () => {
        const { rerender } = renderFrame({ headingFocusSignal: 0 });

        rerender(frame({ headingFocusSignal: 1 }));

        expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledWith(
            screen.getByRole('heading', { name: 'Discover' }),
            'focus',
        );
    });

    it('leaves the cursor alone on the first render', () => {
        renderFrame({ headingFocusSignal: 0 });

        expect(AccessibilityInfo.sendAccessibilityEvent).not.toHaveBeenCalled();
    });
});

describe('RecipeDiscoveryFrame (native) — touch targets', () => {
    it('gives the back-to-browse action the 44pt touch floor', () => {
        renderFrame({ onExitToBrowse: noop });

        const back = screen.getByRole('button', { name: 'Back to browse' });
        const surface = [back, ...Array.from(back.querySelectorAll<HTMLElement>('*'))].find(
            (node) => window.getComputedStyle(node).minHeight === '44px',
        );

        expect(surface, 'back-to-browse does not reach a 44pt target').toBeDefined();
    });
});

/**
 * `docs/design/compactHeightLayout.md` §5.4: sideways, the stacked chrome (heading, field, filters, back to browse,
 * sort) left the results 16 to 76 dp, and about 0 with the keyboard open. In compact height the heading shares a row
 * with the field and the filter controls share one wrapping row; while compact AND a keyboard is open the controls row
 * steps aside. The field never changes parent or index.
 */
describe('RecipeDiscoveryFrame (native) — compact height', () => {
    const controls = {
        filters: { ...SHEET_FILTERS, trigger: <Text>FILTER BAR</Text> },
        onExitToBrowse: noop,
        sort: { active: RecipeSearchSortBy.RELEVANCE, onChange: noop },
    } satisfies Partial<RecipeDiscoveryFrameProps>;

    it('puts the heading and the field in one row', () => {
        layout.compact = true;
        renderFrame();

        const field = screen.getByRole('textbox', { name: 'Search recipes' });
        const row = screen.getByRole('heading', { name: 'Discover' }).parentElement as Element;

        expect(row.contains(field)).toBe(true);
        expect(getComputedStyle(row).flexDirection).toBe('row');
    });

    it('puts the filter trigger, back to browse and the sort in one wrapping row, in reading order', () => {
        layout.compact = true;
        renderFrame(controls);

        const row = screen.getByText('FILTER BAR').parentElement as Element;

        expect(getComputedStyle(row).flexDirection).toBe('row');
        expect(getComputedStyle(row).flexWrap).toBe('wrap');
        expect(row.contains(screen.getByRole('button', { name: 'Back to browse' }))).toBe(true);
        expect(row.contains(screen.getByRole('button', { name: 'Sort: Relevance' }))).toBe(true);
    });

    // ⛔ Collapsed needs the keyboard to be the FIELD's: the filter sheet's own ingredient search raises a keyboard too,
    // and stepping the controls aside then would unmount the filter bar and the sheet it holds open (SC 3.2.1). A
    // collapse never unmounts a slot that holds state or a modal (staff-ux-engineer EVALUATE, 2026-10-01).
    it('keeps the filter controls while the keyboard belongs to something else, such as the filter sheet', () => {
        layout.compact = true;
        layout.collapsed = true;
        renderFrame(controls);

        expect(screen.getByText('FILTER BAR')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Back to browse' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Sort: Relevance' })).toBeTruthy();
    });

    it('steps the filter controls aside while collapsed with the frame’s own field focused, keeping the heading, the field and the announcer', () => {
        layout.compact = true;
        layout.collapsed = true;
        renderFrame({ ...controls, resultsSummary: undefined });
        fireEvent.focusIn(screen.getByRole('textbox', { name: 'Search recipes' }));

        expect(screen.queryByText('FILTER BAR')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Back to browse' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Sort: Relevance' })).toBeNull();
        expect(screen.getByRole('heading', { name: 'Discover' })).toBeTruthy();
        expect(screen.getByRole('textbox', { name: 'Search recipes' })).toBeTruthy();
        expect(document.querySelector('[aria-live="polite"]')).not.toBeNull();

        fireEvent.focusOut(screen.getByRole('textbox', { name: 'Search recipes' }));

        expect(screen.getByText('FILTER BAR')).toBeTruthy();
    });

    it('keeps the same field node, focused, through regular, compact and collapsed', () => {
        const { rerender } = renderFrame(controls);
        const field = screen.getByRole('textbox', { name: 'Search recipes' }) as HTMLInputElement;

        field.focus();

        for (const next of [
            { compact: true, collapsed: false },
            { compact: true, collapsed: true },
            { compact: false, collapsed: false },
        ]) {
            layout.compact = next.compact;
            layout.collapsed = next.collapsed;
            rerender(frame({ ...controls, searchValue: `${String(next.compact)}${String(next.collapsed)}` }));

            expect(screen.getByRole('textbox', { name: 'Search recipes' })).toBe(field);
            expect(document.activeElement).toBe(field);
        }
    });

    // In every layout: under a keyboard the recent-search panel can outgrow the room left, so its rows scroll, and the
    // first tap on a query must run it rather than only close the keyboard.
    it('scrolls the recent searches, and lets the first tap with the keyboard up land on a query', () => {
        renderFrame({ recentSearches: { queries: ['risotto', 'pasta'], onSelect: noop, onClear: noop } });
        fireEvent.focusIn(screen.getByRole('textbox', { name: 'Search recipes' }));

        const query = screen.getByRole('button', { name: 'Search for “risotto”' });

        expect(query.closest('[data-scroll-region]')?.getAttribute('data-scroll-region')).toBe('handled');
    });
});

/**
 * `docs/design/nativeContainerNames.md` N1 rule 2: the frame's heading says the frame's name, and the recent-searches
 * panel's title says the panel's, so neither container carries a name and each name is said once, by a header (N4).
 * The frame is checked upright and in compact height, the two layouts its header group takes.
 */
describe('RecipeDiscoveryFrame (native) — N1: each name is said once, by its header', () => {
    it.each([
        ['upright', false],
        ['compact height', true],
    ])('says "Discover recipes" through one header, and no node is labelled with it (%s)', (_layout, compact) => {
        layout.compact = compact;
        renderFrame();

        expect(screen.getAllByRole('heading', { name: 'Discover' })).toHaveLength(1);
        expect(screen.queryAllByLabelText('Discover')).toEqual([]);
    });

    it('says "Recent searches" through one header once the panel shows, and no node is labelled with it', () => {
        renderFrame({ recentSearches: { queries: ['risotto', 'pasta'], onSelect: noop, onClear: noop } });

        fireEvent.focusIn(screen.getByRole('textbox', { name: 'Search recipes' }));

        expect(screen.getAllByRole('heading', { name: 'Recent searches' })).toHaveLength(1);
        expect(screen.queryAllByLabelText('Recent searches')).toEqual([]);
    });
});
