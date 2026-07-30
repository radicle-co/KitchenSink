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
import { RecipeServiceClient } from '@kitchensink/recipe-service-client';
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
        // The loading branch must have FLIPPED, not merely been joined by the empty copy.
        expect(screen.queryByRole('status', { name: 'Loading recipes' })).not.toBeInTheDocument();
    });

    it('settles on the error state — never a permanent skeleton — when the recipe request HANGS', async () => {
        // The reported first-run bug: on a hung connection the query stays `isPending && isFetching`, so
        // `status` never leaves 'loading' and BOTH the empty branch and the error branch (with its retry) are
        // unreachable — the surface shimmers forever. Driven through a REAL client over a fetch double that
        // never answers, so the assertion is on the SURFACE the viewer sees, not on the client in isolation.
        const client = new RecipeServiceClient({
            baseUrl: 'https://recipes.example.test',
            token: 't',
            fetch: (() => new Promise<Response>(() => undefined)) as unknown as typeof fetch,
            timeoutMs: 25,
        });

        renderWithRecipeClient(<RecipeListContainer locale="en" />, client);

        expect(await screen.findByRole('alert')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
        expect(screen.queryByRole('status', { name: 'Loading recipes' })).not.toBeInTheDocument();
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

    it('points the Community source at the discover route as a real LINK (L5)', async () => {
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'listRecipes').mockResolvedValue(
            makeRecipesPage([makeRecipe({ id: 'rec_1', title: 'Weeknight Pasta' })]),
        );

        renderWithRecipeClient(<RecipeListContainer locale="en" />, client);
        await screen.findByRole('button', { name: 'Weeknight Pasta' });

        // It used to be a `<button onClick={router.push}>`, which cost the control its link semantics
        // (middle-click, ⌘-click, "open in new tab", the `link` role) — and, because `active` was hardcoded to
        // `'mine'`, gave the far side no way back. Both sources are now addressable destinations, and THIS
        // list is the current one.
        const nav = screen.getByRole('navigation', { name: 'Recipe source' });
        expect(within(nav).getByRole('link', { name: 'Community' })).toHaveAttribute('href', '/en/discover');
        expect(within(nav).getByRole('link', { name: 'My Recipes' })).toHaveAttribute('href', '/en/recipes');
        expect(within(nav).getByRole('link', { name: 'My Recipes' })).toHaveAttribute('aria-current', 'page');
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

    it('surfaces a "Quick (<30m)" chip that filters to recipes under the 30-minute threshold (L4/#4)', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'listRecipes').mockResolvedValue(
            makeRecipesPage([
                makeRecipe({ id: 'rec_1', title: 'Overnight Oats', totalTimeMinutes: 5 }),
                makeRecipe({ id: 'rec_2', title: "Grandma's Pasta", totalTimeMinutes: 45 }),
            ]),
        );

        renderWithRecipeClient(<RecipeListContainer locale="en" />, client);
        await screen.findByRole('button', { name: 'Overnight Oats' });

        const chips = screen.getByRole('group', { name: 'Quick filters' });
        const quickChip = within(chips).getByRole('button', { name: 'Quick (<30m)' });
        expect(screen.queryByRole('button', { name: 'quick' })).not.toBeInTheDocument();

        await user.click(quickChip);

        expect(screen.getByRole('button', { name: 'Overnight Oats' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: "Grandma's Pasta" })).not.toBeInTheDocument();
    });

    it('omits the "Quick (<30m)" chip when no loaded recipe qualifies (other facets still render)', async () => {
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'listRecipes').mockResolvedValue(
            makeRecipesPage([
                makeRecipe({ id: 'rec_1', title: "Grandma's Pasta", totalTimeMinutes: 45, cuisine: 'Italian' }),
            ]),
        );

        renderWithRecipeClient(<RecipeListContainer locale="en" />, client);
        await screen.findByRole('button', { name: "Grandma's Pasta" });

        const chips = screen.getByRole('group', { name: 'Quick filters' });
        expect(within(chips).getByRole('button', { name: 'Italian' })).toBeInTheDocument();
        expect(within(chips).queryByRole('button', { name: 'Quick (<30m)' })).not.toBeInTheDocument();
    });
});
