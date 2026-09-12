/**
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
import { cleanup, render, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { RecipeSearchSortBy } from '@kitchensink/recipe-core';

import { computedContrast, placeholderContrast } from '@commise/test-utils';
import { palette } from '@commise/ui';

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

/** The source switcher's destinations. Native ignores them (no URLs) — see the control's JSDoc. */
const HREF = { mine: '/en/recipes', community: '/en/discover' } as const;

function frame(overrides: Partial<RecipeDiscoveryFrameProps> = {}) {
    return (
        <RecipeDiscoveryFrame
            searchValue=""
            onSearchChange={noop}
            searching={false}
            headingFocusSignal={0}
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

        expect(screen.getByRole('heading', { name: 'Discover recipes' })).toBeTruthy();
        expect(screen.getByLabelText('Search public recipes')).toBeTruthy();
        expect(screen.getByText('boundary content')).toBeTruthy();
    });

    it('reports search input changes upward', () => {
        const onSearchChange = vi.fn();
        renderFrame({ onSearchChange });

        fireEvent.change(screen.getByLabelText('Search public recipes'), { target: { value: 'lamb' } });

        expect(onSearchChange).toHaveBeenCalledWith('lamb');
    });

    it('renders the filter slot', () => {
        renderFrame({ filterSlot: <Text>FILTER BAR</Text> });

        expect(screen.getByText('FILTER BAR')).toBeTruthy();
    });
});

describe('RecipeDiscoveryFrame (native) — source switcher (L5)', () => {
    // Parity with the web leaf: a host composing this surface without a shell tab bar must still offer the way back.
    // Mobile's recipe shell owns its own switcher, so the app passes no `tab` — hence the first case.
    it('renders no source switcher when no tab prop is given (the shell owns it on mobile)', () => {
        renderFrame();

        expect(screen.queryByLabelText('Recipe source')).toBeNull();
    });

    it('offers a way BACK to My Recipes, with Community marked as the current source', () => {
        const onChange = vi.fn();
        renderFrame({ tab: { active: 'community', href: HREF, onChange } });

        expect(screen.getByRole('tab', { name: 'Community' }).getAttribute('aria-selected')).toBe('true');
        fireEvent.click(screen.getByRole('tab', { name: 'My Recipes' }));

        expect(onChange).toHaveBeenCalledWith('mine');
    });
});

