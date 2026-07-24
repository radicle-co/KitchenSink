/**
 * Component tests for the mobile CollectionsScreen (react-native-web under jsdom, T071 + W5/C7). The screen
 * drives the shared native `CollectionList` from (mocked) `useCollectionsInfinite`, mapping query state to the
 * view status and deriving rows from the flattened paginated cache. Covers loading, error (+ retry), empty,
 * populated (+ select + create), and the server-paged load-more affordance.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { useCollectionsInfinite } from '@kitchensink/recipe-service-client/hooks';

import { CollectionsScreen } from '../../src/screens/CollectionsScreen.js';
import { makeCollection, makeCollectionPage } from '../__fixtures__/recipes.js';

vi.mock('@kitchensink/recipe-service-client/hooks', () => ({
    useCollectionsInfinite: vi.fn(),
}));

const useCollectionsInfiniteMock = vi.mocked(useCollectionsInfinite);

function infiniteResult(
    overrides: Partial<ReturnType<typeof useCollectionsInfinite>> = {},
): ReturnType<typeof useCollectionsInfinite> {
    return {
        isLoading: false,
        isError: false,
        data: undefined,
        hasNextPage: false,
        isFetchingNextPage: false,
        fetchNextPage: vi.fn(),
        refetch: vi.fn(),
        ...overrides,
    } as unknown as ReturnType<typeof useCollectionsInfinite>;
}

/** Wrap one or more paginated pages in the infinite-query `{ pages, pageParams }` cache shape. */
function pages(...collectionPages: ReturnType<typeof makeCollectionPage>[]) {
    return { pages: collectionPages, pageParams: collectionPages.map((_, index) => index + 1) };
}

afterEach(cleanup);

beforeEach(() => {
    useCollectionsInfiniteMock.mockReset();
});

describe('CollectionsScreen — loading, error, empty', () => {
    it('shows the loading indicator while collections load', () => {
        useCollectionsInfiniteMock.mockReturnValue(infiniteResult({ isLoading: true }));

        render(<CollectionsScreen onSelect={vi.fn()} onCreate={vi.fn()} />);

        expect(screen.getByLabelText('Loading collections')).toBeTruthy();
    });

    it('shows an alert and retries from the retry action', () => {
        const refetch = vi.fn();
        useCollectionsInfiniteMock.mockReturnValue(infiniteResult({ isError: true, refetch: refetch as never }));

        render(<CollectionsScreen onSelect={vi.fn()} onCreate={vi.fn()} />);

        expect(screen.getByRole('alert')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        expect(refetch).toHaveBeenCalledTimes(1);
    });

    it('shows the empty state when a successful load returns no collections', () => {
        useCollectionsInfiniteMock.mockReturnValue(infiniteResult({ data: pages(makeCollectionPage([])) as never }));

        render(<CollectionsScreen onSelect={vi.fn()} onCreate={vi.fn()} />);

        expect(screen.getByText('No collections yet')).toBeTruthy();
    });
});

describe('CollectionsScreen — populated', () => {
    beforeEach(() => {
        useCollectionsInfiniteMock.mockReturnValue(
            infiniteResult({
                data: pages(
                    makeCollectionPage([makeCollection({ id: 'col_1', name: 'Weeknight favourites' })]),
                ) as never,
            }),
        );
    });

    it('forwards the selected collection id upward', () => {
        const onSelect = vi.fn();

        render(<CollectionsScreen onSelect={onSelect} onCreate={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Weeknight favourites' }));

        expect(onSelect).toHaveBeenCalledWith('col_1');
    });

    it('forwards create requests upward', () => {
        const onCreate = vi.fn();

        render(<CollectionsScreen onSelect={vi.fn()} onCreate={onCreate} />);
        fireEvent.click(screen.getByRole('button', { name: 'New collection' }));

        expect(onCreate).toHaveBeenCalledTimes(1);
    });
});

describe('CollectionsScreen — server-paged load-more (W5/C7)', () => {
    it('flattens fetched pages and advances the page from the load-more control', () => {
        const fetchNextPage = vi.fn();
        useCollectionsInfiniteMock.mockReturnValue(
            infiniteResult({
                data: pages(
                    makeCollectionPage([makeCollection({ id: 'col_1', name: 'Weeknight favourites' })], {
                        hasMore: true,
                    }),
                    makeCollectionPage([makeCollection({ id: 'col_2', name: 'Holiday baking' })]),
                ) as never,
                hasNextPage: true,
                fetchNextPage: fetchNextPage as never,
            }),
        );

        render(<CollectionsScreen onSelect={vi.fn()} onCreate={vi.fn()} />);

        expect(screen.getByRole('button', { name: 'Weeknight favourites' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Holiday baking' })).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
        expect(fetchNextPage).toHaveBeenCalledTimes(1);
    });
});
