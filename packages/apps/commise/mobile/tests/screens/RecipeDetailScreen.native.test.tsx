/**
 * Component tests for the mobile RecipeDetailScreen (rendered via react-native-web under jsdom — see
 * `vitest.native.config.ts`). The screen drives the shared native `RecipeDetailView` building block from
 * the (mocked) `useRecipe` query, rendering localized loading and error states until the recipe resolves.
 *
 * Covers EVERY UI path the screen produces: loading, error, ready, and the optional back affordance.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { useRecipe } from '@kitchensink/recipe-service-client/hooks';

import { RecipeDetailScreen } from '../../src/screens/RecipeDetailScreen.js';
import { makeRecipeDetail } from '../__fixtures__/recipes.js';

vi.mock('@kitchensink/recipe-service-client/hooks', () => ({
    useRecipe: vi.fn(),
    useRecipes: vi.fn(),
}));

const useRecipeMock = vi.mocked(useRecipe);

/** Build a `useRecipe` result double from the fields the screen reads. */
function detailResult(overrides: Partial<ReturnType<typeof useRecipe>> = {}): ReturnType<typeof useRecipe> {
    return {
        isLoading: false,
        isError: false,
        data: undefined,
        ...overrides,
    } as unknown as ReturnType<typeof useRecipe>;
}

afterEach(cleanup);

beforeEach(() => {
    useRecipeMock.mockReset();
});

describe('RecipeDetailScreen — loading state', () => {
    it('shows the localized loading indicator while the query is loading', () => {
        useRecipeMock.mockReturnValue(detailResult({ isLoading: true }));

        render(<RecipeDetailScreen recipeId="rec_1" />);

        expect(screen.getByLabelText('Loading recipe…')).toBeTruthy();
    });
});

describe('RecipeDetailScreen — error state', () => {
    it('shows an alert when the query errors', () => {
        useRecipeMock.mockReturnValue(detailResult({ isError: true }));

        render(<RecipeDetailScreen recipeId="rec_1" />);

        expect(screen.getByRole('alert')).toBeTruthy();
        expect(screen.getByText('We couldn’t load this recipe.')).toBeTruthy();
    });

    it('shows the error state when the query settled without data', () => {
        useRecipeMock.mockReturnValue(detailResult({ data: undefined }));

        render(<RecipeDetailScreen recipeId="rec_1" />);

        expect(screen.getByRole('alert')).toBeTruthy();
    });
});

describe('RecipeDetailScreen — ready state', () => {
    it('renders the recipe detail view once the recipe resolves', () => {
        useRecipeMock.mockReturnValue(
            detailResult({ data: makeRecipeDetail({ title: 'Weeknight Pasta', description: 'Fast and cozy.' }) }),
        );

        render(<RecipeDetailScreen recipeId="rec_1" />);

        expect(screen.getByRole('heading', { name: 'Weeknight Pasta' })).toBeTruthy();
        expect(screen.getByText('Fast and cozy.')).toBeTruthy();
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('renders and wires the back affordance only when onBack is provided', () => {
        useRecipeMock.mockReturnValue(detailResult({ data: makeRecipeDetail({ title: 'Weeknight Pasta' }) }));
        const onBack = vi.fn();

        const { rerender } = render(<RecipeDetailScreen recipeId="rec_1" onBack={onBack} />);
        fireEvent.click(screen.getByRole('button', { name: 'Back' }));
        expect(onBack).toHaveBeenCalledTimes(1);

        rerender(<RecipeDetailScreen recipeId="rec_1" />);
        expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    });
});
