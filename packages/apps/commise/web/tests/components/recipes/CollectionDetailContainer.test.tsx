/**
 * Component tests for CollectionDetailContainer (T072 web collection-detail wiring). Covers every state the
 * container renders — loading, ready (delegates to the shared CollectionDetail), generic error (with retry),
 * and a distinct not-found affordance — plus the wired member/collection mutations (remove member, delete
 * collection → navigate to list) and navigation (rename, select recipe). The collection query + mutation
 * hooks and the Next router are mocked, so no backend or QueryClient is needed; the real `isNotFoundError`
 * guard classifies the error.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NotFoundError } from '@kitchensink/recipe-service-client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CollectionDetailContainer } from '@/components/recipes/CollectionDetailContainer';

import { makeCollectionWithRecipes } from './__fixtures__/collectionFixtures';

const { useCollectionMock, removeMutate, deleteMutate, pushMock, refetchMock } = vi.hoisted(() => ({
    useCollectionMock: vi.fn(),
    removeMutate: vi.fn(),
    deleteMutate: vi.fn(),
    pushMock: vi.fn(),
    refetchMock: vi.fn(),
}));

vi.mock('@kitchensink/recipe-service-client/hooks', () => ({
    useCollection: useCollectionMock,
    useRemoveRecipeFromCollection: () => ({ mutate: removeMutate }),
    useDeleteCollection: () => ({ mutate: deleteMutate }),
}));

vi.mock('next/navigation', () => ({
    useRouter: () => ({ push: pushMock }),
}));

afterEach(() => {
    vi.clearAllMocks();
});

describe('CollectionDetailContainer', () => {
    it('renders the loading state while the query is pending', () => {
        useCollectionMock.mockReturnValue({ isLoading: true, isError: false, data: undefined, refetch: refetchMock });

        render(<CollectionDetailContainer id="col_1" locale="en" />);

        expect(screen.getByRole('status', { name: 'Loading collection' })).toBeInTheDocument();
    });

    it('renders the collection with its member recipes when it loads', () => {
        useCollectionMock.mockReturnValue({
            isLoading: false,
            isError: false,
            data: makeCollectionWithRecipes({ name: 'Weeknight dinners' }),
            refetch: refetchMock,
        });

        render(<CollectionDetailContainer id="col_1" locale="en" />);

        expect(screen.getByRole('heading', { level: 1, name: 'Weeknight dinners' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Weeknight Pasta' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Sunday Roast' })).toBeInTheDocument();
    });

    it('removes a member recipe through the mutation', async () => {
        const user = userEvent.setup();
        useCollectionMock.mockReturnValue({
            isLoading: false,
            isError: false,
            data: makeCollectionWithRecipes({ id: 'col_9' }),
            refetch: refetchMock,
        });

        render(<CollectionDetailContainer id="col_9" locale="en" />);

        await user.click(screen.getByRole('button', { name: 'Remove Weeknight Pasta' }));

        expect(removeMutate).toHaveBeenCalledWith({ id: 'col_9', recipeId: 'rec_1' });
    });

    it('deletes the collection and navigates back to the list', async () => {
        const user = userEvent.setup();
        deleteMutate.mockImplementation((_id: string, options?: { onSuccess?: () => void }) => options?.onSuccess?.());
        useCollectionMock.mockReturnValue({
            isLoading: false,
            isError: false,
            data: makeCollectionWithRecipes({ id: 'col_9' }),
            refetch: refetchMock,
        });

        render(<CollectionDetailContainer id="col_9" locale="en" />);

        await user.click(screen.getByRole('button', { name: 'Delete' }));

        expect(deleteMutate).toHaveBeenCalledWith(
            'col_9',
            expect.objectContaining({ onSuccess: expect.any(Function) }),
        );
        expect(pushMock).toHaveBeenCalledWith('/en/collections');
    });

    it('navigates to the rename form when rename is activated', async () => {
        const user = userEvent.setup();
        useCollectionMock.mockReturnValue({
            isLoading: false,
            isError: false,
            data: makeCollectionWithRecipes({ id: 'col_9' }),
            refetch: refetchMock,
        });

        render(<CollectionDetailContainer id="col_9" locale="en" />);

        await user.click(screen.getByRole('button', { name: 'Rename' }));

        expect(pushMock).toHaveBeenCalledWith('/en/collections/col_9/rename');
    });

    it('navigates to a recipe when a member row is selected', async () => {
        const user = userEvent.setup();
        useCollectionMock.mockReturnValue({
            isLoading: false,
            isError: false,
            data: makeCollectionWithRecipes(),
            refetch: refetchMock,
        });

        render(<CollectionDetailContainer id="col_1" locale="en" />);

        await user.click(screen.getByRole('button', { name: 'Weeknight Pasta' }));

        expect(pushMock).toHaveBeenCalledWith('/en/recipes/rec_1');
    });

    it('renders a generic error with retry when the load fails', async () => {
        const user = userEvent.setup();
        useCollectionMock.mockReturnValue({
            isLoading: false,
            isError: true,
            error: new Error('network down'),
            data: undefined,
            refetch: refetchMock,
        });

        render(<CollectionDetailContainer id="col_1" locale="en" />);

        expect(screen.getByRole('alert')).toBeInTheDocument();
        expect(screen.getByText(/couldn.t load this collection/i)).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Try again' }));

        expect(refetchMock).toHaveBeenCalledTimes(1);
    });

    it('renders a distinct not-found message with no retry for a 404', () => {
        useCollectionMock.mockReturnValue({
            isLoading: false,
            isError: true,
            error: new NotFoundError(),
            data: undefined,
            refetch: refetchMock,
        });

        render(<CollectionDetailContainer id="missing" locale="en" />);

        expect(screen.getByText(/couldn.t find that collection/i)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    });
});
