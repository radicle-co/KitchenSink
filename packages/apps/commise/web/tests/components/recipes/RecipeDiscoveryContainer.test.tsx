/**
 * Component tests for RecipeDiscoveryContainer (T076 web public-discovery wiring, U7 overhaul). Covers the
 * states the container projects onto the shared building blocks — loading, populated, empty/no-match, error
 * (with retry) — plus the U7 behaviours: the search FETCH is debounced while the input echoes immediately,
 * and with no active query/filter the surface shows the curated browse rails (not a bare stream), whose
 * "see all" reveals the full sorted list.
 *
 * A URL filter (`tags=quick`) is the lever used to put the container into RESULT-LIST mode for the tests
 * that exercise the flat list — with neither a query nor a filter the container is in BROWSE mode by design.
 *
 * The final block covers the U7 recent-search memory through the REAL `localStorage` adapter: only a search
 * that actually ran is recorded, a persisted history survives a fresh mount, choosing one runs it, and
 * clear-all empties both the panel and storage.
 *
 * Wiring seam: `renderWithRecipeClient` mounts the container through the REAL `useInfiniteSearchRecipes` /
 * `useCloneRecipe` hooks over a network-guarded fake `RecipeServiceClient`, stubbed per test with
 * `vi.spyOn(client, 'searchRecipes' | 'cloneRecipe')`. The Next router mocks and the `replaceState` spy
 * stay as before.
 */
import { EMPTY_RECIPE_FILTERS, RECENT_SEARCHES_STORAGE_KEY, discoverySearchParams } from '@commise/features-recipes';
import { LocaleProvider } from '@commise/i18n/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { recipeQueries, type RecipeSearchResponse } from '@kitchensink/recipe-service-client';
import { RecipeServiceProvider, recipeServiceKeys } from '@kitchensink/recipe-service-client/hooks';
import { RecipeSearchSortBy } from '@kitchensink/recipe-core';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import type { RecipeNutritionResponse } from '@kitchensink/recipe-service-client';
import type { ReactNode } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithRecipeClient } from '@commise/test-utils';

import { RecipeDiscoveryContainer } from '@/components/recipes/RecipeDiscoveryContainer';

import { makeSearchFacets, makeSearchResponse, makeSearchResult } from './__fixtures__/discoveryFixtures';
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

/**
 * A fake client whose calorie lookup never settles. Calories on these cards are the `.nutrition` suite's subject; here a
 * lookup the fake REJECTED (the fixture ids are not UUIDs, so the client's own contract check refuses the batch) made
 * the card's slot throw during a concurrent render, and React's "recovered by rendering synchronously" report reached
 * vitest as an unhandled error on a loaded CI runner (run 34856885723) while passing locally. A pending lookup keeps
 * every slot on its skeleton, which no assertion in this file reads.
 */
function discoveryClient(): ReturnType<typeof createFakeRecipeServiceClient> {
    const client = createFakeRecipeServiceClient();
    vi.spyOn(client, 'getRecipeNutrition').mockReturnValue(new Promise<RecipeNutritionResponse>(() => undefined));

    return client;
}

/**
 * The visible results header reading `text` — never the frame's announcement region, which repeats the same sentence.
 */
function resultsHeader(text: string): HTMLElement {
    const headers = screen.getAllByText(text).filter((node) => node.getAttribute('role') !== 'status');
    expect(headers, `one visible header reads "${text}"`).toHaveLength(1);

    return headers[0] as HTMLElement;
}

/** The design-system pending bar, drawn over results that newer ones are about to replace; `null` once settled. */
function pendingBar(): Element | null {
    return document.querySelector('.animate-pending-bar-reveal');
}

/** Put the container into RESULT-LIST mode (a filter is active, so it is not browsing). */
function withResults(): void {
    nav.params = new URLSearchParams('tags=quick');
}

afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    nav.params = new URLSearchParams();
});

describe('RecipeDiscoveryContainer — source switcher (L5)', () => {
    it('offers a link BACK to the caller’s own recipes, with Community as the current source', () => {
        // The owner-reported dead end: this surface rendered a heading and nothing else, so choosing
        // "Community" on /recipes was a one-way trip. The switcher is mounted here with the SAME destinations
        // the list container hands over, so the pair is symmetric.
        const client = discoveryClient();
        vi.spyOn(client, 'searchRecipes').mockResolvedValue(makeSearchResponse([]));

        renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client);

        const nav = screen.getByRole('navigation', { name: 'Recipe source' });
        expect(within(nav).getByRole('link', { name: 'My Recipes' })).toHaveAttribute('href', '/en/recipes');
        expect(within(nav).getByRole('link', { name: 'Community' })).toHaveAttribute('aria-current', 'page');
    });
});

