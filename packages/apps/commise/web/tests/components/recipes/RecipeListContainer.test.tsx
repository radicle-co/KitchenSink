/**
 * Component tests for RecipeListContainer (T09x web recipe-list wiring). Covers every state the container
 * composes from the shared recipe-list leaves — the frame around a suspense read whose fallbacks are the loading and
 * load-error leaves and whose settled branch is the results — plus search filtering, facet chips, navigation on
 * select/create, and the server render of the prefetched `/recipes` page.
 *
 * Migrated (CP-6 T3) off `vi.mock('@kitchensink/recipe-service-client/hooks', ...)` onto the type-checked
 * fake-client seam: `renderWithRecipeClient` mounts the container through the REAL `useRecipes` hook over a
 * real, network-guarded `RecipeServiceClient` (`createFakeRecipeServiceClient`), stubbed per test with a
 * type-checked `vi.spyOn(client, 'listRecipes')`. The Next router stays mocked — routing is not part of the
 * recipe-service hooks seam this migration targets.
 */
import { LocaleProvider } from '@commise/i18n/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RecipeServiceClient, recipeQueries } from '@kitchensink/recipe-service-client';
import { RecipeServiceProvider, recipeServiceKeys } from '@kitchensink/recipe-service-client/hooks';
import type { ReactNode } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
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

    it('mounts NO create control while the query is pending, so none can vanish as it settles', () => {
        // The container-level half of the create-dial fix: this container is what feeds the query's flags
        // into the shared leaf, so a leaf-only assertion could not catch a container that mapped a pending
        // query onto `ready`. The dial used to mount here, over a library that had not yet said it was
        // empty — a first-run cook pressed it, the menu opened, the empty state settled and the whole
        // control detached under their finger.
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'listRecipes').mockReturnValue(new Promise(() => {}));

        renderWithRecipeClient(<RecipeListContainer locale="en" />, client);

        expect(screen.queryByRole('button', { name: 'New recipe' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Create your first recipe' })).not.toBeInTheDocument();
    });

    it('keeps the heading, the source switcher and the search field on screen while the library loads', () => {
        // §11.0: the pending read suspends the RESULTS only. The frame sits outside the boundary, so a cook can start
        // typing before the library has answered.
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'listRecipes').mockReturnValue(new Promise(() => {}));

        renderWithRecipeClient(<RecipeListContainer locale="en" />, client);

        expect(screen.getByRole('heading', { name: 'Recipes' })).toBeInTheDocument();
        expect(screen.getByRole('navigation', { name: 'Recipe source' })).toBeInTheDocument();
        expect(screen.getByRole('searchbox', { name: 'Search recipes' })).toBeInTheDocument();
        expect(screen.queryByRole('group', { name: 'Quick filters' })).not.toBeInTheDocument();
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

    it('⛔ keeps the create dial on a load error, reaching both creation routes', async () => {
        // Creating a recipe does not depend on the read that failed, and the error body has no create CTA — hiding the
        // dial would leave Try again as the only action (wireframe recipe-list, "Load Error State").
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'listRecipes').mockRejectedValue(new Error('boom'));

        renderWithRecipeClient(<RecipeListContainer locale="en" />, client);

        expect(await screen.findByRole('alert')).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'New recipe' }));
        await user.click(screen.getByRole('menuitem', { name: 'Paste an Ingredient List' }));

        expect(pushMock).toHaveBeenCalledWith('/en/recipes/parse');
    });

    it('⛔ keeps the typed search term across Try again — the term lives above the read boundary', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'listRecipes')
            .mockRejectedValueOnce(new Error('boom'))
            .mockResolvedValue(
                makeRecipesPage([
                    makeRecipe({ id: 'rec_1', title: 'Weeknight Pasta' }),
                    makeRecipe({ id: 'rec_2', title: 'Sunday Roast' }),
                ]),
            );

        renderWithRecipeClient(<RecipeListContainer locale="en" />, client);
        await screen.findByRole('alert');
        await user.type(screen.getByRole('searchbox', { name: 'Search recipes' }), 'roast');

        await user.click(screen.getByRole('button', { name: 'Try again' }));

        expect(await screen.findByRole('button', { name: 'Sunday Roast' })).toBeInTheDocument();
        expect(screen.getByRole('searchbox', { name: 'Search recipes' })).toHaveValue('roast');
        expect(screen.queryByRole('button', { name: 'Weeknight Pasta' })).not.toBeInTheDocument();
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

    it('navigates to the create route from the pinned dial when the list is populated', async () => {
        // REWRITTEN for U34 (owner ruling 2026-08-25): the pinned FAB is now a menu TRIGGER, so the route is
        // reached from the dial's single "Create from Scratch" destination. Asserting that opening the dial
        // alone navigates NOWHERE is the half that would otherwise silently pass on a broken wiring.
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'listRecipes').mockResolvedValue(
            makeRecipesPage([makeRecipe({ id: 'rec_1', title: 'Weeknight Pasta' })]),
        );

        renderWithRecipeClient(<RecipeListContainer locale="en" />, client);

        await user.click(await screen.findByRole('button', { name: 'New recipe' }));

        expect(pushMock).not.toHaveBeenCalled();

        await user.click(screen.getByRole('menuitem', { name: 'Create from Scratch' }));

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

    it('says NO MATCH — not "no recipes yet" — when the search filters every loaded recipe out, and keeps the dial', async () => {
        // The container is what turns the typed term into the results' `narrowed` answer; a container that stopped
        // passing it would tell a cook with a full library that they have nothing, and offer first-run copy.
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'listRecipes').mockResolvedValue(
            makeRecipesPage([makeRecipe({ id: 'rec_1', title: 'Weeknight Pasta' })]),
        );

        renderWithRecipeClient(<RecipeListContainer locale="en" />, client);
        await screen.findByRole('button', { name: 'Weeknight Pasta' });

        await user.type(screen.getByRole('searchbox', { name: 'Search recipes' }), 'zzz');

        expect(screen.getByText('No matching recipes')).toBeInTheDocument();
        expect(screen.queryByText('No recipes yet')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Create your first recipe' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'New recipe' })).toBeInTheDocument();
    });

    it('says NO MATCH — not first-run copy — when pressed CHIPS alone filter every row out', async () => {
        // No search term at all: only the chips narrow. Each chip is derived from a recipe that carries it, so one
        // chip can never empty the list — two that no single recipe satisfies together can. A container that told the
        // results only about the search term would call this cook's full library empty.
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'listRecipes').mockResolvedValue(
            makeRecipesPage([
                makeRecipe({ id: 'rec_1', title: 'Weeknight Pasta', dietaryFlags: ['Vegetarian'], cuisine: 'British' }),
                makeRecipe({ id: 'rec_2', title: 'Sunday Roast', dietaryFlags: [], cuisine: 'Italian' }),
            ]),
        );

        renderWithRecipeClient(<RecipeListContainer locale="en" />, client);
        await screen.findByRole('button', { name: 'Weeknight Pasta' });

        const chips = screen.getByRole('group', { name: 'Quick filters' });
        await user.click(within(chips).getByRole('button', { name: 'Vegetarian' }));
        await user.click(within(chips).getByRole('button', { name: 'Italian' }));

        expect(screen.getByText('No matching recipes')).toBeInTheDocument();
        expect(screen.queryByText('No recipes yet')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Create your first recipe' })).not.toBeInTheDocument();
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

describe('RecipeListContainer — a failed refresh of the rows on screen', () => {
    it('⛔ keeps the rows, says the refresh failed, and a Try again that works clears it and moves focus to the heading', async () => {
        const user = userEvent.setup();
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const client = createFakeRecipeServiceClient();
        const page = makeRecipesPage([makeRecipe({ id: 'rec_1', title: 'Weeknight Pasta' })]);
        const listRecipes = vi
            .spyOn(client, 'listRecipes')
            .mockResolvedValueOnce(page)
            .mockRejectedValueOnce(new Error('network down'))
            .mockResolvedValue(page);

        renderWithRecipeClient(<RecipeListContainer locale="en" />, client, { queryClient });
        await screen.findByRole('button', { name: 'Weeknight Pasta' });

        // A focus or reconnect refetch that fails over the loaded page.
        await act(async () => {
            await queryClient.refetchQueries({ queryKey: recipeServiceKeys.recipeLists });
        });

        expect(await screen.findAllByText('We couldn’t refresh your recipes.')).not.toHaveLength(0);
        expect(screen.getByRole('button', { name: 'Weeknight Pasta' })).toBeInTheDocument();
        expect(screen.queryByText('We couldn’t load your recipes.')).not.toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Try again' }));

        await waitFor(() => expect(screen.queryAllByText('We couldn’t refresh your recipes.')).toHaveLength(0));
        expect(listRecipes).toHaveBeenCalledTimes(3);
        await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Recipes' })));
    });
});

/**
 * `/recipes` is server-prefetched. The frame (heading, source switcher, search) sits outside the read boundary, so it
 * ships in the HTML either way; the rows ship only when the prefetch succeeded, and a failed one ships the loading state
 * with no read on the server (B19).
 */
describe('RecipeListContainer — across the server render', () => {
    function page(client: ReturnType<typeof createFakeRecipeServiceClient>, queryClient: QueryClient): ReactNode {
        return (
            <LocaleProvider locale="en">
                <QueryClientProvider client={queryClient}>
                    <RecipeServiceProvider client={client}>
                        <RecipeListContainer locale="en" />
                    </RecipeServiceProvider>
                </QueryClientProvider>
            </LocaleProvider>
        );
    }

    /** The request's cache after a SUCCESSFUL prefetch, built exactly as the page builds it. */
    async function prefetched(client: ReturnType<typeof createFakeRecipeServiceClient>): Promise<QueryClient> {
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });

        await queryClient.prefetchQuery(recipeQueries(client).list());

        return queryClient;
    }

    it('⛔ ships the frame AND the prefetched rows in the server HTML, reading nothing more', async () => {
        const client = createFakeRecipeServiceClient();
        const list = vi
            .spyOn(client, 'listRecipes')
            .mockResolvedValue(makeRecipesPage([makeRecipe({ id: 'rec_1', title: 'Weeknight Pasta' })]));
        const queryClient = await prefetched(client);

        const html = renderToString(page(client, queryClient));

        expect(html).toContain('Search recipes');
        expect(html).toContain('Weeknight Pasta');
        expect(html).not.toContain('Loading recipes');
        expect(list).toHaveBeenCalledTimes(1);
    });

    it('ships the frame and the loading state — no dial — reading nothing, when the prefetch failed', () => {
        const client = createFakeRecipeServiceClient();
        const list = vi.spyOn(client, 'listRecipes');

        const html = renderToString(page(client, new QueryClient({ defaultOptions: { queries: { retry: false } } })));

        expect(html).toContain('Search recipes');
        expect(html).toContain('Loading recipes');
        expect(html).not.toContain('New recipe');
        expect(list).not.toHaveBeenCalled();
    });

    it('hydrates the prefetched rows with no recoverable error and no refetch', async () => {
        const client = createFakeRecipeServiceClient();
        const list = vi
            .spyOn(client, 'listRecipes')
            .mockResolvedValue(makeRecipesPage([makeRecipe({ id: 'rec_1', title: 'Weeknight Pasta' })]));
        const container = document.createElement('div');
        container.innerHTML = renderToString(page(client, await prefetched(client)));
        document.body.append(container);
        const hydrating = await prefetched(client);
        const onRecoverableError = vi.fn();

        await act(async () => {
            hydrateRoot(container, page(client, hydrating), { onRecoverableError });
        });

        expect(onRecoverableError).not.toHaveBeenCalled();
        // Two prefetches (one per simulated request), and nothing from the hydrated page.
        expect(list).toHaveBeenCalledTimes(2);
        expect(container.textContent).toContain('Weeknight Pasta');
        container.remove();
    });
});
