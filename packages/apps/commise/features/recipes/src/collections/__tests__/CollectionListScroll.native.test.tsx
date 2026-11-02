/**
 * Designer finding on collScroll (C-2, the Collections half): at the largest text size the "Recipes" title and the
 * segments stayed fixed while the empty state scrolled under them, which left almost no room to read it. Collections has
 * no pinned field, so the WHOLE header scrolls away with the content, in every state the list can be in. The frame and
 * the results are rendered as the screen composes them: the results are the frame's `children`.
 *
 * ⚠️ Proves the structure in jsdom only; that the header really scrolls away at the iOS cap shows only on a device.
 */
import { LocaleProvider } from '@commise/i18n/react';
import { makeCollection } from '@kitchensink/recipe-core/testing';
import { render, renderWithTamagui, resolvedStyle } from '@commise/ui/testing/tamagui';
import { cleanup, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CollectionListFrame } from '../CollectionListFrame.native.js';
import { CollectionListLoadError } from '../CollectionListLoadError.native.js';
import { CollectionListLoading } from '../CollectionListLoading.native.js';
import { CollectionListResults } from '../CollectionListResults.native.js';
import { collectionMessages } from '../messages.js';
import type { CollectionListResultsProps } from '../model.js';

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

const rows = [
    makeCollection({ id: 'col_1', name: 'Weeknight Dinners', visibility: 'private' }),
    makeCollection({ id: 'col_2', name: 'Holiday Baking', visibility: 'private' }),
    makeCollection({ id: 'col_3', name: 'Meal Prep', visibility: 'private' }),
];

function framed(body: ReactNode) {
    return (
        <LocaleProvider locale="en">
            <CollectionListFrame onCreate={noop} headingFocusSignal={0}>
                {body}
            </CollectionListFrame>
        </LocaleProvider>
    );
}

function screenTree(overrides: Partial<CollectionListResultsProps> = {}, searchValue = '') {
    const props: CollectionListResultsProps = {
        collections: [],
        total: overrides.collections?.length ?? 0,
        onSelect: noop,
        search: { value: '', onChange: noop },
        firstRun: { hasRecipes: true, onAddRecipe: noop },
        ...overrides,
    };

    return (
        <LocaleProvider locale="en">
            <CollectionListFrame
                onCreate={noop}
                headingFocusSignal={0}
                // The host's rule: the pinned search shows from six collections, and while the cook has typed.
                search={{ value: searchValue, onChange: noop, visible: props.total >= 6 || searchValue !== '' }}
                segments={{
                    current: 'collections',
                    href: { mine: '/en/recipes', collections: '/en/collections' },
                    onSelect: noop,
                }}
            >
                <CollectionListResults {...props} />
            </CollectionListFrame>
        </LocaleProvider>
    );
}

/** The nearest ancestor that scrolls vertically, or `null`. */
function scrollerOf(element: HTMLElement): HTMLElement | null {
    for (let node = element.parentElement; node !== null; node = node.parentElement) {
        if (['auto', 'scroll'].includes(getComputedStyle(node).overflowY)) {
            return node;
        }
    }

    return null;
}

describe('Collections — the whole header scrolls with the content', () => {
    it('first run: the title and the segments sit in the same scroller as the empty state, at the iOS cap', () => {
        renderWithTamagui(screenTree(), 'light', 3.1);
        const body = scrollerOf(screen.getByText('Group recipes your way'));

        expect(body).not.toBeNull();
        expect(scrollerOf(screen.getByRole('heading', { name: 'Recipes' }))).toBe(body);
        expect(scrollerOf(screen.getByRole('tab', { name: 'My recipes' }))).toBe(body);
    });

    it('first run with no recipes yet: the same, around "Add a recipe"', () => {
        renderWithTamagui(screenTree({ firstRun: { hasRecipes: false, onAddRecipe: noop } }), 'light', 3.1);
        const body = scrollerOf(screen.getByRole('button', { name: 'Add a recipe' }));

        expect(body).not.toBeNull();
        expect(scrollerOf(screen.getByRole('heading', { name: 'Recipes' }))).toBe(body);
    });

    it.each([
        ['the title', () => screen.getByRole('heading', { name: 'Recipes' })],
        ['the segments', () => screen.getByRole('tab', { name: 'My recipes' })],
        ['the count', () => screen.getByText('3 collections')],
    ] as const)('populated: %s sits in the same scroller as the cards', (_name, find) => {
        render(screenTree({ collections: rows }));
        const cards = scrollerOf(screen.getByRole('link', { name: 'Weeknight Dinners, Private' }));

        expect(cards).not.toBeNull();
        expect(scrollerOf(find())).toBe(cards);
    });

    it('the segments read before the cards, and the title before the segments', () => {
        render(screenTree({ collections: rows }));
        const follows = (earlier: HTMLElement, later: HTMLElement): boolean =>
            Boolean(earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING);

        expect(
            follows(screen.getByRole('heading', { name: 'Recipes' }), screen.getByRole('tab', { name: 'My recipes' })),
        ).toBe(true);
        expect(
            follows(
                screen.getByRole('tab', { name: 'My recipes' }),
                screen.getByRole('link', { name: 'Weeknight Dinners, Private' }),
            ),
        ).toBe(true);
    });

    it('no match: the header stays, the field keeps its node and the "no match" line is in the same scroller', () => {
        const six = Array.from({ length: 6 }, (_unused, index) =>
            makeCollection({ id: `c${index}`, name: `C ${index}` }),
        );
        const { rerender } = render(screenTree({ collections: six, total: 6 }));
        const field = screen.getByLabelText(collectionMessages.en.list.searchLabel, { selector: 'input' });

        rerender(screenTree({ collections: [], total: 6, search: { value: 'zzz', onChange: noop } }, 'zzz'));

        expect(screen.getByLabelText(collectionMessages.en.list.searchLabel, { selector: 'input' })).toBe(field);
        expect(screen.getByRole('heading', { name: 'Recipes' })).toBeTruthy();
        expect(scrollerOf(screen.getByRole('heading', { name: 'Recipes' }))).toBe(
            scrollerOf(screen.getByRole('status')),
        );
    });

    // Designer ruling (2026-11-03): "New collection" floats in the first run too, the same as "New recipe": exactly ONE button,
    // the frame's, outside the scroller so it never scrolls away; the empty state's heading and body are what scroll, and
    // they follow the text caps. (qa-ios: at the largest size the in-flow button sat below a page that did not scroll.)
    it("first run: one New collection button, the frame's floating one, outside the scroller", () => {
        const onCreate = vi.fn();
        renderWithTamagui(
            <LocaleProvider locale="en">
                <CollectionListFrame onCreate={onCreate} headingFocusSignal={0}>
                    <CollectionListResults
                        collections={[]}
                        total={0}
                        onSelect={noop}
                        search={{ value: '', onChange: noop }}
                        firstRun={{ hasRecipes: true, onAddRecipe: noop }}
                    />
                </CollectionListFrame>
            </LocaleProvider>,
            'light',
            3.1,
        );
        const buttons = screen.getAllByRole('button', { name: 'New collection' });

        expect(buttons).toHaveLength(1);
        expect(scrollerOf(buttons[0] as HTMLElement)).toBeNull();
        expect(scrollerOf(screen.getByText('Group recipes your way'))).not.toBeNull();

        fireEvent.click(buttons[0] as HTMLElement);

        expect(onCreate).toHaveBeenCalledTimes(1);
    });
});

