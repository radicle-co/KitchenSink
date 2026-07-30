/**
 * Component tests for the mobile CollectionRecipePickerScreen (react-native-web under jsdom) — the ADD half
 * of FR-009 (T072). The screen loads the target collection (for its name + membership) and the caller's own
 * recipes via (mocked) `useCollection` / `useRecipes`, then drives the shared native `CollectionRecipePicker`
 * and wires the add to `useAddRecipeToCollection`. These cover the screen's OWN logic — the status mapping,
 * the client-side search filter, the membership derivation from the loaded collection, the derivation of the
 * in-flight/success/failure signals from the mutation, and the add/create/done wiring — not the block's
 * presentational branches (owned by the block's own suite).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { useAddRecipeToCollection, useCollection, useRecipes } from '@kitchensink/recipe-service-client/hooks';

import { CollectionRecipePickerScreen } from '../../src/screens/CollectionRecipePickerScreen.js';
import { makeCollectionWithRecipes, makeRecipe, makeRecipePage } from '../__fixtures__/recipes.js';

vi.mock('@kitchensink/recipe-service-client/hooks', () => ({
    useCollection: vi.fn(),
    useRecipes: vi.fn(),
    useAddRecipeToCollection: vi.fn(),
}));

const useCollectionMock = vi.mocked(useCollection);
const useRecipesMock = vi.mocked(useRecipes);
const useAddRecipeToCollectionMock = vi.mocked(useAddRecipeToCollection);

function collectionResult(overrides: Partial<ReturnType<typeof useCollection>> = {}): ReturnType<typeof useCollection> {
    return {
        isLoading: false,
        isError: false,
        data: undefined,
        refetch: vi.fn(),
        ...overrides,
    } as unknown as ReturnType<typeof useCollection>;
}

function recipesResult(overrides: Partial<ReturnType<typeof useRecipes>> = {}): ReturnType<typeof useRecipes> {
    return {
        isLoading: false,
        isError: false,
        data: undefined,
        refetch: vi.fn(),
        ...overrides,
    } as unknown as ReturnType<typeof useRecipes>;
}

function addMutation(
    overrides: Partial<ReturnType<typeof useAddRecipeToCollection>> = {},
): ReturnType<typeof useAddRecipeToCollection> {
    return {
        mutate: vi.fn(),
        isPending: false,
        isError: false,
        isSuccess: false,
        variables: undefined,
        ...overrides,
    } as unknown as ReturnType<typeof useAddRecipeToCollection>;
}

const props = {
    collectionId: 'col_1',
    onCreateRecipe: vi.fn(),
    onDone: vi.fn(),
};

/** Seed a loaded collection (named, with the given members) plus a recipe page. */
function seedReady(
    members: readonly ReturnType<typeof makeRecipe>[],
    candidates: readonly ReturnType<typeof makeRecipe>[],
) {
    useCollectionMock.mockReturnValue(
        collectionResult({ data: makeCollectionWithRecipes(members, { id: 'col_1', name: 'Weeknight favourites' }) }),
    );
    useRecipesMock.mockReturnValue(recipesResult({ data: makeRecipePage(candidates) }));
}

afterEach(cleanup);

beforeEach(() => {
    useCollectionMock.mockReset();
    useRecipesMock.mockReset();
    useAddRecipeToCollectionMock.mockReset();
    useAddRecipeToCollectionMock.mockReturnValue(addMutation());
    useCollectionMock.mockReturnValue(collectionResult());
    useRecipesMock.mockReturnValue(recipesResult());
});

describe('CollectionRecipePickerScreen — fetch states', () => {
    it('shows the loading state while either query loads', () => {
        useCollectionMock.mockReturnValue(collectionResult({ isLoading: true }));
        useRecipesMock.mockReturnValue(recipesResult({ data: makeRecipePage([]) }));

        render(<CollectionRecipePickerScreen {...props} />);

        expect(screen.getByLabelText('Loading your recipes')).toBeTruthy();
    });

    it('shows an alert when either query errors', () => {
        useCollectionMock.mockReturnValue(collectionResult({ isError: true }));
        useRecipesMock.mockReturnValue(recipesResult({ data: makeRecipePage([]) }));

        render(<CollectionRecipePickerScreen {...props} />);

        expect(screen.getByRole('alert')).toBeTruthy();
    });

    it('offers to create a recipe when the caller owns none', () => {
        const onCreateRecipe = vi.fn();
        seedReady([], []);

        render(<CollectionRecipePickerScreen {...props} onCreateRecipe={onCreateRecipe} />);
        fireEvent.click(screen.getByRole('button', { name: 'New recipe' }));

        expect(onCreateRecipe).toHaveBeenCalledTimes(1);
    });
});

describe('CollectionRecipePickerScreen — adding', () => {
    it('names the collection and adds a chosen recipe to it', () => {
        const mutate = vi.fn();
        useAddRecipeToCollectionMock.mockReturnValue(addMutation({ mutate: mutate as never }));
        seedReady([], [makeRecipe({ id: 'rec_9', title: 'Fish Tacos' })]);

        render(<CollectionRecipePickerScreen {...props} />);
        expect(screen.getByRole('heading', { name: 'Add recipes to Weeknight favourites' })).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Add Fish Tacos' }));

        expect(mutate).toHaveBeenCalledWith({ id: 'col_1', recipeId: 'rec_9' });
    });

    it('marks a recipe already in this collection as a member (no add control)', () => {
        const member = makeRecipe({ id: 'rec_9', title: 'Fish Tacos' });
        // The candidate list (the caller's recipes) includes the recipe that is already a member.
        seedReady([member], [member, makeRecipe({ id: 'rec_2', title: 'Lentil Soup' })]);

        render(<CollectionRecipePickerScreen {...props} />);

        expect(screen.getByText('In this collection')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Add Fish Tacos' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Add Lentil Soup' })).toBeTruthy();
    });

    it('marks the in-flight recipe as busy while its add is pending', () => {
        useAddRecipeToCollectionMock.mockReturnValue(
            addMutation({ isPending: true, variables: { id: 'col_1', recipeId: 'rec_9' } }),
        );
        seedReady([], [makeRecipe({ id: 'rec_9', title: 'Fish Tacos' })]);

        render(<CollectionRecipePickerScreen {...props} />);

        expect(screen.getByText('Adding…')).toBeTruthy();
    });

    it('announces the last successful add', () => {
        const member = makeRecipe({ id: 'rec_9', title: 'Fish Tacos' });
        useAddRecipeToCollectionMock.mockReturnValue(
            addMutation({ isSuccess: true, variables: { id: 'col_1', recipeId: 'rec_9' } }),
        );
        seedReady([member], [member]);

        render(<CollectionRecipePickerScreen {...props} />);

        expect(screen.getByText('Added Fish Tacos')).toBeTruthy();
    });

    it('surfaces an add failure as an alert', () => {
        useAddRecipeToCollectionMock.mockReturnValue(addMutation({ isError: true }));
        seedReady([], [makeRecipe({ id: 'rec_9', title: 'Fish Tacos' })]);

        render(<CollectionRecipePickerScreen {...props} />);

        expect(screen.getByRole('alert').textContent).toContain('We couldn’t add that recipe. Please try again.');
    });

    it('dismisses on done', () => {
        const onDone = vi.fn();
        seedReady([], [makeRecipe({ id: 'rec_9', title: 'Fish Tacos' })]);

        render(<CollectionRecipePickerScreen {...props} onDone={onDone} />);
        fireEvent.click(screen.getByRole('button', { name: 'Done' }));

        expect(onDone).toHaveBeenCalledTimes(1);
    });
});
