/**
 * Component tests for RecipeDiscoveryContainer (T076 web public-discovery wiring). Covers every state the
 * container projects onto the shared RecipeDiscoveryList building block — loading, populated, empty, error
 * (with retry) — plus search-query wiring, recipe selection navigation, and the clone flow (mutation wired
 * with the row id, per-row busy state, and navigation to the cloned recipe on success).
 *
 * Migrated (CP-6 T3) off `vi.mock('@kitchensink/recipe-service-client/hooks', ...)` onto the type-checked
 * fake-client seam: `renderWithRecipeClient` mounts the container through the REAL `useInfiniteSearchRecipes`
 * / `useCloneRecipe` hooks over a real, network-guarded `RecipeServiceClient`
 * (`createFakeRecipeServiceClient`), stubbed per test with type-checked
 * `vi.spyOn(client, 'searchRecipes' | 'cloneRecipe')`. The Next router mocks (`useRouter`/`usePathname`/
 * `useSearchParams`) and the `window.history.replaceState` spy stay exactly as before — URL-driven filter
 * state is outside this migration's scope (the recipe-service hooks are the seam being migrated).
 */
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithRecipeClient } from '@commise/test-utils';

import { RecipeDiscoveryContainer } from '@/components/recipes/RecipeDiscoveryContainer';

import { makeSearchResponse, makeSearchResult } from './__fixtures__/discoveryFixtures';
import { makeRecipe, makeRecipeDetail } from './__fixtures__/recipeFixtures';

const { pushMock, nav } = vi.hoisted(() => ({
    pushMock: vi.fn(),
    // The container reads the search criteria from the URL. `nav.params` is the current query; a test sets
    // it to simulate a shared/reloaded filtered link, and criteria writes go through
    // `window.history.replaceState` (spied per-test), which updates `useSearchParams()` reactively.
    nav: { params: new URLSearchParams(), pathname: '/en/discover' },
}));

vi.mock('next/navigation', () => ({
    useRouter: () => ({ push: pushMock }),
    usePathname: () => nav.pathname,
    useSearchParams: () => nav.params,
}));

afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    nav.params = new URLSearchParams();
});

