// @vitest-environment jsdom
/**
 * The discovery container's half of the deferred calorie lookup — and the reason the lookup batches PER
 * PAGE rather than per accumulated id set.
 *
 * `/discover` is an infinite surface: "Load more" APPENDS. Batching every accumulated id as one request
 * changes the id set on every page, and therefore the query key AND the promise — so every chip already on
 * screen falls back to its skeleton and the whole set is re-fetched. One request per page keeps page one's
 * promise settled forever and asks food only about the recipes that are new. That is the property this file
 * exists to pin, because it is invisible on a single-page surface and obvious to a viewer the moment they
 * press Load more.
 *
 * ⚠️ SUSPENSE CONVENTION (`src/components/home/__tests__/RecipeWidgetSlot.test.tsx:11-22`): settle with
 * `await act(...)`, never `findBy`/`waitFor`.
 */
import {
    RECIPE_BROWSE_RAILS,
    browseRailSearchParams,
    discoverySearchParams,
    filtersFromQueryString,
} from '@commise/features-recipes';
import { LocaleProvider } from '@commise/i18n/react';
import { createAppQueryClient } from '@commise/query';
import { isInvalidRequestError, recipeQueries } from '@kitchensink/recipe-service-client';
import { RecipeServiceProvider } from '@kitchensink/recipe-service-client/hooks';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import { RecipeSearchSortBy } from '@kitchensink/recipe-core';
import type { RecipeNutritionResponse } from '@kitchensink/schema-recipe';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithRecipeClient } from '@commise/test-utils';

import { RecipeDiscoveryContainer } from '@/components/recipes/RecipeDiscoveryContainer';

import { makeRecipe } from './__fixtures__/recipeFixtures';

const { pushMock, replaceStateMock, nav } = vi.hoisted(() => ({
    pushMock: vi.fn(),
    replaceStateMock: vi.fn(),
    nav: { query: 'query=pasta' },
}));

// The container reads its criteria from the URL and writes them back with the history API. A non-blank
// `query` is what puts the surface into its RESULT body — the default body is the curated browse rails.
vi.mock('next/navigation', () => ({
    useRouter: () => ({ push: pushMock }),
    usePathname: () => '/en/discover',
    useSearchParams: () => new URLSearchParams(nav.query),
}));

afterEach(() => {
    nav.query = 'query=pasta';
    cleanup();
    vi.restoreAllMocks();
    vi.clearAllMocks();
});

beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('history', { ...window.history, replaceState: replaceStateMock });
});

const PAGE_ONE = '00000000-0000-4000-8000-00000000000a';
const PAGE_TWO = '00000000-0000-4000-8000-00000000000b';

/** A `known` reading, with the macros the wire requires (a card reads only the calories). */
const known = (caloriesPerServing: number) =>
    ({
        state: 'known',
        caloriesPerServing,
        proteinG: 12,
        carbsG: 40,
        fatG: 18,
        isComplete: true,
        freshness: 'fresh',
    }) as const;

const NUTRITION: RecipeNutritionResponse = {
    nutrition: { [PAGE_ONE]: known(420), [PAGE_TWO]: known(615) },
};

/** The facet block the search envelope requires; discovery's own facet rendering is covered elsewhere. */
const NO_FACETS = { dietaryFlags: [], tags: [], cuisine: [], totalTime: [] } as const;

/** A search client that serves two pages, and a nutrition spy to count the batches they trigger. */
function twoPageClient() {
    const client = createFakeRecipeServiceClient();
    vi.spyOn(client, 'searchRecipes').mockImplementation(async (params) =>
        (params?.page ?? 1) === 1
            ? {
                  results: [{ recipe: makeRecipe({ id: PAGE_ONE, title: 'Weeknight Pasta' }) }],
                  page: 1,
                  pageSize: 1,
                  total: 2,
                  hasMore: true,
                  facets: NO_FACETS,
              }
            : {
                  results: [{ recipe: makeRecipe({ id: PAGE_TWO, title: 'Sunday Roast' }) }],
                  page: 2,
                  pageSize: 1,
                  total: 2,
                  hasMore: false,
                  facets: NO_FACETS,
              },
    );
    const batch = vi.spyOn(client, 'getRecipeNutrition').mockResolvedValue(NUTRITION);

    return { client, batch };
}

