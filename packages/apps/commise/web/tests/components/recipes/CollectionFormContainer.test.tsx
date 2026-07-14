/**
 * Component tests for CollectionFormContainer (T073 web collection create/rename wiring). Covers both modes
 * over the shared CollectionForm building block: create (via useCreateCollection) and rename (seeded from
 * useCollection, via useUpdateCollection), each submitting and navigating on success, the empty-name guard,
 * and a surfaced mutation error. The query + mutation hooks and the Next router are mocked, so no backend or
 * QueryClient is needed.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CollectionFormContainer } from '@/components/recipes/CollectionFormContainer';

import { makeCollection } from './__fixtures__/collectionFixtures';

const { useCollectionMock, useCreateCollectionMock, useUpdateCollectionMock, createMutate, updateMutate, pushMock } =
    vi.hoisted(() => ({
        useCollectionMock: vi.fn(),
        useCreateCollectionMock: vi.fn(),
        useUpdateCollectionMock: vi.fn(),
        createMutate: vi.fn(),
        updateMutate: vi.fn(),
        pushMock: vi.fn(),
    }));

vi.mock('@kitchensink/recipe-service-client/hooks', () => ({
    useCollection: useCollectionMock,
    useCreateCollection: useCreateCollectionMock,
    useUpdateCollection: useUpdateCollectionMock,
}));

vi.mock('next/navigation', () => ({
    useRouter: () => ({ push: pushMock }),
}));

beforeEach(() => {
    useCollectionMock.mockReturnValue({ data: undefined, isLoading: false, isError: false });
    useCreateCollectionMock.mockReturnValue({ mutate: createMutate, isPending: false, isError: false, error: null });
    useUpdateCollectionMock.mockReturnValue({ mutate: updateMutate, isPending: false, isError: false, error: null });
});

afterEach(() => {
    vi.clearAllMocks();
});

describe('CollectionFormContainer', () => {
    describe('create mode', () => {
        it('renders the create form', () => {
            render(<CollectionFormContainer mode="create" locale="en" />);

            expect(screen.getByRole('form', { name: 'New collection' })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument();
        });

        it('creates a collection and navigates to it on success', async () => {
            const user = userEvent.setup();
            createMutate.mockImplementation((_vars: unknown, options?: { onSuccess?: (created: unknown) => void }) =>
                options?.onSuccess?.(makeCollection({ id: 'col_new' })),
            );

            render(<CollectionFormContainer mode="create" locale="en" />);

            await user.type(screen.getByRole('textbox', { name: 'Collection name' }), 'Holiday baking');
            await user.click(screen.getByRole('button', { name: 'Create' }));

            expect(createMutate).toHaveBeenCalledWith(
                { name: 'Holiday baking' },
                expect.objectContaining({ onSuccess: expect.any(Function) }),
            );
            expect(pushMock).toHaveBeenCalledWith('/en/collections/col_new');
        });

        it('does not submit an empty name and surfaces a validation error', async () => {
            const user = userEvent.setup();

            render(<CollectionFormContainer mode="create" locale="en" />);

            await user.click(screen.getByRole('button', { name: 'Create' }));

            expect(createMutate).not.toHaveBeenCalled();
            expect(screen.getByRole('alert')).toBeInTheDocument();
        });

        it('surfaces a mutation error', () => {
            useCreateCollectionMock.mockReturnValue({
                mutate: createMutate,
                isPending: false,
                isError: true,
                error: new Error('server down'),
            });

            render(<CollectionFormContainer mode="create" locale="en" />);

            expect(screen.getByRole('alert')).toBeInTheDocument();
        });
    });

    describe('rename mode', () => {
        it('seeds the current name and renders the rename form', () => {
            useCollectionMock.mockReturnValue({
                data: makeCollection({ id: 'col_1', name: 'Weeknight dinners' }),
                isLoading: false,
                isError: false,
            });

            render(<CollectionFormContainer mode="rename" collectionId="col_1" locale="en" />);

            expect(screen.getByRole('form', { name: 'Rename collection' })).toBeInTheDocument();
            expect(screen.getByDisplayValue('Weeknight dinners')).toBeInTheDocument();
        });

        it('updates the collection and navigates to it on success', async () => {
            const user = userEvent.setup();
            useCollectionMock.mockReturnValue({
                data: makeCollection({ id: 'col_1', name: 'Weeknight dinners' }),
                isLoading: false,
                isError: false,
            });
            updateMutate.mockImplementation((_vars: unknown, options?: { onSuccess?: (updated: unknown) => void }) =>
                options?.onSuccess?.(makeCollection({ id: 'col_1' })),
            );

            render(<CollectionFormContainer mode="rename" collectionId="col_1" locale="en" />);

            const input = screen.getByRole('textbox', { name: 'Collection name' });
            await user.clear(input);
            await user.type(input, 'Cozy dinners');
            await user.click(screen.getByRole('button', { name: 'Save' }));

            expect(updateMutate).toHaveBeenCalledWith(
                { id: 'col_1', request: { name: 'Cozy dinners' } },
                expect.objectContaining({ onSuccess: expect.any(Function) }),
            );
            expect(pushMock).toHaveBeenCalledWith('/en/collections/col_1');
        });
    });
});