describe('RecipeDiscoveryContainer', () => {
    it('renders the loading state while the search query is pending', () => {
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'searchRecipes').mockReturnValue(new Promise(() => {}));

        renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client);

        expect(screen.getByRole('status', { name: 'Loading recipes' })).toBeInTheDocument();
    });

    it('renders the populated results with a count when the search loads', async () => {
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'searchRecipes').mockResolvedValue(
            makeSearchResponse([
                makeSearchResult({ recipe: makeRecipe({ id: 'rec_1', title: 'Weeknight Pasta' }) }),
                makeSearchResult({ recipe: makeRecipe({ id: 'rec_2', title: 'Sunday Roast' }) }),
            ]),
        );

        renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client);

        expect(await screen.findByRole('button', { name: 'Weeknight Pasta' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Sunday Roast' })).toBeInTheDocument();
        expect(screen.getByText('2 recipes')).toBeInTheDocument();
    });

    it('renders the empty state when the search succeeds with no hits', async () => {
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'searchRecipes').mockResolvedValue(makeSearchResponse([]));

        renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client);

        expect(await screen.findByText('No recipes found')).toBeInTheDocument();
    });

    it('renders the error state and retries on demand', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        const searchSpy = vi.spyOn(client, 'searchRecipes').mockRejectedValue(new Error('boom'));

        renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client);

        expect(await screen.findByRole('alert')).toBeInTheDocument();
        expect(searchSpy).toHaveBeenCalledTimes(1);

        await user.click(screen.getByRole('button', { name: 'Try again' }));

        await vi.waitFor(() => expect(searchSpy).toHaveBeenCalledTimes(2));
    });

    it('writes the typed search term to the URL (shareable), not to local state', async () => {
        const user = userEvent.setup();
        const replaceState = vi.spyOn(window.history, 'replaceState');
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'searchRecipes').mockResolvedValue(makeSearchResponse([]));

        renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client);

        // A single keystroke — the input is URL-controlled, so cumulative typing depends on the router
        // reactivity that only the real runtime (Playwright) provides; the container's job here is to WRITE.
        await user.type(screen.getByRole('searchbox', { name: 'Search public recipes' }), 'p');

        expect(replaceState).toHaveBeenLastCalledWith(null, '', '/en/discover?query=p');
    });

    it('searches with no query param before the user types', () => {
        const client = createFakeRecipeServiceClient();
        const searchSpy = vi.spyOn(client, 'searchRecipes').mockResolvedValue(makeSearchResponse([]));

        renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client);

        // The default sort (relevance, S3) rides along with the search params; `page: 1` is the infinite
        // query's initial page param (S4) — invisible in the old flat-mock shim, real over the real hook.
        expect(searchSpy).toHaveBeenLastCalledWith({ sortBy: 'relevance', page: 1 });
    });

    it('projects the filters from the URL onto the search params and the pressed chips', async () => {
        nav.params = new URLSearchParams('dietaryFlags=vegan');
        const client = createFakeRecipeServiceClient();
        const searchSpy = vi
            .spyOn(client, 'searchRecipes')
            .mockResolvedValue(makeSearchResponse([], { facets: { dietaryFlags: [{ value: 'vegan', count: 2 }] } }));

        renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client);

        const chip = await screen.findByRole('button', { name: 'vegan, 2 recipes' });
        expect(chip.getAttribute('aria-pressed')).toBe('true');
        expect(searchSpy).toHaveBeenLastCalledWith({ dietaryFlags: ['vegan'], sortBy: 'relevance', page: 1 });
    });

    it('re-runs the search with the chosen sort (S3)', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        const searchSpy = vi.spyOn(client, 'searchRecipes').mockResolvedValue(makeSearchResponse([]));

        renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client);

        await user.click(screen.getByRole('radio', { name: 'Quickest' }));

        expect(searchSpy).toHaveBeenLastCalledWith({ sortBy: 'quickest', page: 1 });
    });

    it('writes a toggled facet to the URL', async () => {
        const user = userEvent.setup();
        const replaceState = vi.spyOn(window.history, 'replaceState');
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'searchRecipes').mockResolvedValue(
            makeSearchResponse([], { facets: { dietaryFlags: [{ value: 'vegan', count: 2 }] } }),
        );

        renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client);

        await user.click(await screen.findByRole('button', { name: 'vegan, 2 recipes' }));

        expect(replaceState).toHaveBeenLastCalledWith(null, '', '/en/discover?dietaryFlags=vegan');
    });

    it('navigates to the recipe detail route when a result is selected', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'searchRecipes').mockResolvedValue(
            makeSearchResponse([makeSearchResult({ recipe: makeRecipe({ id: 'rec_42', title: 'Weeknight Pasta' }) })]),
        );

        renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client);

        await user.click(await screen.findByRole('button', { name: 'Weeknight Pasta' }));

        expect(pushMock).toHaveBeenCalledWith('/en/recipes/rec_42');
    });

    it('clones the selected recipe and navigates to the clone on success', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'searchRecipes').mockResolvedValue(
            makeSearchResponse([makeSearchResult({ recipe: makeRecipe({ id: 'rec_7', title: 'Sunday Roast' }) })]),
        );
        const cloneSpy = vi.spyOn(client, 'cloneRecipe').mockResolvedValue(makeRecipeDetail({ id: 'rec_clone' }));

        renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client);

        await user.click(await screen.findByRole('button', { name: 'Clone Sunday Roast' }));

        expect(cloneSpy).toHaveBeenCalledWith('rec_7');

        // Drive the REAL mutation to resolution and assert navigation to the clone.
        await vi.waitFor(() => expect(pushMock).toHaveBeenCalledWith('/en/recipes/rec_clone'));
    });

    it('busies only the row whose clone is in flight', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'searchRecipes').mockResolvedValue(
            makeSearchResponse([
                makeSearchResult({ recipe: makeRecipe({ id: 'rec_1', title: 'Weeknight Pasta' }) }),
                makeSearchResult({ recipe: makeRecipe({ id: 'rec_2', title: 'Sunday Roast' }) }),
            ]),
        );
        vi.spyOn(client, 'cloneRecipe').mockReturnValue(new Promise(() => {}));

        renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client);
        await screen.findByRole('button', { name: 'Weeknight Pasta' });

        await user.click(screen.getByRole('button', { name: 'Clone Sunday Roast' }));

        const busy = await screen.findByRole('button', { name: 'Cloning Sunday Roast' });
        expect(busy).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Clone Weeknight Pasta' })).toBeEnabled();
    });
});