/**
 * Render and settle, deterministically. FOUR things happen in sequence — the list/collection query resolves,
 * React commits it, the container derives the ids and starts the batch, and each card's Suspense retries —
 * and each step queues its successor. One macrotask drain covers them on an idle machine and NOT under a
 * loaded parallel run, which is how this shows up as an order-dependent failure rather than a real one. So
 * drain a small fixed number of times: still no DOM POLLING (the Suspense convention above), just enough
 * turns for a chain whose length is known.
 */
const SETTLE_ROUNDS = 4;

const settle = async (): Promise<void> => {
    for (let round = 0; round < SETTLE_ROUNDS; round += 1) {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
    }
};

describe('RecipeDiscoveryContainer — the deferred calorie lookup', () => {
    it('issues ONE batch for the first page of results', async () => {
        const { client, batch } = twoPageClient();

        renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client);
        await settle();

        expect(screen.getByRole('img', { name: '420 cal' })).toBeInTheDocument();
        expect(batch).toHaveBeenCalledTimes(1);
        expect(batch.mock.calls[0]?.[0]).toStrictEqual([PAGE_ONE]);
    });

    // ⛔ THE LOAD-MORE INVARIANT. A second batch, covering ONLY the new page — and page one's chip untouched.
    it('batches the NEXT page separately and leaves page one’s figure settled', async () => {
        const user = userEvent.setup();
        const { client, batch } = twoPageClient();

        renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client);
        await settle();

        await act(async () => {
            await user.click(screen.getByRole('button', { name: /load more/i }));
        });
        await settle();

        expect(batch, 'one request per page, not one per accumulated id set').toHaveBeenCalledTimes(2);
        expect(batch.mock.calls[1]?.[0], 'the second batch asks only about what is NEW').toStrictEqual([PAGE_TWO]);
        expect(
            screen.getByRole('img', { name: '420 cal' }),
            'page one never blinked back to a skeleton',
        ).toBeInTheDocument();
        expect(screen.getByRole('img', { name: '615 cal' })).toBeInTheDocument();
        expect(screen.queryByText('Loading calories')).toBeNull();
    });

    it('shows a calorie skeleton on each result while its batch is in flight', async () => {
        const { client } = twoPageClient();
        vi.spyOn(client, 'getRecipeNutrition').mockReturnValue(new Promise<RecipeNutritionResponse>(() => undefined));

        renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client);
        await settle();

        expect(screen.getByText('Loading calories')).toBeInTheDocument();
    });

    it('renders the result with no figure and no spinner when the batch fails', async () => {
        vi.useFakeTimers();

        try {
            const { client } = twoPageClient();
            vi.spyOn(client, 'getRecipeNutrition').mockRejectedValue(new Error('food service unavailable'));

            renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client);
            await act(async () => {
                await vi.advanceTimersByTimeAsync(5_000);
            });

            expect(screen.getByRole('button', { name: 'Weeknight Pasta' })).toBeInTheDocument();
            expect(screen.queryByText('Loading calories')).toBeNull();
            expect(screen.queryByRole('img', { name: /cal/u })).toBeNull();
        } finally {
            vi.useRealTimers();
        }
    });
});

/**
 * Browsing: the rails are Discover's DEFAULT body and a card grid like any other, so each rail carries its figures — one
 * batch per rail, since the rails settle independently. The main search still runs behind the rails (it feeds the
 * cuisine shortcuts), but its cards are not on screen, so it asks for no figures.
 */