describe('RecipeDiscoveryContainer — result list', () => {
    it('keeps the heading, the source switcher, the search field and the sort on screen while the search loads', () => {
        // §11.0: the pending read suspends the RESULTS only. The frame sits outside the boundary, so a viewer can keep
        // typing, filtering and sorting before the search has answered.
        withResults();
        const client = discoveryClient();
        vi.spyOn(client, 'searchRecipes').mockReturnValue(new Promise(() => {}));

        renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client);

        expect(screen.getByRole('heading', { name: 'Discover recipes' })).toBeInTheDocument();
        expect(screen.getByRole('navigation', { name: 'Recipe source' })).toBeInTheDocument();
        expect(screen.getByRole('searchbox', { name: 'Search public recipes' })).toBeInTheDocument();
        expect(screen.getByRole('radiogroup', { name: 'Sort by' })).toBeInTheDocument();
    });

    it('renders the loading state while the search query is pending', () => {
        withResults();
        const client = discoveryClient();
        vi.spyOn(client, 'searchRecipes').mockReturnValue(new Promise(() => {}));

        renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client);

        expect(screen.getByRole('status', { name: 'Loading recipes' })).toBeInTheDocument();
    });

    it('renders the populated results with a count when the search loads', async () => {
        withResults();
        const client = discoveryClient();
        vi.spyOn(client, 'searchRecipes').mockResolvedValue(
            makeSearchResponse([
                makeSearchResult({ recipe: makeRecipe({ id: 'rec_1', title: 'Weeknight Pasta' }) }),
                makeSearchResult({ recipe: makeRecipe({ id: 'rec_2', title: 'Sunday Roast' }) }),
            ]),
        );

        renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client);

        expect(await screen.findByRole('button', { name: 'Weeknight Pasta' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Sunday Roast' })).toBeInTheDocument();
        // REWRITTEN (scope only): the header is read from the visible results, since the frame now announces it too.
        expect(resultsHeader('2 recipes')).toBeInTheDocument();
    });

    it('renders the no-match state when a filtered search succeeds with no hits', async () => {
        withResults();
        const client = discoveryClient();
        vi.spyOn(client, 'searchRecipes').mockResolvedValue(makeSearchResponse([]));

        renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client);

        // REWRITTEN (scope only): read from the visible results, since the frame now announces the same title.
        await waitFor(() => expect(resultsHeader('No matching recipes')).toBeInTheDocument());
    });

    it('renders the error state and retries on demand', async () => {
        withResults();
        const user = userEvent.setup();
        const client = discoveryClient();
        const searchSpy = vi.spyOn(client, 'searchRecipes').mockRejectedValue(new Error('boom'));

        renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client);

        expect(await screen.findByRole('alert')).toBeInTheDocument();
        expect(searchSpy).toHaveBeenCalledTimes(1);

        await user.click(screen.getByRole('button', { name: 'Try again' }));

        await vi.waitFor(() => expect(searchSpy).toHaveBeenCalledTimes(2));
    });

    it('re-runs the search with the chosen sort (S3)', async () => {
        withResults();
        const user = userEvent.setup();
        const client = discoveryClient();
        const searchSpy = vi.spyOn(client, 'searchRecipes').mockResolvedValue(makeSearchResponse([]));

        renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client);

        await user.click(await screen.findByRole('radio', { name: 'Quickest' }));

        await vi.waitFor(() =>
            expect(searchSpy).toHaveBeenCalledWith({ tags: ['quick'], sortBy: 'quickest', page: 1 }),
        );
    });

    it('navigates to the recipe detail route when a result is selected', async () => {
        withResults();
        const user = userEvent.setup();
        const client = discoveryClient();
        vi.spyOn(client, 'searchRecipes').mockResolvedValue(
            makeSearchResponse([makeSearchResult({ recipe: makeRecipe({ id: 'rec_42', title: 'Weeknight Pasta' }) })]),
        );

        renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client);

        await user.click(await screen.findByRole('button', { name: 'Weeknight Pasta' }));

        expect(pushMock).toHaveBeenCalledWith('/en/recipes/rec_42');
    });

    it('clones the selected recipe and navigates to the clone on success', async () => {
        withResults();
        const user = userEvent.setup();
        const client = discoveryClient();
        vi.spyOn(client, 'searchRecipes').mockResolvedValue(
            makeSearchResponse([makeSearchResult({ recipe: makeRecipe({ id: 'rec_7', title: 'Sunday Roast' }) })]),
        );
        const cloneSpy = vi.spyOn(client, 'cloneRecipe').mockResolvedValue(makeRecipeDetail({ id: 'rec_clone' }));

        renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client);

        await user.click(await screen.findByRole('button', { name: 'Clone Sunday Roast' }));

        expect(cloneSpy).toHaveBeenCalledWith('rec_7');
        await vi.waitFor(() => expect(pushMock).toHaveBeenCalledWith('/en/recipes/rec_clone'));
    });

    it('busies only the row whose clone is in flight', async () => {
        withResults();
        const user = userEvent.setup();
        const client = discoveryClient();
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
        // REWRITTEN: busy is `aria-disabled` and stays focusable (native `disabled` drops focus — WCAG 2.2 SC 2.4.3).
        expect(busy).toHaveAttribute('aria-disabled', 'true');
        expect(busy).not.toBeDisabled();
        expect(screen.getByRole('button', { name: 'Clone Weeknight Pasta' })).toBeEnabled();
    });
});