describe('RecipeDiscoveryFrame (native) — sort (S3)', () => {
    it('renders the sort options and reports a change', () => {
        const onChange = vi.fn();
        renderFrame({ searching: true, sort: { active: RecipeSearchSortBy.RELEVANCE, onChange } });

        expect(screen.getByText('Relevance')).toBeTruthy();
        fireEvent.click(screen.getByText('Quickest'));

        expect(onChange).toHaveBeenCalledWith('quickest');
    });

    it('renders no sort control when no sort prop is given (the container omits it while browsing)', () => {
        renderFrame();

        expect(screen.queryByRole('radiogroup', { name: 'Sort by' })).toBeNull();
    });

    /**
     * The selected sort has to reach assistive tech on the mobile-WEB build too, and `accessibilityState={{ checked }}`
     * alone does not get there (#123): react-native-web forwards literal `aria-*` props but projects
     * `accessibilityState` for nothing, so every chip rendered as a stateless radio and the active sort was carried by
     * colour alone. `aria-checked` is `role="radio"`'s own attribute; `accessibilityState` stays for the device trait.
     */
    it('marks the ACTIVE sort option checked and every other one unchecked (present-and-false)', () => {
        renderFrame({ searching: true, sort: { active: RecipeSearchSortBy.MOST_CLONED, onChange: noop } });

        const states = within(screen.getByRole('radiogroup', { name: 'Sort by' }))
            .getAllByRole('radio')
            .map((radio) => [radio.textContent, radio.getAttribute('aria-checked')]);

        expect(states).toEqual([
            ['Relevance', 'false'],
            ['Newest', 'false'],
            ['Most cloned', 'true'],
            ['Quickest', 'false'],
        ]);
    });

    it('moves the checked state when a different sort becomes active', () => {
        // Mutation guard: a hard-coded `aria-checked`, or one wired to the wrong option, cannot satisfy both cases.
        renderFrame({ searching: true, sort: { active: RecipeSearchSortBy.QUICKEST, onChange: noop } });

        const checked = within(screen.getByRole('radiogroup', { name: 'Sort by' }))
            .getAllByRole('radio')
            .filter((radio) => radio.getAttribute('aria-checked') === 'true')
            .map((radio) => radio.textContent);

        expect(checked).toEqual(['Quickest']);
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
        fireEvent.focusIn(screen.getByLabelText('Search public recipes'));
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

        fireEvent.focusOut(screen.getByLabelText('Search public recipes'));

        expect(screen.queryByRole('heading', { name: 'Recent searches' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Search for “risotto”' })).toBeNull();
    });
});

describe('RecipeDiscoveryFrame (native) — announcing settled results', () => {
    /** The frame's polite live region — mounted empty, before any result exists. */
    function announcementRegion(container: HTMLElement): Element {
        const regions = container.querySelectorAll('[aria-live="polite"]');
        expect(regions, 'exactly one polite announcement region').toHaveLength(1);

        return regions[0] as Element;
    }

    it('mounts the region empty while no results have settled', () => {
        const { container } = renderFrame();

        expect(announcementRegion(container).textContent).toBe('');
    });

    it('announces the settled results header, naming the query they belong to', () => {
        const { container, rerender } = renderFrame();

        rerender(frame({ resultsSummary: { count: 9, query: 'pasta', searching: true } }));

        expect(announcementRegion(container).textContent).toBe('Showing 9 recipes for “pasta”');
    });

    it('announces a search that settled with nothing as a no-match', () => {
        const { container } = renderFrame({ resultsSummary: { count: 0, query: 'tiramisu', searching: true } });

        expect(announcementRegion(container).textContent).toBe('No matching recipes');
    });
});

describe('RecipeDiscoveryFrame (native) — heading focus', () => {
    it('⛔ moves the screen-reader cursor to the heading when the recovery signal changes', () => {
        const { rerender } = renderFrame({ headingFocusSignal: 0 });

        rerender(frame({ headingFocusSignal: 1 }));

        expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledWith(
            screen.getByRole('heading', { name: 'Discover recipes' }),
            'focus',
        );
    });

    it('leaves the cursor alone on the first render', () => {
        renderFrame({ headingFocusSignal: 0 });

        expect(AccessibilityInfo.sendAccessibilityEvent).not.toHaveBeenCalled();
    });
});

describe('RecipeDiscoveryFrame (native) — text contrast (WCAG 2.1 AA)', () => {
    /**
     * `seafoam` as a FOREGROUND misses the 4.5:1 these labels owe — 4.02:1 on the recent-search panel's white card,
     * 3.73:1 on the screen's `sand` — and the palette JSDoc in `@commise/ui`'s `tokens/colors.ts` says where
     * `ocean-dark` takes over. `computedContrast` reads the colour react-native-web compiled, so a re-themed token fails.
     */
    it('keeps the clear-recent-searches label legible on the recent-search panel', () => {
        renderFrame({ recentSearches: { queries: ['risotto'], onSelect: noop, onClear: noop } });
        fireEvent.focusIn(screen.getByLabelText('Search public recipes'));

        const label = within(screen.getByRole('button', { name: 'Clear recent searches' })).getByText('Clear');
        expect(computedContrast(label, { surface: palette.white })).toBeGreaterThanOrEqual(4.5);
    });

    it('keeps the back-to-browse label legible on the screen background', () => {
        renderFrame({ onExitToBrowse: noop });

        const label = within(screen.getByRole('button', { name: 'Back to browse' })).getByText('Back to browse');
        expect(computedContrast(label, { surface: palette.sand })).toBeGreaterThanOrEqual(4.5);
    });

    it('keeps the search field’s PLACEHOLDER text legible on the field', () => {
        renderFrame();

        // `placeholderContrast` reads the colour react-native-web actually paints, so this fails if the token drifts
        // AND if the prop stops being passed (`palette.mist` measured 1.90:1).
        expect(
            placeholderContrast(screen.getByLabelText('Search public recipes'), { surface: palette.sand }),
        ).toBeGreaterThanOrEqual(4.5);
    });

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
        filterSlot: <Text>FILTER BAR</Text>,
        onExitToBrowse: noop,
        sort: { active: RecipeSearchSortBy.RELEVANCE, onChange: noop },
    } satisfies Partial<RecipeDiscoveryFrameProps>;

    it('puts the heading and the field in one row', () => {
        layout.compact = true;
        renderFrame();

        const field = screen.getByLabelText('Search public recipes');

        expect(field.parentElement).toBe(screen.getByRole('heading', { name: 'Discover recipes' }).parentElement);
        expect(getComputedStyle(field.parentElement as Element).flexDirection).toBe('row');
    });

    it('puts the filter trigger, back to browse and the sort in one wrapping row, in reading order', () => {
        layout.compact = true;
        renderFrame(controls);

        const row = screen.getByText('FILTER BAR').parentElement as Element;

        expect(getComputedStyle(row).flexDirection).toBe('row');
        expect(getComputedStyle(row).flexWrap).toBe('wrap');
        expect(row.contains(screen.getByRole('button', { name: 'Back to browse' }))).toBe(true);
        expect(row.contains(screen.getByRole('radiogroup', { name: 'Sort by' }))).toBe(true);
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
        expect(screen.getByRole('radiogroup', { name: 'Sort by' })).toBeTruthy();
    });

    it('steps the filter controls aside while collapsed with the frame’s own field focused, keeping the heading, the field and the announcer', () => {
        layout.compact = true;
        layout.collapsed = true;
        renderFrame({ ...controls, resultsSummary: undefined });
        fireEvent.focusIn(screen.getByLabelText('Search public recipes'));

        expect(screen.queryByText('FILTER BAR')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Back to browse' })).toBeNull();
        expect(screen.queryByRole('radiogroup', { name: 'Sort by' })).toBeNull();
        expect(screen.getByRole('heading', { name: 'Discover recipes' })).toBeTruthy();
        expect(screen.getByLabelText('Search public recipes')).toBeTruthy();
        expect(document.querySelector('[aria-live="polite"]')).not.toBeNull();

        fireEvent.focusOut(screen.getByLabelText('Search public recipes'));

        expect(screen.getByText('FILTER BAR')).toBeTruthy();
    });

    it('keeps the same field node, focused, through regular, compact and collapsed', () => {
        const { rerender } = renderFrame(controls);
        const field = screen.getByLabelText('Search public recipes') as HTMLInputElement;

        field.focus();

        for (const next of [
            { compact: true, collapsed: false },
            { compact: true, collapsed: true },
            { compact: false, collapsed: false },
        ]) {
            layout.compact = next.compact;
            layout.collapsed = next.collapsed;
            rerender(frame({ ...controls, searchValue: `${String(next.compact)}${String(next.collapsed)}` }));

            expect(screen.getByLabelText('Search public recipes')).toBe(field);
            expect(document.activeElement).toBe(field);
        }
    });

    // In every layout: under a keyboard the recent-search panel can outgrow the room left, so its rows scroll, and the
    // first tap on a query must run it rather than only close the keyboard.
    it('scrolls the recent searches, and lets the first tap with the keyboard up land on a query', () => {
        renderFrame({ recentSearches: { queries: ['risotto', 'pasta'], onSelect: noop, onClear: noop } });
        fireEvent.focusIn(screen.getByLabelText('Search public recipes'));

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

        expect(screen.getAllByRole('heading', { name: 'Discover recipes' })).toHaveLength(1);
        expect(screen.queryAllByLabelText('Discover recipes')).toEqual([]);
    });

    it('says "Recent searches" through one header once the panel shows, and no node is labelled with it', () => {
        renderFrame({ recentSearches: { queries: ['risotto', 'pasta'], onSelect: noop, onClear: noop } });

        fireEvent.focusIn(screen.getByLabelText('Search public recipes'));

        expect(screen.getAllByRole('heading', { name: 'Recent searches' })).toHaveLength(1);
        expect(screen.queryAllByLabelText('Recent searches')).toEqual([]);
    });
});