describe('RecipeDiscoveryContainer — the deferred calorie lookup on the browse rails', () => {
    const RAIL_IDS: Record<string, string> = {
        [RecipeSearchSortBy.MOST_CLONED]: '00000000-0000-4000-8000-0000000000c1',
        [RecipeSearchSortBy.RECENT]: '00000000-0000-4000-8000-0000000000c2',
        [RecipeSearchSortBy.QUICKEST]: '00000000-0000-4000-8000-0000000000c3',
    };

    /** A settled one-recipe search page. */
    const onePage = (id: string) => ({
        pages: [
            {
                results: [{ recipe: makeRecipe({ id, title: `dish ${id.slice(-2)}` }) }],
                page: 1,
                pageSize: 12,
                total: 1,
                hasMore: false,
                facets: NO_FACETS,
            },
        ],
        pageParams: [1],
    });

    it('⛔ gives every rail its figures from ONE batch per rail, and batches nothing for the hidden results', async () => {
        nav.query = '';
        const client = createFakeRecipeServiceClient();
        // The searches are SEEDED as settled: this file is about the calorie wiring, and settling three sibling
        // suspense reads inside `act` is a harness loop, not the behaviour under test (the container's own suite loads
        // the rails for real).
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
        queryClient.setQueryData(
            recipeQueries(client).searchInfinite({ sortBy: RecipeSearchSortBy.RELEVANCE }).queryKey,
            onePage(PAGE_ONE),
        );

        for (const rail of RECIPE_BROWSE_RAILS) {
            queryClient.setQueryData(
                recipeQueries(client).searchInfinite(browseRailSearchParams(rail)).queryKey,
                onePage(RAIL_IDS[rail.sortBy] ?? PAGE_TWO),
            );
        }

        const batch = vi.spyOn(client, 'getRecipeNutrition').mockImplementation(async (ids) => ({
            nutrition: Object.fromEntries(ids.map((id) => [id, known(300)])),
        }));

        renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client, { queryClient });
        await settle();

        expect(screen.getByRole('heading', { name: 'Trending' })).toBeInTheDocument();
        expect(screen.getAllByRole('img', { name: '300 cal' })).toHaveLength(3);
        expect(batch.mock.calls.map(([ids]) => ids).sort()).toStrictEqual(
            Object.values(RAIL_IDS)
                .map((id) => [id])
                .sort(),
        );
    });
});

/**
 * ⛔ ADR-0021 / §11.0 — calories never hold back a list. A typed search that settles must replace the rails with its
 * results as soon as the SEARCH answers, whatever the calorie batch is doing. Suspense inside a transition is exactly
 * where that could quietly break: `useDeferredDiscoveryCriteria` renders the new results in the background, and a slot
 * whose `use()` suspended without a fallback React will commit would keep the rails on screen for as long as the batch
 * took.
 *
 * Unlike the suites above, TIME is this block's subject, so it runs on real timers with the app's REAL `QueryClient`
 * (`createAppQueryClient('browser')` — its retry policy is part of what a pending batch looks like) and waits with an
 * explicit, short bound rather than draining `act`: a drain would flush the transition and hide exactly the delay under
 * test. The bound is well under each batch's latency, so a result list that waited on calories cannot pass.
 */
