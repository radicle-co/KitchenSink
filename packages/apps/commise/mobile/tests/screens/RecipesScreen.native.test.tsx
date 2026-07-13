/**
 * Component tests for the mobile RecipesScreen (rendered via react-native-web under jsdom — see
 * `vitest.native.config.ts`). RecipesScreen is the minimal navigator for this slice: it owns the
 * selected-recipe state and composes either the list or the detail screen. Verifies the list → detail →
 * back round trip so selection and back navigation are wired end to end.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { useRecipe, useRecipes } from '@kitchensink/recipe-service-client/hooks';

import { RecipesScreen } from '../../src/screens/RecipesScreen.js';
import { makeRecipe, makeRecipeDetail, makeRecipePage } from '../__fixtures__/recipes.js';

vi.mock('@kitchensink/recipe-service-client/hooks', () => ({
    useRecipes: vi.fn(),
    useRecipe: vi.fn(),
}));

const useRecipesMock = vi.mocked(useRecipes);
const useRecipeMock = vi.mocked(useRecipe);

afterEach(cleanup);

beforeEach(() => {
    useRecipesMock.mockReset();
    useRecipeMock.mockReset();
    useRecipesMock.mockReturnValue({
        isLoading: false,
        isError: false,
        data: makeRecipePage([makeRecipe({ id: 'rec_2', title: 'Fish Tacos' })]),
        refetch: vi.fn(),
    } as unknown as ReturnType<typeof useRecipes>);
    useRecipeMock.mockReturnValue({
        isLoading: false,
        isError: false,
        data: makeRecipeDetail({ id: 'rec_2', title: 'Fish Tacos', description: 'Bright and zesty.' }),
    } as unknown as ReturnType<typeof useRecipe>);
});

describe('RecipesScreen — navigation', () => {
    it('starts on the list', () => {
        render(<RecipesScreen />);

        expect(screen.getByRole('heading', { name: 'Recipes' })).toBeTruthy();
    });

    it('opens the detail for the selected recipe and returns to the list on back', () => {
        render(<RecipesScreen />);

        fireEvent.click(screen.getByRole('button', { name: 'Fish Tacos' }));

        // Detail is now shown for the selected recipe, addressed by its id.
        expect(useRecipeMock).toHaveBeenCalledWith('rec_2');
        expect(screen.getByText('Bright and zesty.')).toBeTruthy();
        expect(screen.queryByRole('heading', { name: 'Recipes' })).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Back' }));

        expect(screen.getByRole('heading', { name: 'Recipes' })).toBeTruthy();
    });
});
