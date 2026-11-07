/**
 * The native My recipes RESULTS (react-native-web under jsdom), the twin of `RecipeListResults.test.tsx`: the facet
 * chips with counts, the result bar (count, sort sheet, icon-only list/grid switch), every state's body, the cards in
 * the decided variant, "Load more", the refresh notice and the create dial's one-affordance rule — plus the frame's
 * collapse, which hides the chips and the dial while the keyboard is open on a short screen.
 *
 * ⚠️ REWRITTEN for slice 4 of the UI overhaul, for the reasons the web test's header gives.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

import { FAB_RESERVED_BOTTOM_PX } from '@commise/ui/create-fab';
import { LocaleProvider } from '@commise/i18n/react';

import { makeRecipeListItem } from '../../__fixtures__/index.js';
import { recipeMessages } from '../../messages.js';
import { RecipeListResults } from '../RecipeListResults.native.js';
import type { RecipeListResultsProps } from '../model.js';
import { nativeTokens } from '@commise/ui/native';
import {
    fireScrollAndSettle,
    pressFrameOf,
    render,
    renderWithTamagui,
    resolvedStyle,
} from '@commise/ui/testing/tamagui';

/** The frame's collapse (compact height AND a keyboard open), served by the test: jsdom has neither. */
const layout = vi.hoisted(() => ({ collapsed: false }));

/** The window's width and text scale, when a test sets them: jsdom has a 1024 px window and a scale of 1. */
const dims = vi.hoisted(() => ({ width: undefined as number | undefined, fontScale: undefined as number | undefined }));

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return {
        ...actual,
        useWindowDimensions: () => {
            const real = actual.useWindowDimensions();

            return { ...real, width: dims.width ?? real.width, fontScale: dims.fontScale ?? real.fontScale };
        },
    };
});

vi.mock('@commise/ui/layout', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@commise/ui/layout')>()),
    useFrameCollapsed: () => layout.collapsed,
}));

