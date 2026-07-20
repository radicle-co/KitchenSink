/**
 * Component tests for RecipeListContainer (T09x web recipe-list wiring). Covers every state the
 * container projects onto the shared RecipeList building block — loading, populated, empty, error (with
 * retry) — plus search filtering and navigation on select/create. The recipe hook + Next router are
 * mocked, so no backend or QueryClient is needed.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RecipeListContainer } from '@/components/recipes/RecipeListContainer';

import { makeRecipe, makeRecipesPage } from './__fixtures__/recipeFixtures';

const { useRecipesMock, pushMock, refetchMock } = vi.hoisted(() => ({
    useRecipesMock: vi.fn(),
    pushMock: vi.fn(),
    refetchMock: vi.fn(),
}));

vi.mock('@kitchensink/recipe-service-client/hooks', () => ({
    useRecipes: useRecipesMock,
}));

vi.mock('next/navigation', () => ({
    useRouter: () => ({ push: pushMock }),
}));

afterEach(() => {
    vi.clearAllMocks();
});

describe('RecipeListContainer', () => {
    it('renders the loading state while the query is pending', () => {
        useRecipesMock.mockReturnValue({ isLoading: true, isError: false, data: undefined, refetch: refetchMock });

        render(<RecipeListContainer locale="en" />);

        expect(screen.getByRole('status', { name: 'Loading recipes' })).toBeInTheDocument();
    });

    it('renders the populated list with a count when recipes load', () => {
        useRecipesMock.mockReturnValue({
            isLoading: false,
            isError: false,
            data: makeRecipesPage([
                makeRecipe({ id: 'rec_1', title: 'Weeknight Pasta' }),
                makeRecipe({ id: 'rec_2', title: 'Sunday Roast' }),
            ]),
            refetch: refetchMock,
        });

        render(<RecipeListContainer locale="en" />);

        expect(screen.getByRole('button', { name: 'Weeknight Pasta' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Sunday Roast' })).toBeInTheDocument();
        expect(screen.getByText('2 recipes')).toBeInTheDocument();
    });

    it('renders the empty state when the load succeeds with no recipes', () => {
        useRecipesMock.mockReturnValue({
            isLoading: false,
            isError: false,
            data: makeRecipesPage([]),
            refetch: refetchMock,
        });

        render(<RecipeListContainer locale="en" />);

        expect(screen.getByText('No recipes yet')).toBeInTheDocument();
    });

    it('renders the error state and retries on demand', async () => {
        const user = userEvent.setup();
        useRecipesMock.mockReturnValue({ isLoading: false, isError: true, data: undefined, refetch: refetchMock });

        render(<RecipeListContainer locale="en" />);

        expect(screen.getByRole('alert')).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Try again' }));

        expect(refetchMock).toHaveBeenCalledTimes(1);
    });

    it('navigates to the recipe detail route when a recipe is selected', async () => {
        const user = userEvent.setup();
        useRecipesMock.mockReturnValue({
            isLoading: false,
            isError: false,
            data: makeRecipesPage([makeRecipe({ id: 'rec_42', title: 'Weeknight Pasta' })]),
            refetch: refetchMock,
        });

        render(<RecipeListContainer locale="en" />);

        await user.click(screen.getByRole('button', { name: 'Weeknight Pasta' }));

        expect(pushMock).toHaveBeenCalledWith('/en/recipes/rec_42');
    });

    it('navigates to the create route from the empty-state create CTA', async () => {
        const user = userEvent.setup();
        useRecipesMock.mockReturnValue({
            isLoading: false,
            isError: false,
            data: makeRecipesPage([]),
            refetch: refetchMock,
        });

        render(<RecipeListContainer locale="en" />);

        // Empty list → the create control is the empty-state CTA (the FAB is suppressed on empty; L1).
        await user.click(screen.getByRole('button', { name: 'Create your first recipe' }));

        expect(pushMock).toHaveBeenCalledWith('/en/recipes/new');
    });

    it('navigates to the create route from the pinned FAB when the list is populated', async () => {
        const user = userEvent.setup();
        useRecipesMock.mockReturnValue({
            isLoading: false,
            isError: false,
            data: makeRecipesPage([makeRecipe({ id: 'rec_1', title: 'Weeknight Pasta' })]),
            refetch: refetchMock,
        });

        render(<RecipeListContainer locale="en" />);

        await user.click(screen.getByRole('button', { name: 'New recipe' }));

        expect(pushMock).toHaveBeenCalledWith('/en/recipes/new');
    });

    it('filters the loaded recipes by the search term', async () => {
        const user = userEvent.setup();
        useRecipesMock.mockReturnValue({
            isLoading: false,
            isError: false,
            data: makeRecipesPage([
                makeRecipe({ id: 'rec_1', title: 'Weeknight Pasta' }),
                makeRecipe({ id: 'rec_2', title: 'Sunday Roast' }),
            ]),
            refetch: refetchMock,
        });

        render(<RecipeListContainer locale="en" />);

        await user.type(screen.getByRole('searchbox', { name: 'Search recipes' }), 'roast');

        expect(screen.getByRole('button', { name: 'Sunday Roast' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Weeknight Pasta' })).not.toBeInTheDocument();
    });

    it('navigates to the discover surface when the Community tab is chosen (L5)', async () => {
        const user = userEvent.setup();
        useRecipesMock.mockReturnValue({
            isLoading: false,
            isError: false,
            data: makeRecipesPage([makeRecipe({ id: 'rec_1', title: 'Weeknight Pasta' })]),
            refetch: refetchMock,
        });

        render(<RecipeListContainer locale="en" />);

        await user.click(screen.getByRole('tab', { name: 'Community' }));

        expect(pushMock).toHaveBeenCalledWith('/en/discover');
    });

    it('derives quick-filter chips from the loaded tags and filters by an active chip (L4)', async () => {
        const user = userEvent.setup();
        useRecipesMock.mockReturnValue({
            isLoading: false,
            isError: false,
            data: makeRecipesPage([
                makeRecipe({ id: 'rec_1', title: 'Weeknight Pasta', tags: ['quick'] }),
                makeRecipe({ id: 'rec_2', title: 'Sunday Roast', tags: ['weekend'] }),
            ]),
            refetch: refetchMock,
        });

        render(<RecipeListContainer locale="en" />);

        const chips = screen.getByRole('group', { name: 'Quick filters' });
        // Both tags surface as chips (sorted union of the loaded library's tags).
        expect(within(chips).getByRole('button', { name: 'quick' })).toBeInTheDocument();
        expect(within(chips).getByRole('button', { name: 'weekend' })).toBeInTheDocument();

        await user.click(within(chips).getByRole('button', { name: 'quick' }));

        // Only the recipe carrying the active tag remains.
        expect(screen.getByRole('button', { name: 'Weeknight Pasta' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Sunday Roast' })).not.toBeInTheDocument();
    });
});
