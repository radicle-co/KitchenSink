/**
 * Component tests for the mobile RecipeEditScreen (react-native-web under jsdom). The screen loads the recipe
 * via (mocked) `useRecipe`, seeds the editor from it, and wires submit to (mocked) `useUpdateRecipe`, carrying
 * the loaded `currentVersion` as `expectedVersion`. Covers loading, error, the seeded ready state, and the
 * save path. The editor's ingredient typeahead reads the (mocked) ingredient search/create hooks.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import {
    useCreateIngredient,
    useRecipe,
    useSearchIngredients,
    useUpdateRecipe,
} from '@kitchensink/recipe-service-client/hooks';

import { RecipeEditScreen } from '../../src/screens/RecipeEditScreen.js';
import { makeRecipeDetail } from '../__fixtures__/recipes.js';

vi.mock('@kitchensink/recipe-service-client/hooks', () => ({
    useRecipe: vi.fn(),
    useUpdateRecipe: vi.fn(),
    useSearchIngredients: vi.fn(),
    useCreateIngredient: vi.fn(),
}));

const useRecipeMock = vi.mocked(useRecipe);
const useUpdateRecipeMock = vi.mocked(useUpdateRecipe);
const useSearchIngredientsMock = vi.mocked(useSearchIngredients);
const useCreateIngredientMock = vi.mocked(useCreateIngredient);

function recipeResult(overrides: Partial<ReturnType<typeof useRecipe>> = {}): ReturnType<typeof useRecipe> {
    return { isLoading: false, isError: false, data: undefined, ...overrides } as unknown as ReturnType<
        typeof useRecipe
    >;
}

function updateMutation(
    overrides: Partial<ReturnType<typeof useUpdateRecipe>> = {},
): ReturnType<typeof useUpdateRecipe> {
    return { mutate: vi.fn(), isPending: false, isError: false, ...overrides } as unknown as ReturnType<
        typeof useUpdateRecipe
    >;
}

afterEach(cleanup);

beforeEach(() => {
    useRecipeMock.mockReset();
    useUpdateRecipeMock.mockReset();
    useSearchIngredientsMock.mockReset();
    useCreateIngredientMock.mockReset();
    useUpdateRecipeMock.mockReturnValue(updateMutation());
    useSearchIngredientsMock.mockReturnValue({ isLoading: false, isError: false, data: [] } as unknown as ReturnType<
        typeof useSearchIngredients
    >);
    useCreateIngredientMock.mockReturnValue({ mutate: vi.fn(), isPending: false } as unknown as ReturnType<
        typeof useCreateIngredient
    >);
});

describe('RecipeEditScreen — loading and error', () => {
    it('shows the loading indicator while the recipe loads', () => {
        useRecipeMock.mockReturnValue(recipeResult({ isLoading: true }));

        render(<RecipeEditScreen recipeId="rec_1" onSaved={vi.fn()} onCancel={vi.fn()} />);

        expect(screen.getByLabelText('Loading recipe…')).toBeTruthy();
    });

    it('shows an alert when the recipe fails to load', () => {
        useRecipeMock.mockReturnValue(recipeResult({ isError: true }));

        render(<RecipeEditScreen recipeId="rec_1" onSaved={vi.fn()} onCancel={vi.fn()} />);

        expect(screen.getByRole('alert')).toBeTruthy();
    });
});

describe('RecipeEditScreen — ready state', () => {
    it('seeds the editor from the loaded recipe', () => {
        useRecipeMock.mockReturnValue(recipeResult({ data: makeRecipeDetail({ title: 'Weeknight Pasta' }) }));

        render(<RecipeEditScreen recipeId="rec_1" onSaved={vi.fn()} onCancel={vi.fn()} />);

        expect(screen.getByRole('heading', { name: 'Edit recipe' })).toBeTruthy();
        expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Weeknight Pasta');
    });
});

describe('RecipeEditScreen — save', () => {
    it('runs the update mutation carrying the expected version, then reports the id', () => {
        const updated = makeRecipeDetail({ id: 'rec_1', title: 'Weeknight Pasta' });
        useRecipeMock.mockReturnValue(
            recipeResult({ data: makeRecipeDetail({ id: 'rec_1', title: 'Weeknight Pasta', currentVersion: 3 }) }),
        );
        const mutate = vi.fn((_vars: unknown, options?: { onSuccess?: (recipe: typeof updated) => void }) =>
            options?.onSuccess?.(updated),
        );
        useUpdateRecipeMock.mockReturnValue(updateMutation({ mutate: mutate as never }));
        const onSaved = vi.fn();

        render(<RecipeEditScreen recipeId="rec_1" onSaved={onSaved} onCancel={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

        expect(mutate).toHaveBeenCalledTimes(1);
        const [vars] = mutate.mock.calls[0] as [{ id: string; input: { expectedVersion: number; title: string } }];
        expect(vars.id).toBe('rec_1');
        expect(vars.input.expectedVersion).toBe(3);
        expect(vars.input.title).toBe('Weeknight Pasta');
        expect(onSaved).toHaveBeenCalledWith('rec_1');
    });
});
