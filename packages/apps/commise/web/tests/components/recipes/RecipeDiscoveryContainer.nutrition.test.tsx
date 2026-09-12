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
import { act, cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import type { RecipeNutritionResponse } from '@kitchensink/schema-recipe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithRecipeClient } from '@commise/test-utils';

import { RecipeDiscoveryContainer } from '@/components/recipes/RecipeDiscoveryContainer';

import { makeRecipe } from './__fixtures__/recipeFixtures';

const { pushMock, replaceStateMock } = vi.hoisted(() => ({ pushMock: vi.fn(), replaceStateMock: vi.fn() }));

// The container reads its criteria from the URL and writes them back with the history API. A non-blank
// `query` is what puts the surface into its RESULT body — the default body is the curated browse rails.
vi.mock('next/navigation', () => ({
    useRouter: () => ({ push: pushMock }),
    usePathname: () => '/en/discover',
    useSearchParams: () => new URLSearchParams('query=pasta'),
}));

afterEach(() => {
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