describe('RecipeDiscoveryContainer — URL criteria', () => {
    it('projects the filters from the URL onto the search params and the pressed chips', async () => {
        nav.params = new URLSearchParams('dietaryFlags=vegan');
        const client = discoveryClient();
        const searchSpy = vi
            .spyOn(client, 'searchRecipes')
            .mockResolvedValue(
                makeSearchResponse([], { facets: makeSearchFacets({ dietaryFlags: [{ value: 'vegan', count: 2 }] }) }),
            );

        renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client);

        const chip = await screen.findByRole('button', { name: 'vegan, 2 recipes' });
        expect(chip.getAttribute('aria-pressed')).toBe('true');
        expect(searchSpy).toHaveBeenCalledWith({ dietaryFlags: ['vegan'], sortBy: 'relevance', page: 1 });
    });

    it('writes a toggled facet to the URL', async () => {
        const user = userEvent.setup();
        const replaceState = vi.spyOn(window.history, 'replaceState');
        const client = discoveryClient();
        vi.spyOn(client, 'searchRecipes').mockResolvedValue(
            makeSearchResponse([], { facets: makeSearchFacets({ dietaryFlags: [{ value: 'vegan', count: 2 }] }) }),
        );

        renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client);

        await user.click(await screen.findByRole('button', { name: 'vegan, 2 recipes' }));

        expect(replaceState).toHaveBeenLastCalledWith(null, '', '/en/discover?dietaryFlags=vegan');
    });
});

describe('RecipeDiscoveryContainer — debounced search (U7)', () => {
    it('echoes each keystroke immediately but never fetches an intermediate query', async () => {
        const user = userEvent.setup();
        const client = discoveryClient();
        const searchSpy = vi.spyOn(client, 'searchRecipes').mockResolvedValue(makeSearchResponse([]));

        renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client);

        const box = screen.getByRole<HTMLInputElement>('searchbox', { name: 'Search public recipes' });
        await user.type(box, 'pasta');

        // Immediate echo — the field shows the full typed value without waiting on the debounce.
        expect(box.value).toBe('pasta');
        // The debounce settles ONCE on the final value: no intermediate query ('p'…'past') is ever fetched.
        expect(searchSpy).not.toHaveBeenCalledWith(expect.objectContaining({ query: 'past' }));

        // After the window elapses, the settled query fetches exactly once.
        await vi.waitFor(() => expect(searchSpy).toHaveBeenCalledWith(expect.objectContaining({ query: 'pasta' })));
    });

    it('writes the typed search term to the URL (shareable)', async () => {
        const user = userEvent.setup();
        const replaceState = vi.spyOn(window.history, 'replaceState');
        const client = discoveryClient();
        vi.spyOn(client, 'searchRecipes').mockResolvedValue(makeSearchResponse([]));

        renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client);

        await user.type(screen.getByRole('searchbox', { name: 'Search public recipes' }), 'p');

        expect(replaceState).toHaveBeenLastCalledWith(null, '', '/en/discover?query=p');
    });
});

describe('RecipeDiscoveryContainer — a failed refresh of the browse rails on screen', () => {
    it('⛔ keeps the rails, shows ONE notice for them, and a Try again that works clears it and moves focus', async () => {
        const user = userEvent.setup();
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const client = discoveryClient();
        const searchRecipes = vi
            .spyOn(client, 'searchRecipes')
            .mockResolvedValue(
                makeSearchResponse([makeSearchResult({ recipe: makeRecipe({ id: 'rec_1', title: 'Curated Dish' }) })]),
            );

        renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client, { queryClient });
        await screen.findByRole('heading', { name: 'Trending' });
        expect(await screen.findAllByRole('button', { name: 'Curated Dish' })).not.toHaveLength(0);

        // Every rail's refresh fails once — one outage of the endpoint they share.
        searchRecipes.mockRejectedValueOnce(new Error('down')).mockRejectedValueOnce(new Error('down'));
        searchRecipes.mockRejectedValueOnce(new Error('down')).mockRejectedValueOnce(new Error('down'));
        await act(async () => {
            await queryClient.refetchQueries({ queryKey: recipeServiceKeys.recipeSearches });
        });

        expect(await screen.findAllByText('We couldn’t refresh these recipes.')).not.toHaveLength(0);
        expect(screen.getAllByRole('button', { name: 'Curated Dish' })).not.toHaveLength(0);
        expect(screen.queryByText('Couldn’t load this row.')).not.toBeInTheDocument();
        expect(screen.getAllByRole('button', { name: 'Try again' })).toHaveLength(1);

        await user.click(screen.getByRole('button', { name: 'Try again' }));

        await waitFor(() => expect(screen.queryAllByText('We couldn’t refresh these recipes.')).toHaveLength(0));
        await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Trending' })));
    });
});

describe('RecipeDiscoveryContainer — ONE rail’s failed refresh', () => {
    it('reports the notice when only the LAST rail’s refresh fails, not just the first', async () => {
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const client = discoveryClient();
        let quickFails = false;
        vi.spyOn(client, 'searchRecipes').mockImplementation(async (params) => {
            if (quickFails && params?.sortBy === RecipeSearchSortBy.QUICKEST) {
                throw new Error('down');
            }

            return makeSearchResponse([
                makeSearchResult({ recipe: makeRecipe({ id: 'rec_1', title: 'Curated Dish' }) }),
            ]);
        });

        renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client, { queryClient });
        await screen.findByRole('heading', { name: 'Quick' });
        expect(await screen.findAllByRole('button', { name: 'Curated Dish' })).not.toHaveLength(0);

        quickFails = true;
        await act(async () => {
            await queryClient.refetchQueries({ queryKey: recipeServiceKeys.recipeSearches });
        });

        expect(await screen.findAllByText('We couldn’t refresh these recipes.')).not.toHaveLength(0);
    });
});