afterEach(() => {
    cleanup();
    layout.collapsed = false;
    dims.width = undefined;
    dims.fontScale = undefined;
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

// C-2: the list is full width so its header can scroll with it; every row carries the 16 the content used to have. The
// gutter is a Tamagui token (`$4`), which the test lane resolves through `resolvedStyle`, not `getComputedStyle`.
describe('RecipeListResults (native) — the rows inset themselves', () => {
    it('gives a row card, the empty body and the result bar the 16 pt gutter', () => {
        const gutterAround = (element: HTMLElement): string | undefined => {
            for (let node = element.parentElement; node !== null; node = node.parentElement) {
                if (resolvedStyle(node, 'paddingLeft') === '16px') {
                    return resolvedStyle(node, 'paddingRight');
                }
            }

            return undefined;
        };

        render(results());

        expect(gutterAround(screen.getByRole('link', { name: 'Gourmet Garden Salad' }))).toBe('16px');
        expect(gutterAround(screen.getByText('3 recipes'))).toBe('16px');
        cleanup();
        render(results({ recipes: [], state: 'noMatchFilters' }));
        expect(gutterAround(screen.getByText('No recipes match these filters.'))).toBe('16px');
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
        const controls = pressFrameOf(screen.getByRole('button', { name: 'Sort: Recently edited' }))
            .parentElement as HTMLElement;

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

/**
 * Whether the element sits in a SCROLLER whose content ends with the floating button's room: some ancestor pads its foot
 * by `FAB_RESERVED_BOTTOM_PX` AND is the direct child of an element that scrolls. Room on a view that does not scroll
 * moves nothing, so the room alone is not enough.
 */
function endsInScrollerWithFabRoom(element: HTMLElement, room = FAB_RESERVED_BOTTOM_PX): boolean {
    for (let node = element.parentElement; node?.parentElement; node = node.parentElement) {
        const scrolls = ['auto', 'scroll'].includes(getComputedStyle(node.parentElement).overflowY);

        if (scrolls && getComputedStyle(node).paddingBottom === `${String(room)}px`) {
            return true;
        }
    }

    return false;
}

/**
 * Designer ruling 2026-11-01 (`nativeBoards/designAnswers.md`, Recipes tab): the error and empty states get the same 88
 * end room as the cards. They used to sit in a view that did not scroll, so at a large text size their foot ran under
 * the floating button with no way to scroll it clear. Each now sits in the list's own scroller, with the cards' foot.
 * ⚠️ That the end of the content clears the button shows only on a device.
 */
describe('RecipeListResults (native) — the empty states scroll, and end with the floating button’s room', () => {
    it.each([
        ['the first run', { state: 'firstRun' }, 'Your recipe box is empty'],
        ['a search no-match', { state: 'noMatchQuery', searchValue: 'zzz' }, 'Nothing matches “zzz”.'],
        ['a chips no-match', { state: 'noMatchFilters' }, 'No recipes match these filters.'],
    ] as const)('%s', (_name, over, text) => {
        render(results({ recipes: [], ...over }));

        expect(endsInScrollerWithFabRoom(screen.getByText(text))).toBe(true);
    });

    it('the cards still do', () => {
        render(results());

        expect(endsInScrollerWithFabRoom(screen.getByText('Gourmet Garden Salad'))).toBe(true);
    });

    it('offers no Load more under a no-match, however many rows the library holds', () => {
        render(
            results({
                recipes: [],
                state: 'noMatchFilters',
                loadMore: { hasMore: true, loading: false, failed: false, onLoadMore: noop },
            }),
        );

        expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
    });
});

// Designer rulings d and e (2026-11-02): the end room is the button's DRAWN height at the current text scale plus its
// margin plus 16 (98 at the 1.5x chrome cap, not 88), for the cards AND for the first-run and no-match bodies, so
// "Clear search" is never under the button at a large text size.
describe('RecipeListResults (native) — the end room follows the font scale', () => {
    it.each([
        ['the cards', {}, 'Gourmet Garden Salad'],
        ['the first run', { recipes: [], state: 'firstRun' }, 'Your recipe box is empty'],
        ['a search no-match', { recipes: [], state: 'noMatchQuery', searchValue: 'zzz' }, 'Nothing matches “zzz”.'],
        ['a chips no-match', { recipes: [], state: 'noMatchFilters' }, 'No recipes match these filters.'],
    ] as const)('%s end 98 px clear at 1.5x, and 88 is no longer enough', (_name, over, text) => {
        renderWithTamagui(results(over), 'light', 1.5);

        expect(endsInScrollerWithFabRoom(screen.getByText(text), 98)).toBe(true);
        expect(endsInScrollerWithFabRoom(screen.getByText(text), 88)).toBe(false);
    });
});

describe('RecipeListResults (native) — states', () => {
    it('the first run offers the two ways to start, and no chips, bar or dial', () => {
        const onCreateRecipe = vi.fn();
        const onPasteIngredients = vi.fn();
        render(results({ recipes: [], state: 'firstRun', onCreateRecipe, onPasteIngredients }));

        expect(screen.getByText('Your recipe box is empty')).toBeTruthy();
        expect(screen.queryByRole('radiogroup', { name: 'View' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'New recipe' })).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Add a recipe' }));
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

        fireScrollAndSettle(boundScroller(bind), { target: { scrollTop: 240 } });

        expect(bind.onScroll).toHaveBeenCalled();
    });
});

// Designer finding C-1 (`reviews/mergedUiIos1.md`): a plain React Native Text has no cap on iOS and grows to about 3x.
// Every text here is the design-system Text, so it follows its role's ceiling: the display roles stop at 1.5x and the
// others at 2x. 3.1 is the iOS accessibility maximum.
describe('RecipeListResults (native) — C-1: the text follows its role’s cap at the iOS maximum (fontScale 3.1)', () => {
    const sizeOf = (element: HTMLElement): number => parseFloat(getComputedStyle(element).fontSize);

    it('stops the count at the label role’s 2x', () => {
        renderWithTamagui(results(), 'light', 3.1);

        expect(sizeOf(screen.getByText('3 recipes'))).toBe(nativeTokens.type.label.fontSize * 2);
    });

    it('stops the first-run title at the display ceiling of 1.5x and its body at 2x', () => {
        renderWithTamagui(results({ recipes: [], state: 'firstRun' }), 'light', 3.1);

        expect(sizeOf(screen.getByText('Your recipe box is empty'))).toBe(
            nativeTokens.type.sectionTitle.fontSize * 1.5,
        );
        expect(sizeOf(screen.getByText(recipeMessages.en.list.emptyBody))).toBe(nativeTokens.type.body.fontSize * 2);
    });

    it('stops a no-match explanation at 2x and its title at 1.5x', () => {
        renderWithTamagui(results({ recipes: [], state: 'noMatchQuery', searchValue: 'zzz' }), 'light', 3.1);

        expect(sizeOf(screen.getByText('Nothing matches “zzz”.'))).toBe(nativeTokens.type.body.fontSize * 2);
        expect(sizeOf(screen.getByRole('heading', { name: recipeMessages.en.list.noMatchTitle }))).toBe(
            nativeTokens.type.sectionTitle.fontSize * 1.5,
        );
    });
});

// Designer ruling (2026-11-02): on a phone the Recipes grid is the compact tile, two to a row, and it KEEPS the "Edited"
// line (a Recipes sort may not be by recency). Home's tile drops it, so this is the Recipes list asking for it.
describe('RecipeListResults (native) — the phone grid is the compact tile with its Edited line', () => {
    const editedRecipes = [
        makeRecipeListItem({
            id: 'rec_1',
            title: 'Mediterranean Grilled Lamb',
            createdAt: '2020-01-01T00:00:00.000Z',
            updatedAt: '2020-01-02T00:00:00.000Z',
        }),
        makeRecipeListItem({
            id: 'rec_2',
            title: 'Asparagus with Green Sauce',
            createdAt: '2020-01-01T00:00:00.000Z',
            updatedAt: '2020-01-03T00:00:00.000Z',
        }),
    ];

    it('draws every compact tile with its Edited line', () => {
        render(results({ variant: 'compact', recipes: editedRecipes }));

        expect(screen.getAllByText(/^Edited /u)).toHaveLength(2);
    });
    // The 'two columns of padded cells' case moved to the capped-scale describe below ("is two columns at 1x on a phone"),
    // which sets the width and the scale the rule reads instead of leaning on jsdom's window.
});

// Designer rule (2026-11-02): the phone grid shows two columns only while the container width over the capped text scale is
// at least 320 pt. The list stub is display-inert for `numColumns`, so what shows is the cell: a grid cell carries the gap's
// side padding, a single column does not.
describe('RecipeListResults (native) — the compact grid’s columns follow the capped text scale', () => {
    /** The side padding of the wrapper around a card: 8 in a grid cell, none in a single column. */
    const cellPad = (title: string): string[] => {
        const out: string[] = [];

        for (
            let node = screen.getAllByText(title)[0]?.parentElement ?? null;
            node !== null;
            node = node.parentElement
        ) {
            out.push(getComputedStyle(node).paddingLeft);
        }

        return out;
    };

    it('is two columns at 1x on a phone', () => {
        dims.width = 390;
        dims.fontScale = 1;
        render(results({ variant: 'compact' }));

        expect(cellPad('Mediterranean Grilled Lamb')).toContain('8px');
    });

    it('is one column at 2x on the same phone', () => {
        dims.width = 390;
        dims.fontScale = 2;
        render(results({ variant: 'compact' }));

        expect(cellPad('Mediterranean Grilled Lamb')).not.toContain('8px');
    });

    it('reads the CAPPED scale: a 3.1x system scale is the 2x cap, no further', () => {
        dims.width = 700;
        dims.fontScale = 3.1;
        render(results({ variant: 'compact' }));

        // 700 / 2 = 350 pt a column, so still two; a raw 3.1 would have said one.
        expect(cellPad('Mediterranean Grilled Lamb')).toContain('8px');
    });
});

// Blank slot while scrolling (qa-ios, SearchPinnedScrolled_kbClosed_light_1x): ~100 pt of empty canvas between two rows of
// tiles. The grid cell was `flex: 1`; inside the recycler's cell, whose height is its first ESTIMATE until it is measured, a
// vertically growing child fills that estimate, so the cell is measured at the estimate and never shrinks to its tile.
// Only a device lays the recycler out; what jsdom can pin is that the cell no longer grows vertically.
describe('RecipeListResults (native) — a grid cell takes its tile’s height, never the recycler’s estimate', () => {
    it.each(['grid', 'compact'] as const)('the %s cell does not grow vertically', (variant) => {
        dims.width = variant === 'compact' ? 390 : 1000;
        dims.fontScale = 1;
        render(results({ variant }));
        const cell = ((): HTMLElement | undefined => {
            for (
                let node = screen.getAllByText('Mediterranean Grilled Lamb')[0]?.parentElement ?? null;
                node !== null;
                node = node.parentElement
            ) {
                if (getComputedStyle(node).paddingLeft === '8px') {
                    return node;
                }
            }

            return undefined;
        })();

        expect(cell).toBeDefined();
        expect(getComputedStyle(cell as HTMLElement).flexGrow).not.toBe('1');
    });
});

// qa-ios (r4): the gap reproduces only after a Grid -> List switch. The app opens in Grid, the cells measure at 199, the tap on
// "List view" re-measures them at 104.67, and FlashList keeps one stale slot (a 111 pt gap). A new layout is a new list: keyed on
// the variant and the column count, FlashList starts with an empty size cache (Discover's results do the same). The column count
// matters on its own because the 320 pt rule moves it when the text scale changes.
describe('RecipeListResults (native) — a new layout is a new list', () => {
    /** The element that scrolls around a card, or `null`. */
    const scrollerOf = (): HTMLElement | null => {
        for (
            let node = screen.getAllByText('Mediterranean Grilled Lamb')[0]?.parentElement ?? null;
            node !== null;
            node = node.parentElement
        ) {
            if (['auto', 'scroll'].includes(getComputedStyle(node).overflowY)) {
                return node;
            }
        }

        return null;
    };

    it('mounts a new list when the cook switches Grid to List, and keeps the same data', () => {
        dims.width = 390;
        dims.fontScale = 1;
        const { rerender } = render(results({ variant: 'compact' }));
        const grid = scrollerOf();

        rerender(results({ variant: 'row' }));

        expect(grid).not.toBeNull();
        expect(scrollerOf()).not.toBe(grid);
        expect(screen.getAllByText('Mediterranean Grilled Lamb')).toHaveLength(1);
    });

    it('mounts a new list when the text scale moves the compact grid from 2 columns to 1', () => {
        dims.width = 390;
        dims.fontScale = 1;
        const { rerender } = render(results({ variant: 'compact' }));
        const twoUp = scrollerOf();

        dims.fontScale = 2;
        rerender(results({ variant: 'compact' }));

        expect(scrollerOf()).not.toBe(twoUp);
    });

    it('keeps the same list for a re-render that changes neither (typing, a new page, a refresh)', () => {
        dims.width = 390;
        dims.fontScale = 1;
        const { rerender } = render(results({ variant: 'compact' }));
        const before = scrollerOf();

        rerender(results({ variant: 'compact', searchValue: 'lam' }));

        expect(scrollerOf()).toBe(before);
    });
});
