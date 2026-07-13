/**
 * Component tests for RecipeDetailContainer (T09x web recipe-detail wiring). Covers every state the
 * container renders — loading, ready (delegates to the shared RecipeDetailView), generic error (with
 * retry), and a distinct not-found affordance (no retry). The recipe hook is mocked, so no backend or
 * QueryClient is needed; the real `isNotFoundError` guard classifies the error.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NotFoundError } from '@kitchensink/recipe-service-client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RecipeDetailContainer } from '@/components/recipes/RecipeDetailContainer';

import { makeRecipeDetail } from './__fixtures__/recipeFixtures';

const { useRecipeMock, refetchMock } = vi.hoisted(() => ({
    useRecipeMock: vi.fn(),
    refetchMock: vi.fn(),
}));

vi.mock('@kitchensink/recipe-service-client/hooks', () => ({
    useRecipe: useRecipeMock,
}));

afterEach(() => {
    vi.clearAllMocks();
});

describe('RecipeDetailContainer', () => {
    it('renders the loading state while the query is pending', () => {
        useRecipeMock.mockReturnValue({ isLoading: true, isError: false, data: undefined, refetch: refetchMock });

        render(<RecipeDetailContainer id="rec_1" />);

        expect(screen.getByRole('status', { name: 'Loading recipe' })).toBeInTheDocument();
    });

    it('renders the recipe detail view when the recipe loads', () => {
        useRecipeMock.mockReturnValue({
            isLoading: false,
            isError: false,
            data: makeRecipeDetail({ title: 'Weeknight Pasta' }),
            refetch: refetchMock,
        });

        render(<RecipeDetailContainer id="rec_1" />);

        expect(screen.getByRole('heading', { level: 1, name: 'Weeknight Pasta' })).toBeInTheDocument();
    });

    it('renders a generic error with retry when the load fails', async () => {
        const user = userEvent.setup();
        useRecipeMock.mockReturnValue({
            isLoading: false,
            isError: true,
            error: new Error('network down'),
            data: undefined,
            refetch: refetchMock,
        });

        render(<RecipeDetailContainer id="rec_1" />);

        expect(screen.getByRole('alert')).toBeInTheDocument();
        expect(screen.getByText(/couldn.t load this recipe/i)).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Try again' }));

        expect(refetchMock).toHaveBeenCalledTimes(1);
    });

    it('renders a distinct not-found message with no retry for a 404', () => {
        useRecipeMock.mockReturnValue({
            isLoading: false,
            isError: true,
            error: new NotFoundError(),
            data: undefined,
            refetch: refetchMock,
        });

        render(<RecipeDetailContainer id="missing" />);

        expect(screen.getByText(/couldn.t find that recipe/i)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    });
});