describe('RecipeDiscoveryContainer — browse rails (U7)', () => {
    it('shows the curated rails (not a bare stream) when nothing is active', async () => {
        const client = discoveryClient();
        vi.spyOn(client, 'searchRecipes').mockResolvedValue(
            makeSearchResponse([makeSearchResult({ recipe: makeRecipe({ id: 'rec_1', title: 'Curated Dish' }) })]),
        );

        renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client);

        expect(await screen.findByRole('heading', { name: 'Trending' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'New' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Quick' })).toBeInTheDocument();
    });

    it('runs no query-less flat stream: still issues the relevance search for facets', () => {
        const client = discoveryClient();
        const searchSpy = vi.spyOn(client, 'searchRecipes').mockResolvedValue(makeSearchResponse([]));

        renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client);

        // The main (facet-providing) search still runs with the default relevance sort and no query param.
        expect(searchSpy).toHaveBeenCalledWith({ sortBy: 'relevance', page: 1 });
    });

    it('offers no sort while browsing, and offers it on the keystroke that starts a search', async () => {
        // Moved from the retired leaf's "hides the sort control while browsing": the container decides it now. The frame
        // follows what the viewer asked for NOW, so the sort appears as they type — before that search has answered.
        const user = userEvent.setup();
        const client = discoveryClient();
        vi.spyOn(client, 'searchRecipes').mockImplementation((params) =>
            params?.query === undefined ? Promise.resolve(makeSearchResponse([])) : new Promise(() => {}),
        );

        renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client);
        await screen.findByRole('heading', { name: 'Trending' });
        expect(screen.queryByRole('radiogroup', { name: 'Sort by' })).not.toBeInTheDocument();

        await user.type(screen.getByRole('searchbox', { name: 'Search public recipes' }), 'l');

        expect(screen.getByRole('radiogroup', { name: 'Sort by' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Trending' })).toBeInTheDocument();
    });

    it('offers cuisine shortcuts from the facets and writes the chosen cuisine to the URL', async () => {
        const user = userEvent.setup();
        const replaceState = vi.spyOn(window.history, 'replaceState');
        const client = discoveryClient();
        vi.spyOn(client, 'searchRecipes').mockResolvedValue(
            makeSearchResponse([], { facets: makeSearchFacets({ cuisine: [{ value: 'Thai', count: 3 }] }) }),
        );

        renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client);

        await user.click(await screen.findByRole('button', { name: 'Browse Thai recipes' }));

        expect(replaceState).toHaveBeenLastCalledWith(null, '', '/en/discover?cuisine=Thai');
    });

    it('a rail’s "see all" reveals the full list sorted by that rail', async () => {
        const user = userEvent.setup();
        const client = discoveryClient();
        const searchSpy = vi.spyOn(client, 'searchRecipes').mockResolvedValue(makeSearchResponse([]));

        renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client);

        await user.click(await screen.findByRole('button', { name: 'See all Trending' }));

        // The full result list now runs with the rail's sort (most-cloned) and no rail page cap. REWRITTEN to wait for
        // the rails to go: leaving browse rides with the deferred criteria, so the rails stay until that list settles.
        await vi.waitFor(() => expect(searchSpy).toHaveBeenCalledWith({ sortBy: 'most-cloned', page: 1 }));
        await waitFor(() => expect(screen.queryByRole('heading', { name: 'Trending' })).not.toBeInTheDocument());
    });

    it('⛔ keeps a rail that failed to load to ITSELF — the other rails render, and its Try again loads it', async () => {
        // Each rail reads behind its own boundary, so one failed rail neither blanks the block nor the other rails.
        const user = userEvent.setup();
        const client = discoveryClient();
        let quickFails = true;
        vi.spyOn(client, 'searchRecipes').mockImplementation(async (params) => {
            if (params?.pageSize !== undefined && params.sortBy === RecipeSearchSortBy.QUICKEST && quickFails) {
                throw new Error('down');
            }

            return makeSearchResponse([
                makeSearchResult({
                    recipe: makeRecipe({ id: `rec_${params?.sortBy ?? 'main'}`, title: `${params?.sortBy} dish` }),
                }),
            ]);
        });

        renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client);

        expect(await screen.findByText('Couldn’t load this row.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'most-cloned dish' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'recent dish' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Quick' })).toBeInTheDocument();

        quickFails = false;
        await act(async () => {
            await user.click(screen.getByRole('button', { name: 'Try again' }));
        });

        expect(await screen.findByRole('button', { name: 'quickest dish' })).toBeInTheDocument();
        expect(screen.queryByText('Couldn’t load this row.')).not.toBeInTheDocument();
        // The pressed Try again unmounted as the rail reloaded, so focus went to that rail's own heading (SC 2.4.3).
        expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Quick' }));
    });

    it('returns from a rail’s full list to the rails through Back to browse', async () => {
        const user = userEvent.setup();
        const client = discoveryClient();
        vi.spyOn(client, 'searchRecipes').mockResolvedValue(
            makeSearchResponse([makeSearchResult({ recipe: makeRecipe({ id: 'rec_1', title: 'Curated Dish' }) })]),
        );

        renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client);
        await user.click(await screen.findByRole('button', { name: 'See all Trending' }));
        await waitFor(() => expect(screen.queryByRole('heading', { name: 'Trending' })).not.toBeInTheDocument());

        // Awaited `act`: returning to the rails mounts cards whose calorie slots suspend, and a suspension inside an
        // un-awaited `act` leaves React's retry in a queue the test never flushes.
        await act(async () => {
            await user.click(screen.getByRole('button', { name: 'Back to browse' }));
        });

        expect(await screen.findByRole('heading', { name: 'Trending' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Back to browse' })).not.toBeInTheDocument();
    });

    it('reaches the BROWSE-EMPTY copy (not the no-match copy) after a rail’s "see all" finds nothing', async () => {
        const user = userEvent.setup();
        const client = discoveryClient();
        vi.spyOn(client, 'searchRecipes').mockResolvedValue(makeSearchResponse([]));

        renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client);

        await user.click(await screen.findByRole('button', { name: 'See all Trending' }));

        // This pins `discovery.emptyTitle`/`emptyBody` as LIVE web copy rather than an unreachable string.
        // The container supplies `browseSlot` only while browsing, so leaving browse via "see all" is the
        // one path with no query, no filter AND no browse slot — precisely the browse-empty branch. Without
        // it, the only zero-result copy a web viewer could ever see would be the no-match wording, which
        // wrongly implies a search they never made.
        // REWRITTEN (scope only): read from the visible results, since the frame now announces the same title.
        await waitFor(() => expect(resultsHeader('No recipes found')).toBeInTheDocument());
        expect(screen.queryByText('No matching recipes')).not.toBeInTheDocument();
    });

    it('offers a working retry when the load fails on the BROWSE default, not just in a result list', async () => {
        const user = userEvent.setup();
        const client = discoveryClient();
        const searchSpy = vi.spyOn(client, 'searchRecipes').mockRejectedValue(new Error('boom'));

        renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client);

        // Browsing is /discover's default, so a failure here used to settle into curated rails with the
        // failure — and its only recovery affordance — rendered nowhere at all.
        const retry = await screen.findByRole('button', { name: 'Try again' }, { timeout: 5000 });
        const before = searchSpy.mock.calls.length;

        await user.click(retry);

        await vi.waitFor(() => expect(searchSpy.mock.calls.length).toBeGreaterThan(before));
    });
});

