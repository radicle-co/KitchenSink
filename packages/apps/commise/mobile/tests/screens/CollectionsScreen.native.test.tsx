/**
 * Component tests for the mobile CollectionsScreen (react-native-web under jsdom, T071). The screen drives the
 * shared native `CollectionList` from (mocked) `useCollections`, mapping query state to the view status and
 * deriving rows from the paginated cache. Covers loading, error (+ retry), empty, and populated (+ select +
 * create).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { useCollections } from '@kitchensink/recipe-service-client/hooks';

import { CollectionsScreen } from '../../src/screens/CollectionsScreen.js';
import { makeCollection, makeCollectionPage } from '../__fixtures__/recipes.js';

vi.mock('@kitchensink/recipe-service-client/hooks', () => ({
    useCollections: vi.fn(),
}));

const useCollectionsMock = vi.mocked(useCollections);

function collectionsResult(
    overrides: Partial<ReturnType<typeof useCollections>> = {},
): ReturnType<typeof useCollections> {
    return {
        isLoading: false,
        isError: false,
        data: undefined,
        refetch: vi.fn(),
        ...overrides,
    } as unknown as ReturnType<typeof useCollections>;
}

afterEach(cleanup);

beforeEach(() => {
    useCollectionsMock.mockReset();
});

describe('CollectionsScreen — loading, error, empty', () => {
    it('shows the loading indicator while collections load', () => {
        useCollectionsMock.mockReturnValue(collectionsResult({ isLoading: true }));

        render(<CollectionsScreen onSelect={vi.fn()} onCreate={vi.fn()} />);

        expect(screen.getByLabelText('Loading collections')).toBeTruthy();
    });

    it('shows an alert and retries from the retry action', () => {
        const refetch = vi.fn();
        useCollectionsMock.mockReturnValue(collectionsResult({ isError: true, refetch }));

        render(<CollectionsScreen onSelect={vi.fn()} onCreate={vi.fn()} />);

        expect(screen.getByRole('alert')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        expect(refetch).toHaveBeenCalledTimes(1);
    });

    it('shows the empty state when a successful load returns no collections', () => {
        useCollectionsMock.mockReturnValue(collectionsResult({ data: makeCollectionPage([]) }));

        render(<CollectionsScreen onSelect={vi.fn()} onCreate={vi.fn()} />);

        expect(screen.getByText('No collections yet')).toBeTruthy();
    });
});

describe('CollectionsScreen — populated', () => {
    beforeEach(() => {
        useCollectionsMock.mockReturnValue(
            collectionsResult({
                data: makeCollectionPage([makeCollection({ id: 'col_1', name: 'Weeknight favourites' })]),
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
