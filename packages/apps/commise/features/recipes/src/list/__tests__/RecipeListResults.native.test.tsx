/**
 * The native My recipes RESULTS (react-native-web under jsdom), the twin of `RecipeListResults.test.tsx`: the facet
 * chips with counts, the result bar (count, sort sheet, icon-only list/grid switch), every state's body, the cards in
 * the decided variant, "Load more", the refresh notice and the create dial's one-affordance rule — plus the frame's
 * collapse, which hides the chips and the dial while the keyboard is open on a short screen.
 *
 * ⚠️ REWRITTEN for slice 4 of the UI overhaul, for the reasons the web test's header gives.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

import { FAB_RESERVED_BOTTOM_PX } from '@commise/ui/create-fab';
import { LocaleProvider } from '@commise/i18n/react';

import { makeRecipeListItem } from '../../__fixtures__/index.js';
import { RecipeListResults } from '../RecipeListResults.native.js';
import type { RecipeListResultsProps } from '../model.js';

/** The frame's collapse (compact height AND a keyboard open), served by the test: jsdom has neither. */
const layout = vi.hoisted(() => ({ collapsed: false }));

vi.mock('@commise/ui/layout', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@commise/ui/layout')>()),
    useFrameCollapsed: () => layout.collapsed,
}));

afterEach(() => {
    cleanup();
    layout.collapsed = false;
});

const noop = () => undefined;

const threeRecipes = [
    makeRecipeListItem({ id: 'rec_1', title: 'Mediterranean Grilled Lamb' }),
    makeRecipeListItem({ id: 'rec_2', title: 'Asparagus with Green Sauce' }),
    makeRecipeListItem({ id: 'rec_3', title: 'Gourmet Garden Salad' }),
];

function results(overrides: Partial<RecipeListResultsProps> = {}) {
    return (
        <LocaleProvider locale="en">
            <RecipeListResults
                recipes={threeRecipes}
                state="results"
                searchValue=""
                onClearSearch={noop}
                onClearFilters={noop}
                clearCount={0}
                onSelectRecipe={noop}
                onCreateRecipe={noop}
                variant="row"
                chipOverflow="scroll"
                facets={{
                    facets: [
                        { value: 'quick', label: 'Under 30 min', count: 2, selected: false },
                        { value: 'Moroccan', label: 'Moroccan', count: 1, selected: true },
                    ],
                    onToggle: noop,
                    onClear: noop,
                }}
                view={{ mode: 'list', onChange: noop }}
                sort={{ value: 'updatedAt', onChange: noop }}
                {...overrides}
            />
        </LocaleProvider>
    );
}

describe('RecipeListResults (native) — W-22: Clear filters brings the chip row back to its start', () => {
    it('remounts the chip row when the host counts another clear, so the selected "All" is in view', () => {
        const { rerender } = render(results({ clearCount: 0 }));
        const before = screen.getByRole('group', { name: 'Quick filters' });

        rerender(results({ clearCount: 1 }));

        expect(screen.getByRole('group', { name: 'Quick filters' })).not.toBe(before);
    });

    it('keeps the SAME row on any other update', () => {
        const { rerender } = render(results({ clearCount: 2 }));
        const before = screen.getByRole('group', { name: 'Quick filters' });

        rerender(results({ clearCount: 2, searchValue: 'lamb' }));

        expect(screen.getByRole('group', { name: 'Quick filters' })).toBe(before);
    });
});

describe('RecipeListResults (native) — populated', () => {
    it('says the count, and draws one link per recipe in the decided variant, reporting a press', () => {
        const onSelectRecipe = vi.fn();
        render(results({ onSelectRecipe }));

        expect(screen.getByText('3 recipes')).toBeTruthy();
        expect(screen.getAllByRole('link')).toHaveLength(3);

        fireEvent.click(screen.getByRole('link', { name: 'Asparagus with Green Sauce' }));

        expect(onSelectRecipe).toHaveBeenCalledWith('rec_2');
    });

    it('asks the host for each card’s calorie figure', () => {
        render(results({ renderNutrition: (id) => <span>{`cal ${id}`}</span> }));

        expect(screen.getByText('cal rec_2')).toBeTruthy();
    });
});

