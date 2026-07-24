/**
 * Component tests for RecipeListContainer (T09x web recipe-list wiring). Covers every state the
 * container projects onto the shared RecipeList building block — loading, populated, empty, error (with
 * retry) — plus search filtering and navigation on select/create.
 *
 * Migrated (CP-6 T3) off `vi.mock('@kitchensink/recipe-service-client/hooks', ...)` onto the type-checked
 * fake-client seam: `renderWithRecipeClient` mounts the container through the REAL `useRecipes` hook over a
 * real, network-guarded `RecipeServiceClient` (`createFakeRecipeServiceClient`), stubbed per test with a
 * type-checked `vi.spyOn(client, 'listRecipes')`. The Next router stays mocked — routing is not part of the
 * recipe-service hooks seam this migration targets.
 */
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithRecipeClient } from '@commise/test-utils';

import { RecipeListContainer } from '@/components/recipes/RecipeListContainer';

import { makeRecipe, makeRecipesPage } from './__fixtures__/recipeFixtures';

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

vi.mock('next/navigation', () => ({
    useRouter: () => ({ push: pushMock }),
}));

afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
});

describe('RecipeListContainer', () => {
    it('renders the loading state while the query is pending', () => {
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'listRecipes').mockReturnValue(new Promise(() => {}));

        renderWithRecipeClient(<RecipeListContainer locale="en" />, client);

        expect(screen.getByRole('status', { name: 'Loading recipes' })).toBeInTheDocument();
    });

    it('renders the populated list with a count when recipes load', async () => {
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'listRecipes').mockResolvedValue(
            makeRecipesPage([
                makeRecipe({ id: 'rec_1', title: 'Weeknight Pasta' }),
                makeRecipe({ id: 'rec_2', title: 'Sunday Roast' }),
            ]),
        );

        renderWithRecipeClient(<RecipeListContainer locale="en" />, client);

        expect(await screen.findByRole('button', { name: 'Weeknight Pasta' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Sunday Roast' })).toBeInTheDocument();
        expect(screen.getByText('2 recipes')).toBeInTheDocument();
    });

    it('renders the empty state when the load succeeds with no recipes', async () => {
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'listRecipes').mockResolvedValue(makeRecipesPage([]));

        renderWithRecipeClient(<RecipeListContainer locale="en" />, client);

        expect(await screen.findByText('No recipes yet')).toBeInTheDocument();
    });

    it('renders the error state and retries on demand', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        const listRecipesSpy = vi.spyOn(client, 'listRecipes').mockRejectedValue(new Error('boom'));

        renderWithRecipeClient(<RecipeListContainer locale="en" />, client);

        expect(await screen.findByRole('alert')).toBeInTheDocument();
        expect(listRecipesSpy).toHaveBeenCalledTimes(1);

        await user.click(screen.getByRole('button', { name: 'Try again' }));

        await vi.waitFor(() => expect(listRecipesSpy).toHaveBeenCalledTimes(2));
    });

    it('navigates to the recipe detail route when a recipe is selected', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'listRecipes').mockResolvedValue(
            makeRecipesPage([makeRecipe({ id: 'rec_42', title: 'Weeknight Pasta' })]),
        );

        renderWithRecipeClient(<RecipeListContainer locale="en" />, client);

        await user.click(await screen.findByRole('button', { name: 'Weeknight Pasta' }));

        expect(pushMock).toHaveBeenCalledWith('/en/recipes/rec_42');
    });

    it('navigates to the create route from the empty-state create CTA', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'listRecipes').mockResolvedValue(makeRecipesPage([]));

        renderWithRecipeClient(<RecipeListContainer locale="en" />, client);

        // Empty list → the create control is the empty-state CTA (the FAB is suppressed on empty; L1).
        await user.click(await screen.findByRole('button', { name: 'Create your first recipe' }));

        expect(pushMock).toHaveBeenCalledWith('/en/recipes/new');
    });

    it('navigates to the create route from the pinned FAB when the list is populated', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'listRecipes').mockResolvedValue(
            makeRecipesPage([makeRecipe({ id: 'rec_1', title: 'Weeknight Pasta' })]),
        );

        renderWithRecipeClient(<RecipeListContainer locale="en" />, client);

        await user.click(await screen.findByRole('button', { name: 'New recipe' }));

        expect(pushMock).toHaveBeenCalledWith('/en/recipes/new');
    });

    it('filters the loaded recipes by the search term', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'listRecipes').mockResolvedValue(
            makeRecipesPage([
                makeRecipe({ id: 'rec_1', title: 'Weeknight Pasta' }),
                makeRecipe({ id: 'rec_2', title: 'Sunday Roast' }),
            ]),
        );

        renderWithRecipeClient(<RecipeListContainer locale="en" />, client);
        await screen.findByRole('button', { name: 'Weeknight Pasta' });

        await user.type(screen.getByRole('searchbox', { name: 'Search recipes' }), 'roast');

        expect(screen.getByRole('button', { name: 'Sunday Roast' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Weeknight Pasta' })).not.toBeInTheDocument();
    });

    it('navigates to the discover surface when the Community tab is chosen (L5)', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'listRecipes').mockResolvedValue(
            makeRecipesPage([makeRecipe({ id: 'rec_1', title: 'Weeknight Pasta' })]),
        );

        renderWithRecipeClient(<RecipeListContainer locale="en" />, client);
        await screen.findByRole('button', { name: 'Weeknight Pasta' });

        await user.click(screen.getByRole('tab', { name: 'Community' }));

        expect(pushMock).toHaveBeenCalledWith('/en/discover');
    });

    it('derives quick-filter chips from the loaded dietary flags + cuisine and filters by one (L4)', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'listRecipes').mockResolvedValue(
            makeRecipesPage([
                makeRecipe({ id: 'rec_1', title: 'Weeknight Pasta', dietaryFlags: ['Vegetarian'], cuisine: 'Italian' }),
                makeRecipe({ id: 'rec_2', title: 'Sunday Roast', dietaryFlags: [], cuisine: 'British' }),
            ]),
        );

        renderWithRecipeClient(<RecipeListContainer locale="en" />, client);
        await screen.findByRole('button', { name: 'Weeknight Pasta' });

        const chips = screen.getByRole('group', { name: 'Quick filters' });
        // Real facet dimensions surface as chips (dietary flags + cuisines), not free-form tags.
        expect(within(chips).getByRole('button', { name: 'Vegetarian' })).toBeInTheDocument();
        expect(within(chips).getByRole('button', { name: 'Italian' })).toBeInTheDocument();
        expect(within(chips).getByRole('button', { name: 'British' })).toBeInTheDocument();

        await user.click(within(chips).getByRole('button', { name: 'Vegetarian' }));

        // Only the recipe carrying the active facet remains.
        expect(screen.getByRole('button', { name: 'Weeknight Pasta' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Sunday Roast' })).not.toBeInTheDocument();

        // "All" clears the filter and restores every row.
        await user.click(within(chips).getByRole('button', { name: 'All' }));
        expect(screen.getByRole('button', { name: 'Sunday Roast' })).toBeInTheDocument();
    });
});