describe('RecipeDiscoveryContainer — a typed search never waits on the calorie batch', () => {
    /**
     * Search debounce (250 ms) plus generous headroom for a loaded parallel run. The in-flight batch below never
     * settles, so a list that waited on it cannot pass inside this bound — and no timer outlives the test.
     */
    const RESULTS_BOUND_MS = 3_000;

    /** A browse-default client whose search narrows on `query`, exactly as the Playwright mock does. */
    function discoveryClient(paellaId: string, pastaId: string) {
        const client = createFakeRecipeServiceClient();
        const paella = { recipe: makeRecipe({ id: paellaId, title: 'Seafood Paella' }) };
        const pasta = { recipe: makeRecipe({ id: pastaId, title: 'Weeknight Pasta' }) };
        vi.spyOn(client, 'searchRecipes').mockImplementation(async (params) => {
            const results = params?.query === 'paella' ? [paella] : [paella, pasta];

            return { results, page: 1, pageSize: 12, total: results.length, hasMore: false, facets: NO_FACETS };
        });

        return client;
    }

    /** Browse, wait for the rails, then type the term — the `recentSearches.spec.ts` sequence. */
    async function searchFromTheRails(client: ReturnType<typeof createFakeRecipeServiceClient>): Promise<void> {
        nav.query = '';
        const user = userEvent.setup();
        renderWithRecipeClient(<RecipeDiscoveryContainer locale="en" />, client, {
            queryClient: createAppQueryClient('browser'),
        });

        await waitFor(() => expect(screen.getAllByRole('button', { name: 'Weeknight Pasta' })).toHaveLength(3), {
            timeout: RESULTS_BOUND_MS,
        });

        await user.type(screen.getByRole('searchbox', { name: 'Search public recipes' }), 'paella');
    }

    /** The results list for the term is on screen and the rails are gone, within the bound. */
    async function expectResultsReplaceRails(): Promise<void> {
        await waitFor(
            () => {
                expect(screen.getAllByText('Showing 1 recipe for “paella”').length).toBeGreaterThan(0);
                expect(screen.queryByRole('heading', { name: 'Trending' })).toBeNull();
                expect(screen.queryByRole('button', { name: 'Weeknight Pasta' })).toBeNull();
                expect(screen.getAllByRole('button', { name: 'Seafood Paella' })).toHaveLength(1);
            },
            { timeout: RESULTS_BOUND_MS },
        );
    }

    it('with a batch the client’s own contract check REJECTS (non-UUID ids, the CI mock) — results replace the rails', async () => {
        // Nothing stubs `getRecipeNutrition`: the REAL client refuses `rec_*` ids before the round trip with
        // `InvalidRequestError`, exactly as it did in the browser.
        const client = discoveryClient('rec_paella', 'rec_pasta');
        const batch = vi.spyOn(client, 'getRecipeNutrition');

        await searchFromTheRails(client);
        await expectResultsReplaceRails();

        await expect(batch.mock.results[0]?.value).rejects.toSatisfy(isInvalidRequestError);
    });

    it('with UUID ids and a batch still in flight — results replace the rails, their figures still loading', async () => {
        const client = discoveryClient(PAGE_ONE, PAGE_TWO);
        const batch = vi
            .spyOn(client, 'getRecipeNutrition')
            .mockReturnValue(new Promise<RecipeNutritionResponse>(() => undefined));

        await searchFromTheRails(client);
        await expectResultsReplaceRails();

        expect(
            batch.mock.calls.map(([ids]) => ids),
            'the results asked for their own batch',
        ).toContainEqual([PAGE_ONE]);
        expect(screen.getByText('Loading calories'), 'and did not wait for it').toBeInTheDocument();
    });
});

/**
 * The SERVER half. `/discover` prefetches the first results page, so its cards render during the Next server pass; a
 * nutrition read started there suspends each card on a promise the server cannot settle, and every such boundary is
 * reported as a recoverable error on hydration.
 */
describe('RecipeDiscoveryContainer — the deferred calorie lookup across the server render', () => {
    /** The request's cache after a SUCCESSFUL `/discover?query=pasta` prefetch, built exactly as the page builds it. */
    async function prefetchedQueryClient(client: ReturnType<typeof twoPageClient>['client']): Promise<QueryClient> {
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
        const { filters, query } = filtersFromQueryString('query=pasta');

        await queryClient.prefetchInfiniteQuery(
            recipeQueries(client).searchInfinite(
                discoverySearchParams({ filters, query, sortBy: RecipeSearchSortBy.RELEVANCE }),
            ),
        );

        return queryClient;
    }

    function page(client: ReturnType<typeof twoPageClient>['client'], queryClient: QueryClient): ReactNode {
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

    it('⛔ a server render of the prefetched results starts NO nutrition read', async () => {
        const { client, batch } = twoPageClient();

        const html = renderToString(page(client, await prefetchedQueryClient(client)));

        expect(html, 'the prefetched results ship in the HTML').toContain('Weeknight Pasta');
        // Each card still reserves the chip's box, so the figure arriving after hydration shifts nothing.
        expect(html).toContain('Loading calories');
        expect(batch).not.toHaveBeenCalled();
    });

    it('hydrates with no recoverable error, and starts the first page’s batch only once hydrated', async () => {
        const { client, batch } = twoPageClient();
        const container = document.createElement('div');
        container.innerHTML = renderToString(page(client, await prefetchedQueryClient(client)));
        document.body.append(container);
        const onRecoverableError = vi.fn();
        const hydratingClient = await prefetchedQueryClient(client);

        await act(async () => {
            hydrateRoot(container, page(client, hydratingClient), { onRecoverableError });
        });
        await settle();

        expect(onRecoverableError).not.toHaveBeenCalled();
        expect(batch).toHaveBeenCalledTimes(1);
        container.remove();
    });
});