/**
 * Recent searches, end-to-end through the REAL `localStorage` adapter (jsdom provides it) — the integration
 * these tests exist for is "does the container record the right thing, in the right place, and offer it
 * back", not the pure list rules (covered in `recentSearches.test.ts`) or the panel's visibility rules
 * (covered in `RecipeDiscoveryFrame.test.tsx`).
 */
describe('RecipeDiscoveryContainer — recent searches (U7)', () => {
    afterEach(() => window.localStorage.clear());

    /** The search field, as the user reaches it. */
    function searchBox(): HTMLInputElement {
        return screen.getByRole<HTMLInputElement>('searchbox', { name: 'Search public recipes' });
    }

    it('records a search that actually ran, and offers it once the field goes blank again', async () => {
        const user = userEvent.setup();
        const client = discoveryClient();
        const searchSpy = vi.spyOn(client, 'searchRecipes').mockResolvedValue(makeSearchResponse([]));

        renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client);

        await user.type(searchBox(), 'pasta');
        await vi.waitFor(() => expect(searchSpy).toHaveBeenCalledWith(expect.objectContaining({ query: 'pasta' })));

        // Clearing the field (focus stays in it) returns the surface to its idle state — where the history is
        // the useful thing to show.
        await user.clear(searchBox());

        expect(await screen.findByRole('button', { name: 'Search for “pasta”' })).toBeInTheDocument();
        await vi.waitFor(() =>
            expect(window.localStorage.getItem(RECENT_SEARCHES_STORAGE_KEY)).toBe(JSON.stringify(['pasta'])),
        );
    });

    it('records NOTHING for a whitespace-only query', async () => {
        const user = userEvent.setup();
        const client = discoveryClient();
        vi.spyOn(client, 'searchRecipes').mockResolvedValue(makeSearchResponse([]));

        renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client);

        await user.type(searchBox(), '   ');
        await vi.waitFor(() => expect(window.localStorage.getItem(RECENT_SEARCHES_STORAGE_KEY)).not.toBeNull());

        expect(window.localStorage.getItem(RECENT_SEARCHES_STORAGE_KEY)).toBe(JSON.stringify([]));
        expect(screen.queryByRole('button', { name: /^Search for/ })).not.toBeInTheDocument();
    });

    it('offers a history persisted by an earlier session (the reload case)', async () => {
        window.localStorage.setItem(RECENT_SEARCHES_STORAGE_KEY, JSON.stringify(['risotto', 'lamb tagine']));
        const user = userEvent.setup();
        const client = discoveryClient();
        vi.spyOn(client, 'searchRecipes').mockResolvedValue(makeSearchResponse([]));

        renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client);

        await user.click(searchBox());

        expect(await screen.findByRole('button', { name: 'Search for “risotto”' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Search for “lamb tagine”' })).toBeInTheDocument();
    });

    it('runs the chosen recent search (field + fetch + shareable URL)', async () => {
        window.localStorage.setItem(RECENT_SEARCHES_STORAGE_KEY, JSON.stringify(['risotto']));
        const user = userEvent.setup();
        const replaceState = vi.spyOn(window.history, 'replaceState');
        const client = discoveryClient();
        const searchSpy = vi.spyOn(client, 'searchRecipes').mockResolvedValue(makeSearchResponse([]));

        renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client);

        await user.click(searchBox());
        await user.click(await screen.findByRole('button', { name: 'Search for “risotto”' }));

        expect(searchBox().value).toBe('risotto');
        expect(replaceState).toHaveBeenLastCalledWith(null, '', '/en/discover?query=risotto');
        await vi.waitFor(() => expect(searchSpy).toHaveBeenCalledWith(expect.objectContaining({ query: 'risotto' })));
    });

    it('clears the whole history, panel and storage alike', async () => {
        window.localStorage.setItem(RECENT_SEARCHES_STORAGE_KEY, JSON.stringify(['risotto', 'pasta']));
        const user = userEvent.setup();
        const client = discoveryClient();
        vi.spyOn(client, 'searchRecipes').mockResolvedValue(makeSearchResponse([]));

        renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client);

        await user.click(searchBox());
        await user.click(await screen.findByRole('button', { name: 'Clear recent searches' }));

        expect(screen.queryByRole('button', { name: /^Search for/ })).not.toBeInTheDocument();
        await vi.waitFor(() =>
            expect(window.localStorage.getItem(RECENT_SEARCHES_STORAGE_KEY)).toBe(JSON.stringify([])),
        );
    });

    it('announces the new count once Load more appends a page (LoadMoreControl announces only a failure)', async () => {
        withResults();
        const user = userEvent.setup();
        const client = discoveryClient();
        vi.spyOn(client, 'searchRecipes')
            .mockResolvedValueOnce(
                makeSearchResponse(
                    [makeSearchResult({ recipe: makeRecipe({ id: 'rec_1', title: 'Weeknight Pasta' }) })],
                    {
                        hasMore: true,
                        total: 2,
                    },
                ),
            )
            .mockResolvedValueOnce(
                makeSearchResponse([makeSearchResult({ recipe: makeRecipe({ id: 'rec_2', title: 'Sunday Roast' }) })], {
                    page: 2,
                    hasMore: false,
                    total: 2,
                }),
            );

        renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client);
        await waitFor(() => expect(announces('1 recipe')).toBe(true));

        await user.click(await screen.findByRole('button', { name: 'Load more' }));

        await waitFor(() => expect(announces('2 recipes')).toBe(true));
    });

    it('⛔ keeps the loaded results when the next page fails, and says so beside Try again', async () => {
        withResults();
        const user = userEvent.setup();
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const client = discoveryClient();
        vi.spyOn(client, 'searchRecipes')
            .mockResolvedValueOnce(
                makeSearchResponse(
                    [makeSearchResult({ recipe: makeRecipe({ id: 'rec_1', title: 'Weeknight Pasta' }) })],
                    {
                        hasMore: true,
                        total: 2,
                    },
                ),
            )
            .mockRejectedValueOnce(new Error('recipe service unavailable'));

        renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client);

        await user.click(await screen.findByRole('button', { name: 'Load more' }));

        expect(await screen.findByText('We couldn’t load more recipes.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Weeknight Pasta' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    });
});

