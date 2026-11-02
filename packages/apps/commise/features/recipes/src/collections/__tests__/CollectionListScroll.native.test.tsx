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
import { render, renderWithTamagui } from '@commise/ui/testing/tamagui';
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

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return { ...actual, useWindowDimensions: () => ({ ...actual.useWindowDimensions(), width: 390 }) };
});

afterEach(cleanup);

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

function screenTree(overrides: Partial<CollectionListResultsProps> = {}) {
    const props: CollectionListResultsProps = {
        collections: [],
        total: overrides.collections?.length ?? 0,
        onSelect: noop,
        search: { value: '', onChange: noop },
        firstRun: { hasRecipes: true, onCreate: noop, onAddRecipe: noop },
        ...overrides,
    };

    return (
        <LocaleProvider locale="en">
            <CollectionListFrame
                onCreate={noop}
                headingFocusSignal={0}
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
        renderWithTamagui(
            screenTree({ firstRun: { hasRecipes: false, onCreate: noop, onAddRecipe: noop } }),
            'light',
            3.1,
        );
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
        const field = screen.getByLabelText('Search your collections');

        rerender(screenTree({ collections: [], total: 6, search: { value: 'zzz', onChange: noop } }));

        expect(screen.getByLabelText('Search your collections')).toBe(field);
        expect(screen.getByRole('heading', { name: 'Recipes' })).toBeTruthy();
        expect(scrollerOf(screen.getByRole('heading', { name: 'Recipes' }))).toBe(
            scrollerOf(screen.getByRole('status')),
        );
    });

    it('keeps its own jobs: New collection still reaches onCreate from the first run', () => {
        const onCreate = vi.fn();
        render(screenTree({ firstRun: { hasRecipes: true, onCreate, onAddRecipe: noop } }));

        fireEvent.click(screen.getAllByRole('button', { name: 'New collection' })[0] as HTMLElement);

        expect(onCreate).toHaveBeenCalled();
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
