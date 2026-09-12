// @vitest-environment jsdom
/**
 * The recipe-list container's half of the deferred calorie lookup: it turns "these recipes are on screen"
 * into ONE nutrition batch and hands every card a slot over that one promise.
 *
 * Three failures this pins, all of which render plausibly and none of which a per-card test can see:
 *
 *  1. **N requests instead of one.** Deriving a promise per card passes every visual assertion and issues one
 *     POST per card — twenty round trips for a twenty-card page, against an endpoint whose whole point is
 *     that it is a batch.
 *  2. **Re-batching on a keystroke.** The container filters the loaded page CLIENT-side (search box + facet
 *     chips). Wiring the lookup to the FILTERED rows re-batches on every keystroke and every chip press —
 *     the visible symptom being every chip on screen flicking back to a skeleton as you type.
 *  3. **A blank figure where a skeleton belongs.** A card whose id the container never asked about renders
 *     nothing at all, which is indistinguishable from an honest "no figure" — so the request must cover the
 *     page the query actually loaded.
 *
 * ⚠️ SUSPENSE CONVENTION (`src/components/home/__tests__/RecipeWidgetSlot.test.tsx:11-22`): resolve a
 * Suspense with `await act(...)`, never `findBy`/`waitFor` — polling wedges the retry in a Vitest worker.
 */
import { act, cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import type { RecipeNutritionResponse } from '@kitchensink/schema-recipe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithRecipeClient } from '@commise/test-utils';

import { RecipeListContainer } from '@/components/recipes/RecipeListContainer';

import { makeRecipe, makeRecipesPage } from './__fixtures__/recipeFixtures';

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }));

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.clearAllMocks();
});

beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

// Real UUIDs: the batch request is validated against the published zod before it leaves the client, so a
// `rec_1`-style id would be rejected at the boundary rather than reaching the assertion.
const PASTA = '00000000-0000-4000-8000-00000000000a';
const ROAST = '00000000-0000-4000-8000-00000000000b';

const PAGE = makeRecipesPage([
    makeRecipe({ id: PASTA, title: 'Weeknight Pasta' }),
    makeRecipe({ id: ROAST, title: 'Sunday Roast' }),
]);

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
    nutrition: {
        [PASTA]: known(420),
        [ROAST]: { state: 'unaccounted', reason: 'no_resolved_ingredients' },
    },
};

/** A client whose list resolves the fixture page and whose nutrition batch is a spy under test. */
function clientWithNutrition(nutrition: () => Promise<RecipeNutritionResponse>) {
    const client = createFakeRecipeServiceClient();
    vi.spyOn(client, 'listRecipes').mockResolvedValue(PAGE);
    const batch = vi.spyOn(client, 'getRecipeNutrition').mockImplementation(nutrition);

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

const renderList = async (client: ReturnType<typeof clientWithNutrition>['client']) => {
    renderWithRecipeClient(<RecipeListContainer locale="en" />, client);
    await settle();
};

describe('RecipeListContainer — the deferred calorie lookup', () => {
    it('issues ONE batch request for the whole page, not one per card', async () => {
        const { client, batch } = clientWithNutrition(async () => NUTRITION);

        await renderList(client);

        expect(batch, 'a page of N cards is ONE read').toHaveBeenCalledTimes(1);
        expect(batch.mock.calls[0]?.[0], 'the request covers every recipe the page loaded').toStrictEqual([
            PASTA,
            ROAST,
        ]);
    });

    it('shows a calorie SKELETON on every card while the batch is in flight', async () => {
        const { client } = clientWithNutrition(() => new Promise<RecipeNutritionResponse>(() => undefined));

        await renderList(client);

        expect(screen.getAllByRole('button', { name: 'Weeknight Pasta' })).toHaveLength(1);
        expect(screen.getAllByText('Loading calories')).toHaveLength(2);
    });

    it('shows the figure on the card that has one, and NOTHING on the card that does not', async () => {
        const { client } = clientWithNutrition(async () => NUTRITION);

        await renderList(client);

        expect(screen.getByRole('img', { name: '420 cal' })).toBeInTheDocument();
        // `unaccounted` is a terminal answer with no figure — the card's absent-value rule, never a spinner.
        expect(screen.queryAllByText('Loading calories')).toHaveLength(0);
        expect(screen.queryAllByRole('img', { name: /cal/u })).toHaveLength(1);
    });

    // ⛔ THE INVARIANT, end to end. Note the FAKE TIMERS: the read seam sets `retry: 1` (its own option, which
    // a test `QueryClient`'s `retry: false` default does NOT override), so a failed batch is retried behind
    // TanStack's ~1s backoff before it settles. Draining that with a real wait would be a one-second test; not
    // draining it at all would assert the skeleton is gone at a moment when it legitimately is not, and then
    // "pass" for the wrong reason the day the retry is removed.
    it('renders every card WITHOUT a figure or a spinner once a REJECTED batch has exhausted its retry', async () => {
        vi.useFakeTimers();

        try {
            const { client, batch } = clientWithNutrition(async () => {
                throw new Error('food service unavailable');
            });

            renderWithRecipeClient(<RecipeListContainer locale="en" />, client);
            await act(async () => {
                await vi.advanceTimersByTimeAsync(5_000);
            });

            expect(batch, 'the batch was attempted, then retried once').toHaveBeenCalledTimes(2);
            expect(screen.getByRole('button', { name: 'Weeknight Pasta' })).toBeInTheDocument();
            expect(screen.queryByText('Loading calories'), 'a failed batch must not leave a spinner').toBeNull();
            expect(screen.queryByRole('img', { name: /cal/u })).toBeNull();
        } finally {
            vi.useRealTimers();
        }
    });

    // ⛔ The keystroke case. Filtering is a VIEW concern over an already-loaded page; the read is the page.
    it('does NOT re-batch when the viewer narrows the list by typing', async () => {
        const user = userEvent.setup();
        const { client, batch } = clientWithNutrition(async () => NUTRITION);

        await renderList(client);
        expect(batch).toHaveBeenCalledTimes(1);

        await act(async () => {
            await user.type(screen.getByRole('searchbox', { name: 'Search recipes' }), 'pasta');
        });

        expect(screen.queryByRole('button', { name: 'Sunday Roast' }), 'the filter did apply').toBeNull();
        expect(batch, 'filtering the loaded page is not a new read').toHaveBeenCalledTimes(1);
        // And the surviving card keeps its settled figure rather than blinking back to a skeleton.
        expect(screen.getByRole('img', { name: '420 cal' })).toBeInTheDocument();
        expect(screen.queryByText('Loading calories')).toBeNull();
    });

    it('asks for nothing at all when the viewer has no recipes', async () => {
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'listRecipes').mockResolvedValue(makeRecipesPage([]));
        const batch = vi.spyOn(client, 'getRecipeNutrition');

        renderWithRecipeClient(<RecipeListContainer locale="en" />, client);
        await settle();

        expect(screen.getByText('No recipes yet')).toBeInTheDocument();
        expect(batch, 'an empty batch is a guaranteed 400 — it must never be sent').not.toHaveBeenCalled();
    });
});