describe('RecipeDiscoveryContainer — a failed refresh of the results on screen', () => {
    it('⛔ keeps the results, says the refresh failed, and a Try again that works clears it and moves focus to the heading', async () => {
        withResults();
        const user = userEvent.setup();
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const client = discoveryClient();
        const response = makeSearchResponse([
            makeSearchResult({ recipe: makeRecipe({ id: 'rec_1', title: 'Weeknight Pasta' }) }),
        ]);
        const searchRecipes = vi
            .spyOn(client, 'searchRecipes')
            .mockResolvedValueOnce(response)
            .mockRejectedValueOnce(new Error('network down'))
            .mockResolvedValue(response);

        renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client, { queryClient });
        await screen.findByRole('button', { name: 'Weeknight Pasta' });

        await act(async () => {
            await queryClient.refetchQueries({ queryKey: recipeServiceKeys.recipeSearches });
        });

        expect(await screen.findAllByText('We couldn’t refresh these results.')).not.toHaveLength(0);
        expect(screen.getByRole('button', { name: 'Weeknight Pasta' })).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Try again' }));

        await waitFor(() => expect(screen.queryAllByText('We couldn’t refresh these results.')).toHaveLength(0));
        expect(searchRecipes).toHaveBeenCalledTimes(3);
        await waitFor(() =>
            expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Discover recipes' })),
        );
    });
});

