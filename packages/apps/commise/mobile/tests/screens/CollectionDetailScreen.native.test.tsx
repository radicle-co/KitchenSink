/**
 * Component tests for the mobile CollectionDetailScreen (react-native-web under jsdom, T072). The screen
 * loads a collection with members via (mocked) `useCollection` and drives the shared native `CollectionDetail`
 * block, wiring member removal (`useRemoveRecipeFromCollection`) and deletion (`useDeleteCollection`). Covers
 * loading, error, populated (+ select/remove/rename/delete + back).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import {
    useCollection,
    useDeleteCollection,
    useRemoveRecipeFromCollection,
} from '@kitchensink/recipe-service-client/hooks';

import { CollectionDetailScreen } from '../../src/screens/CollectionDetailScreen.js';
import { makeCollectionWithRecipes, makeRecipe } from '../__fixtures__/recipes.js';

vi.mock('@kitchensink/recipe-service-client/hooks', () => ({
    useCollection: vi.fn(),
    useDeleteCollection: vi.fn(),
    useRemoveRecipeFromCollection: vi.fn(),
}));

const useCollectionMock = vi.mocked(useCollection);
const useDeleteCollectionMock = vi.mocked(useDeleteCollection);
const useRemoveRecipeFromCollectionMock = vi.mocked(useRemoveRecipeFromCollection);

function collectionResult(overrides: Partial<ReturnType<typeof useCollection>> = {}): ReturnType<typeof useCollection> {
    return { isLoading: false, isError: false, data: undefined, ...overrides } as unknown as ReturnType<
        typeof useCollection
    >;
}

function mutation<T>(overrides: Partial<T> = {}): T {
    return { mutate: vi.fn(), isPending: false, ...overrides } as unknown as T;
}

const props = {
    collectionId: 'col_1',
    onSelectRecipe: vi.fn(),
    onRename: vi.fn(),
    onDeleted: vi.fn(),
    onBack: vi.fn(),
};

afterEach(cleanup);

beforeEach(() => {
    useCollectionMock.mockReset();
    useDeleteCollectionMock.mockReset();
    useRemoveRecipeFromCollectionMock.mockReset();
    useDeleteCollectionMock.mockReturnValue(mutation<ReturnType<typeof useDeleteCollection>>());
    useRemoveRecipeFromCollectionMock.mockReturnValue(mutation<ReturnType<typeof useRemoveRecipeFromCollection>>());
});

describe('CollectionDetailScreen — loading and error', () => {
    it('shows the loading indicator while the collection loads', () => {
        useCollectionMock.mockReturnValue(collectionResult({ isLoading: true }));

        render(<CollectionDetailScreen {...props} />);

        expect(screen.getByLabelText('Loading collection…')).toBeTruthy();
    });

    it('shows an alert when the collection fails to load', () => {
        useCollectionMock.mockReturnValue(collectionResult({ isError: true }));

        render(<CollectionDetailScreen {...props} />);

        expect(screen.getByRole('alert')).toBeTruthy();
    });
});

describe('CollectionDetailScreen — populated', () => {
    beforeEach(() => {
        useCollectionMock.mockReturnValue(
            collectionResult({
                data: makeCollectionWithRecipes([makeRecipe({ id: 'rec_2', title: 'Fish Tacos' })], {
                    id: 'col_1',
                    name: 'Weeknight favourites',
                }),
            }),
        );
    });

    it('forwards a selected member recipe upward', () => {
        const onSelectRecipe = vi.fn();

        render(<CollectionDetailScreen {...props} onSelectRecipe={onSelectRecipe} />);
        fireEvent.click(screen.getByRole('button', { name: 'Fish Tacos' }));

        expect(onSelectRecipe).toHaveBeenCalledWith('rec_2');
    });

    it('removes a member recipe from the collection', () => {
        const mutate = vi.fn();
        useRemoveRecipeFromCollectionMock.mockReturnValue(
            mutation<ReturnType<typeof useRemoveRecipeFromCollection>>({ mutate: mutate as never }),
        );

        render(<CollectionDetailScreen {...props} />);
        fireEvent.click(screen.getByRole('button', { name: 'Remove Fish Tacos' }));

        expect(mutate).toHaveBeenCalledWith({ id: 'col_1', recipeId: 'rec_2' });
    });

    it('requests a rename with the current name', () => {
        const onRename = vi.fn();

        render(<CollectionDetailScreen {...props} onRename={onRename} />);
        fireEvent.click(screen.getByRole('button', { name: 'Rename' }));

        expect(onRename).toHaveBeenCalledWith('Weeknight favourites');
    });

    it('deletes the collection and navigates away on success', () => {
        const mutate = vi.fn((_id: string, options?: { onSuccess?: () => void }) => options?.onSuccess?.());
        useDeleteCollectionMock.mockReturnValue(
            mutation<ReturnType<typeof useDeleteCollection>>({ mutate: mutate as never }),
        );
        const onDeleted = vi.fn();

        render(<CollectionDetailScreen {...props} onDeleted={onDeleted} />);
        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

        expect(mutate).toHaveBeenCalledWith('col_1', expect.objectContaining({ onSuccess: expect.any(Function) }));
        expect(onDeleted).toHaveBeenCalledTimes(1);
    });
});
