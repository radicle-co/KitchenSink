/**
 * Component tests for CollectionListContainer (T071 web collection-list wiring). Covers every state the
 * container projects onto the shared CollectionList building block — loading, populated, empty, error (with
 * retry) — plus navigation on select/create. The collection hook + Next router are mocked, so no backend or
 * QueryClient is needed.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CollectionListContainer } from '@/components/recipes/CollectionListContainer';

import { makeCollection, makeCollectionsPage } from './__fixtures__/collectionFixtures';

const { useCollectionsMock, pushMock, refetchMock } = vi.hoisted(() => ({
    useCollectionsMock: vi.fn(),
    pushMock: vi.fn(),
    refetchMock: vi.fn(),
}));

vi.mock('@kitchensink/recipe-service-client/hooks', () => ({
    useCollections: useCollectionsMock,
}));

vi.mock('next/navigation', () => ({
    useRouter: () => ({ push: pushMock }),
}));

afterEach(() => {
    vi.clearAllMocks();
});

describe('CollectionListContainer', () => {
    it('renders the loading state while the query is pending', () => {
        useCollectionsMock.mockReturnValue({ isLoading: true, isError: false, data: undefined, refetch: refetchMock });

        render(<CollectionListContainer locale="en" />);

        expect(screen.getByRole('status', { name: 'Loading collections' })).toBeInTheDocument();
    });

    it('renders the populated list when collections load', () => {
        useCollectionsMock.mockReturnValue({
            isLoading: false,
            isError: false,
            data: makeCollectionsPage([
                makeCollection({ id: 'col_1', name: 'Weeknight dinners' }),
                makeCollection({ id: 'col_2', name: 'Holiday baking' }),
            ]),
            refetch: refetchMock,
        });

        render(<CollectionListContainer locale="en" />);

        expect(screen.getByRole('button', { name: 'Weeknight dinners' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Holiday baking' })).toBeInTheDocument();
    });

    it('renders the empty state when the load succeeds with no collections', () => {
        useCollectionsMock.mockReturnValue({
            isLoading: false,
            isError: false,
            data: makeCollectionsPage([]),
            refetch: refetchMock,
        });

        render(<CollectionListContainer locale="en" />);

        expect(screen.getByText('No collections yet')).toBeInTheDocument();
    });

    it('renders the error state and retries on demand', async () => {
        const user = userEvent.setup();
        useCollectionsMock.mockReturnValue({ isLoading: false, isError: true, data: undefined, refetch: refetchMock });

        render(<CollectionListContainer locale="en" />);

        expect(screen.getByRole('alert')).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Try again' }));

        expect(refetchMock).toHaveBeenCalledTimes(1);
    });

    it('navigates to the collection detail route when a collection is selected', async () => {
        const user = userEvent.setup();
        useCollectionsMock.mockReturnValue({
            isLoading: false,
            isError: false,
            data: makeCollectionsPage([makeCollection({ id: 'col_42', name: 'Weeknight dinners' })]),
            refetch: refetchMock,
        });

        render(<CollectionListContainer locale="en" />);

        await user.click(screen.getByRole('button', { name: 'Weeknight dinners' }));

        expect(pushMock).toHaveBeenCalledWith('/en/collections/col_42');
    });

    it('navigates to the create route from the create call to action', async () => {
        const user = userEvent.setup();
        useCollectionsMock.mockReturnValue({
            isLoading: false,
            isError: false,
            data: makeCollectionsPage([]),
            refetch: refetchMock,
        });

        render(<CollectionListContainer locale="en" />);

        await user.click(screen.getByRole('button', { name: 'New collection' }));

        expect(pushMock).toHaveBeenCalledWith('/en/collections/new');
    });
});