/** A promise the test settles by hand. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: unknown) => void } {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((settle, fail) => {
        resolve = settle;
        reject = fail;
    });

    return { promise, resolve, reject };
}

/** Whether a polite status region is currently saying exactly `text`. */
function announces(text: string): boolean {
    return screen.queryAllByRole('status').some((region) => region.textContent === text);
}

/**
 * A newer search pending behind the results on screen (`recipe-search.md`, "Updating Results State"). The criteria are
 * deferred, so typing past the debounce, changing the sort or a filter keeps the previous results — readable, usable,
 * and still naming the query they belong to — instead of swapping them for the skeleton; the pending bar shows until the
 * new results commit, and only then is the new header announced.
 */
describe('RecipeDiscoveryContainer — a newer search pending behind the results on screen', () => {
    const pasta = makeSearchResult({ recipe: makeRecipe({ id: 'rec_1', title: 'Weeknight Pasta' }) });
    const tagine = makeSearchResult({ recipe: makeRecipe({ id: 'rec_2', title: 'Lamb Tagine' }) });

    function searchBox(): HTMLInputElement {
        return screen.getByRole<HTMLInputElement>('searchbox', { name: 'Search public recipes' });
    }

    it('⛔ keeps the previous results, under the pending bar and naming their own query, with no loading state — then the new ones', async () => {
        withResults();
        const user = userEvent.setup();
        const client = discoveryClient();
        const lamb = deferred<RecipeSearchResponse>();
        const searchSpy = vi
            .spyOn(client, 'searchRecipes')
            .mockImplementation((params) =>
                params?.query === 'lamb' ? lamb.promise : Promise.resolve(makeSearchResponse([pasta])),
            );

        renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client);
        await screen.findByRole('button', { name: 'Weeknight Pasta' });

        await user.type(searchBox(), 'lamb');
        await vi.waitFor(() => expect(searchSpy).toHaveBeenCalledWith(expect.objectContaining({ query: 'lamb' })));

        expect(screen.getByRole('button', { name: 'Weeknight Pasta' })).toBeInTheDocument();
        expect(screen.queryByRole('status', { name: 'Loading recipes' })).not.toBeInTheDocument();
        expect(pendingBar()).not.toBeNull();
        expect(resultsHeader('1 recipe')).toBeInTheDocument();
        expect(searchBox()).toHaveValue('lamb');
        expect(announces('Showing 1 recipe for “lamb”')).toBe(false);

        await act(async () => {
            lamb.resolve(makeSearchResponse([tagine]));
        });

        expect(await screen.findByRole('button', { name: 'Lamb Tagine' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Weeknight Pasta' })).not.toBeInTheDocument();
        expect(pendingBar()).toBeNull();
        expect(resultsHeader('Showing 1 recipe for “lamb”')).toBeInTheDocument();
        expect(announces('Showing 1 recipe for “lamb”')).toBe(true);
    });

    it('keeps the previous results on screen while a new sort loads', async () => {
        withResults();
        const user = userEvent.setup();
        const client = discoveryClient();
        const quickest = deferred<RecipeSearchResponse>();
        const searchSpy = vi
            .spyOn(client, 'searchRecipes')
            .mockImplementation((params) =>
                params?.sortBy === RecipeSearchSortBy.QUICKEST
                    ? quickest.promise
                    : Promise.resolve(makeSearchResponse([pasta])),
            );

        renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client);
        await screen.findByRole('button', { name: 'Weeknight Pasta' });

        await user.click(screen.getByRole('radio', { name: 'Quickest' }));
        await vi.waitFor(() => expect(searchSpy).toHaveBeenCalledWith(expect.objectContaining({ sortBy: 'quickest' })));

        expect(screen.getByRole('radio', { name: 'Quickest' })).toHaveAttribute('aria-checked', 'true');
        expect(screen.getByRole('button', { name: 'Weeknight Pasta' })).toBeInTheDocument();
        expect(pendingBar()).not.toBeNull();
    });

    it('keeps the filter bar’s last settled facets while a newer search is pending', async () => {
        // The facets come from the settled search, so the filter groups do not collapse on every keystroke.
        withResults();
        const user = userEvent.setup();
        const client = discoveryClient();
        vi.spyOn(client, 'searchRecipes').mockImplementation((params) =>
            params?.query === 'lamb'
                ? new Promise(() => {})
                : Promise.resolve(
                      makeSearchResponse([pasta], {
                          facets: makeSearchFacets({ dietaryFlags: [{ value: 'vegan', count: 2 }] }),
                      }),
                  ),
        );

        renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client);
        await screen.findByRole('button', { name: 'vegan, 2 recipes' });

        await user.type(searchBox(), 'lamb');
        await waitFor(() => expect(pendingBar()).not.toBeNull());

        expect(screen.getByRole('button', { name: 'vegan, 2 recipes' })).toBeInTheDocument();
    });

    it('replaces the stale results with the load error when the newer search fails, keeping the typed term', async () => {
        withResults();
        const user = userEvent.setup();
        const client = discoveryClient();
        const searchSpy = vi
            .spyOn(client, 'searchRecipes')
            .mockImplementation((params) =>
                params?.query === 'lamb'
                    ? Promise.reject(new Error('down'))
                    : Promise.resolve(makeSearchResponse([pasta])),
            );

        renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client);
        await screen.findByRole('button', { name: 'Weeknight Pasta' });

        await user.type(searchBox(), 'lamb');

        expect(await screen.findByRole('alert')).toHaveTextContent('We couldn’t load recipes.');
        expect(screen.queryByRole('button', { name: 'Weeknight Pasta' })).not.toBeInTheDocument();
        expect(searchBox()).toHaveValue('lamb');
        // The facets observer beside the frame only READS the settled search: mounting it on the failed key must not
        // send that search again behind the error (only Try again or new criteria do).
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 50));
        });
        expect(searchSpy.mock.calls.filter(([params]) => params?.query === 'lamb')).toHaveLength(1);
    });

    it('clears a failed search once the criteria change again, without a Try again', async () => {
        withResults();
        const user = userEvent.setup();
        const client = discoveryClient();
        vi.spyOn(client, 'searchRecipes').mockImplementation((params) =>
            params?.query === 'lamb'
                ? Promise.reject(new Error('down'))
                : Promise.resolve(makeSearchResponse(params?.query === 'lambs' ? [tagine] : [pasta])),
        );

        renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client);
        await screen.findByRole('button', { name: 'Weeknight Pasta' });
        await user.type(searchBox(), 'lamb');
        await screen.findByRole('alert');

        await user.type(searchBox(), 's');

        expect(await screen.findByRole('button', { name: 'Lamb Tagine' })).toBeInTheDocument();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
});

