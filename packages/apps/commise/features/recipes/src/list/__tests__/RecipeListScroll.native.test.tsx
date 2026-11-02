/**
 * Designer finding C-2 (`nativeBoards/reviews/mergedUiIos1.md`, corrected in `designAnswers.md`): on a phone the Recipes
 * title, avatar, segments, chips and count bar are INSIDE the list's scroll content, so they scroll away with the cards
 * and never hold the screen at the large text sizes. The search field stays in the same scroller, where it sticks
 * (`searchSticks`). The frame and the results are rendered as the screen composes them: the results are the frame's
 * `children`.
 *
 * ⚠️ Proves the structure in jsdom only; that the header really scrolls away at the iOS cap shows only on a device
 * (`.maestro/recipes/headerScrollsAway.yaml`).
 */
import { LocaleProvider } from '@commise/i18n/react';
import { ScrollHost, useScrollHost } from '@commise/ui/scroll-host';
import { render } from '@commise/ui/testing/tamagui';
import { act } from '@testing-library/react';
import type { Animated } from 'react-native';
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeRecipeListItem } from '../../__fixtures__/index.js';
import type { RecipeListResultsProps } from '../model.js';
import { RecipeListFrame } from '../RecipeListFrame.native.js';
import { RecipeListResults } from '../RecipeListResults.native.js';

/** The system text scale, served by the test: jsdom has none to turn. */
const win = vi.hoisted(() => ({ fontScale: 1 }));

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return {
        ...actual,
        useWindowDimensions: () => ({
            ...actual.useWindowDimensions(),
            width: 390,
            height: 800,
            fontScale: win.fontScale,
        }),
    };
});

afterEach(() => {
    cleanup();
    win.fontScale = 1;
});

const noop = () => undefined;

const results: RecipeListResultsProps = {
    recipes: [makeRecipeListItem({ id: 'rec_1', title: 'Gourmet Garden Salad' })],
    state: 'results',
    searchValue: '',
    onClearSearch: noop,
    onClearFilters: noop,
    clearCount: 0,
    onSelectRecipe: noop,
    onCreateRecipe: noop,
    variant: 'row',
    chipOverflow: 'scroll',
    facets: {
        facets: [{ value: 'quick', label: 'Under 30 min', count: 1, selected: false }],
        onToggle: noop,
        onClear: noop,
    },
    view: { mode: 'list', onChange: noop },
    sort: { value: 'updatedAt', onChange: noop },
};

const screenTree = (
    <LocaleProvider locale="en">
        <RecipeListFrame
            searchValue=""
            onSearchChange={noop}
            searchVisible
            onCreateRecipe={noop}
            createEntryYields={false}
            headingFocusSignal={0}
            segments={{
                current: 'mine',
                href: { mine: '/en/recipes', collections: '/en/collections' },
                onSelect: noop,
            }}
        >
            <RecipeListResults {...results} />
        </RecipeListFrame>
    </LocaleProvider>
);

/** The nearest ancestor that scrolls vertically, or `null`. */
function scrollerOf(element: HTMLElement): HTMLElement | null {
    for (let node = element.parentElement; node !== null; node = node.parentElement) {
        if (['auto', 'scroll'].includes(getComputedStyle(node).overflowY)) {
            return node;
        }
    }

    return null;
}

describe('RecipeListFrame + RecipeListResults (native) — C-2: the header scrolls with the list', () => {
    it.each([
        ['the title', () => screen.getByRole('heading', { name: 'Recipes' })],
        ['the segments', () => screen.getByText('Collections')],
        ['the quick filters', () => screen.getByRole('group', { name: 'Quick filters' })],
        ['the count bar', () => screen.getByText('1 recipe')],
    ] as const)('%s sits in the same scroller as the cards', (_name, find) => {
        render(screenTree);
        const cardScroller = scrollerOf(screen.getByRole('link', { name: 'Gourmet Garden Salad' }));

        expect(cardScroller).not.toBeNull();
        expect(scrollerOf(find())).toBe(cardScroller);
    });
});