describe('RecipeListResults (native) — chips and the result bar', () => {
    it('leads with All, then each facet named with its count, and reports a toggle', () => {
        const onToggle = vi.fn();
        const onClear = vi.fn();
        render(
            results({
                facets: {
                    facets: [{ value: 'quick', label: 'Under 30 min', count: 2, selected: false }],
                    onToggle,
                    onClear,
                },
            }),
        );
        const group = screen.getByRole('group', { name: 'Quick filters' });

        fireEvent.click(within(group).getByRole('checkbox', { name: 'Under 30 min 2' }));
        fireEvent.click(within(group).getByRole('checkbox', { name: 'All' }));

        expect(onToggle).toHaveBeenCalledWith('quick');
        expect(onClear).toHaveBeenCalledTimes(1);
    });

    it('switches between list and grid as one radio group of glyphs', () => {
        const onChange = vi.fn();
        render(results({ view: { mode: 'list', onChange } }));
        const group = screen.getByRole('radiogroup', { name: 'View' });

        fireEvent.click(within(group).getByRole('radio', { name: 'Grid view' }));

        expect(onChange).toHaveBeenCalledWith('grid');
        expect(within(group).queryByText('Grid view')).toBeNull();
    });

    it('opens the sort sheet from "Sort: …", checks the sort in use, and reports a choice', () => {
        const onChange = vi.fn();
        render(results({ sort: { value: 'createdAt', onChange } }));

        fireEvent.click(screen.getByRole('button', { name: 'Sort: Newest' }));
        const sorts = screen
            .getAllByRole('radio')
            .filter((radio) => /Recently|Newest|A–Z/u.test(radio.textContent ?? ''));

        expect(sorts.map((radio) => radio.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);

        fireEvent.click(screen.getByRole('radio', { name: 'A–Z' }));

        expect(onChange).toHaveBeenCalledWith('title');
    });

    it('shows the sort choice alone, names it "Sort: {choice}", and puts the chevron after it (A-018)', () => {
        render(results({ sort: { value: 'createdAt', onChange: vi.fn() } }));
        const button = screen.getByRole('button', { name: 'Sort: Newest' });
        const chevron = button.querySelector('[data-icon-name="chevron-down"]') as HTMLElement;

        expect(button.textContent).toBe('Newest');
        expect(
            within(button).getByText('Newest').compareDocumentPosition(chevron) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
    });

    it('lets the sort and the view switch wrap, so the largest font scale cannot push them off the edge (A-028 b)', () => {
        render(results({ sort: { value: 'updatedAt', onChange: vi.fn() } }));
        const controls = screen.getByRole('button', { name: 'Sort: Recently edited' }).parentElement as HTMLElement;

        expect(getComputedStyle(controls).flexWrap).toBe('wrap');
        expect(within(controls).getByRole('radiogroup', { name: 'View' })).toBeTruthy();
    });

    // ⚠️ REWRITTEN: it also asserted the floating button hidden. The button moved to the frame (hiding with the keyboard
    // is `CreateFab`'s own rule), so the results draw none at all, collapsed or not.
    it('hides the chips while the frame is collapsed, and draws no floating create button of its own', () => {
        layout.collapsed = true;
        render(results());

        expect(screen.queryByRole('group', { name: 'Quick filters' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'New recipe' })).toBeNull();
    });

    it('draws no floating create button when settled with rows: the frame owns it', () => {
        render(results());

        expect(screen.queryByRole('button', { name: 'New recipe' })).toBeNull();
    });
});

// The floating create button is drawn over the list's foot, so the list reserves its height and a gap (SC 2.4.11): the
// last card is never hidden behind it. The reservation is the same in every state, so the list does not jump when the
// button appears or yields. ⚠️ NEW: the cards used to reserve only 20 px.
describe('RecipeListResults (native) — the foot reserved for the floating create button', () => {
    it.each([['row'], ['grid']] as const)(
        'the %s cards reserve FAB_RESERVED_BOTTOM_PX under the last card',
        (variant) => {
            render(results({ variant }));
            const card = screen.getByText('Gourmet Garden Salad');
            const foot: string[] = [];

            // The scroller's content container is one of the item's ancestors; the item's own padding is not its foot.
            for (let node = card.parentElement; node !== null; node = node.parentElement) {
                foot.push(getComputedStyle(node).paddingBottom);
            }

            expect(foot).toContain(`${FAB_RESERVED_BOTTOM_PX}px`);
        },
    );
});

describe('RecipeListResults (native) — states', () => {
    it('the first run offers the two ways to start, and no chips, bar or dial', () => {
        const onCreateRecipe = vi.fn();
        const onPasteIngredients = vi.fn();
        render(results({ recipes: [], state: 'firstRun', onCreateRecipe, onPasteIngredients }));

        expect(screen.getByText('Your recipe box is empty')).toBeTruthy();
        expect(screen.queryByRole('radiogroup', { name: 'View' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'New recipe' })).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Add your first recipe' }));
        fireEvent.click(screen.getByRole('button', { name: 'Paste ingredients' }));

        expect(onCreateRecipe).toHaveBeenCalledTimes(1);
        expect(onPasteIngredients).toHaveBeenCalledTimes(1);
    });

    // ⚠️ REWRITTEN: "keeping the dial" asserted the floating button here; the frame owns it now (a no-match body has no
    // create action of its own, so the FRAME keeps it for a narrowed zero: `useRecipeLibraryControls.test.tsx`).
    it('a search no-match quotes it and offers Clear search', () => {
        const onClearSearch = vi.fn();
        render(results({ recipes: [], state: 'noMatchQuery', searchValue: 'zzz', onClearSearch }));

        expect(screen.getByText('Nothing matches “zzz”.')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'New recipe' })).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));

        expect(onClearSearch).toHaveBeenCalledTimes(1);
    });

    it('a chips no-match offers Clear filters; both offer both', () => {
        const { unmount } = render(results({ recipes: [], state: 'noMatchFilters' }));

        expect(screen.getByText('No recipes match these filters.')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();
        unmount();
        render(results({ recipes: [], state: 'noMatchBoth', searchValue: 'z' }));

        expect(screen.getByRole('button', { name: 'Clear search' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Clear filters' })).toBeTruthy();
    });

    it('offers Load more while more remain', () => {
        const onLoadMore = vi.fn();
        render(results({ loadMore: { hasMore: true, loading: false, failed: false, onLoadMore } }));

        fireEvent.click(screen.getByRole('button', { name: 'Load more' }));

        expect(onLoadMore).toHaveBeenCalledTimes(1);
    });

    it('keeps the rows on a failed refresh, with Try again', () => {
        const onRetry = vi.fn();
        render(results({ refreshNotice: { failed: true, refreshing: false, onRetry, recoveries: 0 } }));

        expect(screen.getByText('Mediterranean Grilled Lamb')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

        expect(onRetry).toHaveBeenCalledTimes(1);
    });
});

/** A scroll host's bind that records what its scroller does with it. */
function recordingBind() {
    return {
        ref: vi.fn(),
        onScroll: vi.fn(),
        onScrollBeginDrag: vi.fn(),
        onMomentumScrollEnd: vi.fn(),
        scrollEventThrottle: 16 as const,
    };
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
describe("RecipeListResults (native) — the scroll host's bind", () => {
    it("binds its scroller to the screen's scroll host, and reports each scroll to it", () => {
        const bind = recordingBind();
        render(results({ scrollBind: bind }));

        fireEvent.scroll(boundScroller(bind), { target: { scrollTop: 240 } });

        expect(bind.onScroll).toHaveBeenCalled();
    });
});