/**
 * `/discover` is server-prefetched with the URL's criteria. The frame sits outside the read boundary, so it ships in the
 * HTML either way; the results ship only when the prefetch succeeded, and a failed one ships the loading state with no
 * read on the server (B19).
 */
describe('RecipeDiscoveryContainer — across the server render', () => {
    const quickCriteria = { filters: { tags: ['quick'] }, query: '', sortBy: RecipeSearchSortBy.RELEVANCE };

    function page(client: ReturnType<typeof createFakeRecipeServiceClient>, queryClient: QueryClient): ReactNode {
        return (
            <LocaleProvider locale="en">
                <QueryClientProvider client={queryClient}>
                    <RecipeServiceProvider client={client}>
                        <RecipeDiscoveryContainer locale="en" />
                    </RecipeServiceProvider>
                </QueryClientProvider>
            </LocaleProvider>
        );
    }

    /** The request's cache after a SUCCESSFUL prefetch, built from the same search params the page sends. */
    async function prefetched(client: ReturnType<typeof createFakeRecipeServiceClient>): Promise<QueryClient> {
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });

        await queryClient.prefetchInfiniteQuery(
            recipeQueries(client).searchInfinite(discoverySearchParams(quickCriteria)),
        );

        return queryClient;
    }

    it('⛔ ships the frame AND the prefetched results in the server HTML, reading nothing more', async () => {
        withResults();
        const client = discoveryClient();
        const search = vi
            .spyOn(client, 'searchRecipes')
            .mockResolvedValue(
                makeSearchResponse([
                    makeSearchResult({ recipe: makeRecipe({ id: 'rec_1', title: 'Weeknight Pasta' }) }),
                ]),
            );
        const queryClient = await prefetched(client);

        const html = renderToString(page(client, queryClient));

        expect(html).toContain('Search public recipes');
        expect(html).toContain('Weeknight Pasta');
        expect(html).not.toContain('Loading recipes');
        // The announcement region ships already holding the settled sentence: a page load announces nothing of its own.
        expect(html).toMatch(/<p role="status" class="sr-only">1 recipe<\/p>/);
        expect(search).toHaveBeenCalledTimes(1);
    });

    it('ships the frame and the loading state, reading nothing, when the prefetch failed', () => {
        withResults();
        const client = discoveryClient();
        const search = vi.spyOn(client, 'searchRecipes');

        const html = renderToString(page(client, new QueryClient({ defaultOptions: { queries: { retry: false } } })));

        expect(html).toContain('Search public recipes');
        expect(html).toContain('Loading recipes');
        expect(search).not.toHaveBeenCalled();
    });

    it('hydrates the prefetched results with no recoverable error and no refetch', async () => {
        withResults();
        const client = discoveryClient();
        const search = vi
            .spyOn(client, 'searchRecipes')
            .mockResolvedValue(
                makeSearchResponse([
                    makeSearchResult({ recipe: makeRecipe({ id: 'rec_1', title: 'Weeknight Pasta' }) }),
                ]),
            );
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
        expect(search).toHaveBeenCalledTimes(2);
        expect(container.textContent).toContain('Weeknight Pasta');
        container.remove();
    });

    it('keys the prefetch exactly as the container reads it — an empty filter state is the browse default', () => {
        const client = discoveryClient();

        expect(
            recipeQueries(client).searchInfinite(
                discoverySearchParams({
                    filters: EMPTY_RECIPE_FILTERS,
                    query: '',
                    sortBy: RecipeSearchSortBy.RELEVANCE,
                }),
            ).queryKey,
        ).toEqual(recipeQueries(client).searchInfinite({ sortBy: RecipeSearchSortBy.RELEVANCE }).queryKey);
    });
});