// The search field is NOT part of the scroll content: it is drawn once, above the list, and slides over a spacer the
// header holds (`RecipeListFrame.native.test.tsx` pins that structure). It must still be there exactly once, over the list.
describe('RecipeListFrame + RecipeListResults (native) — the search field is outside the scroller, once', () => {
    // REWRITTEN: while idle the field is hidden from the reading order (its stand-in is exposed instead), so it is found
    // with `hidden: true`; "exactly one" now means one text input in the page, and the reading-order test below pins which
    // node a screen reader reaches.
    it('is one field, drawn above the list rather than inside it', () => {
        render(screenTree);
        const field = screen.getByRole('textbox', { name: 'Search your recipes', hidden: true });
        const cardScroller = scrollerOf(screen.getByRole('link', { name: 'Gourmet Garden Salad' }));

        expect(screen.getAllByRole('textbox', { name: 'Search your recipes', hidden: true })).toHaveLength(1);
        expect(scrollerOf(field)).not.toBe(cardScroller);
    });
});

// The reading order a screen reader gets over the REAL list: the stand-in sits after the segments and BEFORE the quick
// filters and the cards (jsdom tree order; the swipe order itself is a physical-device check).
describe('RecipeListFrame + RecipeListResults (native) — the search stand-in reads between the segments and the chips', () => {
    it('comes after the segments and before the quick filters, the count bar and the cards', () => {
        render(screenTree);
        const stand = screen.getByRole('search', { name: 'Search your recipes' });
        const follows = (earlier: HTMLElement, later: HTMLElement): boolean =>
            Boolean(earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING);

        expect(follows(screen.getByRole('tab', { name: 'Collections' }), stand)).toBe(true);
        expect(follows(stand, screen.getByRole('group', { name: 'Quick filters' }))).toBe(true);
        expect(follows(stand, screen.getByText('1 recipe'))).toBe(true);
        expect(follows(stand, screen.getByRole('link', { name: 'Gourmet Garden Salad' }))).toBe(true);
        expect(screen.queryAllByRole('textbox', { name: 'Search your recipes' })).toHaveLength(0);
    });
});

// Designer defect (PinReset_TextScaleToCap_light_cap): pinned at 1x, the text size goes to the cap, and the field floats over the
// title at its OLD pinned place while an empty slot stays between the segments and the chips. The list sits at the top again, but the
// host's offset is written only by native scroll events and kept its pinned value, so the pin (and its band) read a scroll that is no
// longer there. A change of text scale re-lays the whole list out, so it is a new list: keyed on the capped scale, the scroller
// is replaced and the host resets its offset when the new one attaches.
describe('RecipeListFrame + RecipeListResults (native) — a text-scale change clears the pin', () => {
    function OffsetProbe({ onOffset }: { readonly onOffset: (scrollY: Animated.Value) => void }) {
        const { scrollY } = useScrollHost();

        if (scrollY !== undefined) {
            onOffset(scrollY);
        }

        return null;
    }

    const hostedTree = (onOffset: (scrollY: Animated.Value) => void) => (
        <ScrollHost>
            {(bind) => (
                <LocaleProvider locale="en">
                    <RecipeListFrame
                        searchValue=""
                        onSearchChange={noop}
                        searchVisible
                        onCreateRecipe={noop}
                        createEntryYields={false}
                        headingFocusSignal={0}
                    >
                        <RecipeListResults {...results} variant="row" scrollBind={bind} />
                        <OffsetProbe onOffset={onOffset} />
                    </RecipeListFrame>
                </LocaleProvider>
            )}
        </ScrollHost>
    );

    const bandOpacity = (): number =>
        Number(((screen.getByTestId('searchBand') as HTMLElement).parentElement as HTMLElement).style.opacity);

    it('un-pins the field and its band when the text goes from 1x to the cap while pinned', () => {
        const seen: { scrollY?: Animated.Value } = {};
        const { rerender } = render(hostedTree((scrollY) => (seen.scrollY = scrollY)));

        act(() => seen.scrollY?.setValue(900));
        expect(bandOpacity()).toBe(1);

        win.fontScale = 2;
        rerender(hostedTree((scrollY) => (seen.scrollY = scrollY)));

        expect(bandOpacity()).toBe(0);
    });

    it('keeps the pin for a re-render that does not change the text scale', () => {
        const seen: { scrollY?: Animated.Value } = {};
        const { rerender } = render(hostedTree((scrollY) => (seen.scrollY = scrollY)));

        act(() => seen.scrollY?.setValue(900));
        rerender(hostedTree((scrollY) => (seen.scrollY = scrollY)));

        expect(bandOpacity()).toBe(1);
    });
});