// The loading and failed states are not the list, so they draw the frame's header themselves: it must not vanish while the
// first page is pending or after it failed, and it scrolls with the state's own body.
describe('Collections — the header stays in the loading and failed states', () => {
    it('loading: the title is there, in the same scroller as the skeleton', () => {
        render(framed(<CollectionListLoading />));
        const skeleton = screen.getByLabelText(collectionMessages.en.list.loadingLabel);

        expect(scrollerOf(screen.getByRole('heading', { name: 'Recipes' }))).toBe(scrollerOf(skeleton));
        expect(scrollerOf(skeleton)).not.toBeNull();
    });

    it('failed: the title is there, in the same scroller as the retry', () => {
        render(framed(<CollectionListLoadError onRetry={noop} />));
        const retry = screen.getByRole('button', { name: collectionMessages.en.list.retry });

        expect(scrollerOf(screen.getByRole('heading', { name: 'Recipes' }))).toBe(scrollerOf(retry));
        expect(scrollerOf(retry)).not.toBeNull();
    });
});

// Designer ruling (2026-11-02): the Collections search pins on a band, as Recipes'. The frame draws the field ONCE over a spacer the
// header holds; the title, segments and count scroll away. These are the composed screen's cases; the frame's own are in
// `CollectionListFrame.native.test.tsx`.
describe('Collections — the search pins, the rest scrolls', () => {
    const six = Array.from({ length: 6 }, (_unused, index) =>
        makeCollection({ id: `c${index}`, name: `Collection ${String(index)}` }),
    );
    const NAME = collectionMessages.en.list.searchLabel;

    it('draws the field outside the scroller, and its stand-in inside it, after the segments and before the count', () => {
        render(screenTree({ collections: six, total: 6 }));
        const cards = scrollerOf(screen.getByRole('link', { name: 'Collection 0, Private' }));
        const stand = screen.getByRole('search', { name: NAME });
        const field = screen.getByLabelText(NAME, { selector: 'input' });
        const follows = (earlier: HTMLElement, later: HTMLElement): boolean =>
            Boolean(earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING);

        expect(scrollerOf(stand)).toBe(cards);
        expect(scrollerOf(field)).not.toBe(cards);
        expect(follows(screen.getByRole('tab', { name: 'My recipes' }), stand)).toBe(true);
        expect(follows(stand, screen.getByText('6 collections'))).toBe(true);
    });

    it('draws no field below six collections', () => {
        render(screenTree({ collections: rows }));

        expect(screen.queryByLabelText(NAME)).toBeNull();
        expect(screen.queryByRole('search', { name: NAME })).toBeNull();
    });

    // The designer's gap: the next row after the field is $4 (16 pt) below it, through the shared ListHeaderBox, no new number.
    it('puts the count row 16 pt below the field, in the header box', () => {
        render(screenTree({ collections: six, total: 6 }));
        const stand = screen.getByRole('search', { name: NAME });
        const box = (() => {
            for (let node = stand.parentElement; node !== null; node = node.parentElement) {
                if (resolvedStyle(node, 'paddingBottom') === '16px') {
                    return node;
                }
            }

            return null;
        })();

        expect(box).not.toBeNull();
        expect(box?.contains(screen.getByText('6 collections'))).toBe(false);
    });

    // qa-ios (ScaleToCap): a change of text scale re-lays the list out and the host's offset kept its pinned value. The list is
    // keyed on the capped scale (1.05 keeps two columns, so only the scale differs), so the scroller is replaced and the host resets.
    it('mounts a new list when the text scale changes', () => {
        win.fontScale = 1;
        const { rerender } = render(screenTree({ collections: six, total: 6 }));
        const before = scrollerOf(screen.getByRole('link', { name: 'Collection 0, Private' }));

        win.fontScale = 1.05;
        rerender(screenTree({ collections: six, total: 6 }));

        expect(scrollerOf(screen.getByRole('link', { name: 'Collection 0, Private' }))).not.toBe(before);
    });
});
