// @vitest-environment jsdom
/**
 * The collection-detail container's half of the deferred calorie lookup.
 *
 * This surface has NO server prefetch and, more importantly, it RETURNS EARLY: loading, generic error and
 * not-found are all rendered before the member list exists. So the lookup hook has to sit ABOVE those
 * returns, which makes the interesting failure a Rules-of-Hooks one — a hook called only on the ready path
 * throws "rendered more hooks than during the previous render" the moment a refetch flips the branch, and
 * the whole surface crashes rather than the figure being missing. The first test here is what catches that:
 * it renders while the collection is still loading, then lets it arrive.
 *
 * ⚠️ SUSPENSE CONVENTION (`src/components/home/__tests__/RecipeWidgetSlot.test.tsx:11-22`): settle with
 * `await act(...)`, never `findBy`/`waitFor`.
 */
import { act, cleanup, screen } from '@testing-library/react';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import type { RecipeNutritionResponse } from '@kitchensink/schema-recipe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithRecipeClient } from '@commise/test-utils';

import { CollectionDetailContainer } from '@/components/recipes/CollectionDetailContainer';

import { makeCollectionWithRecipes } from './__fixtures__/collectionFixtures';
import { makeRecipe } from './__fixtures__/recipeFixtures';

const { pushMock, useAuthMock, useUserProfileMock } = vi.hoisted(() => ({
    pushMock: vi.fn(),
    useAuthMock: vi.fn(),
    useUserProfileMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }));
vi.mock('@clerk/nextjs', () => ({ useAuth: useAuthMock }));
vi.mock('@/hooks/useUserProfile', () => ({ useUserProfile: useUserProfileMock }));

const MEMBER = '00000000-0000-4000-8000-00000000000a';

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

const NUTRITION: RecipeNutritionResponse = { nutrition: { [MEMBER]: known(420) } };

beforeEach(() => {
    useAuthMock.mockReturnValue({ sessionClaims: { external_id: 'usr_1' } });
    useUserProfileMock.mockReturnValue({ data: { account: { subscriptionTier: 'premium' } } });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.clearAllMocks();
});

const collection = () =>
    makeCollectionWithRecipes({
        id: 'col_1',
        name: 'Weeknights',
        recipes: [{ ...makeRecipe({ id: MEMBER, title: 'Weeknight Pasta' }), addedVia: 'manual' }],
    });

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

describe('CollectionDetailContainer — the deferred calorie lookup', () => {
    // ⛔ THE HOOK-ORDER CASE. Mounting on the LOADING branch and then letting the collection arrive is the
    // only way to exercise a hook that was placed after the early returns.
    it('survives the loading → ready transition and then shows the member’s figure', async () => {
        const client = createFakeRecipeServiceClient();
        let resolveCollection: ((value: ReturnType<typeof collection>) => void) | undefined;
        vi.spyOn(client, 'getCollectionById').mockReturnValue(
            new Promise((resolve) => {
                resolveCollection = resolve;
            }),
        );
        vi.spyOn(client, 'getRecipeNutrition').mockResolvedValue(NUTRITION);

        renderWithRecipeClient(<CollectionDetailContainer id="col_1" locale="en" />, client);
        await settle();
        expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument();

        await act(async () => {
            resolveCollection?.(collection());
        });
        await settle();

        expect(screen.getByRole('img', { name: '420 cal' })).toBeInTheDocument();
    });

    it('issues ONE batch covering the collection’s members', async () => {
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'getCollectionById').mockResolvedValue(collection());
        const batch = vi.spyOn(client, 'getRecipeNutrition').mockResolvedValue(NUTRITION);

        renderWithRecipeClient(<CollectionDetailContainer id="col_1" locale="en" />, client);
        await settle();

        expect(batch).toHaveBeenCalledTimes(1);
        expect(batch.mock.calls[0]?.[0]).toStrictEqual([MEMBER]);
    });

    it('shows a calorie skeleton on the member row while the batch is in flight', async () => {
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'getCollectionById').mockResolvedValue(collection());
        vi.spyOn(client, 'getRecipeNutrition').mockReturnValue(new Promise<RecipeNutritionResponse>(() => undefined));

        renderWithRecipeClient(<CollectionDetailContainer id="col_1" locale="en" />, client);
        await settle();

        expect(screen.getByText('Loading calories')).toBeInTheDocument();
    });

    it('renders the member row with no figure and no spinner when the batch fails', async () => {
        vi.useFakeTimers();

        try {
            const client = createFakeRecipeServiceClient();
            vi.spyOn(client, 'getCollectionById').mockResolvedValue(collection());
            vi.spyOn(client, 'getRecipeNutrition').mockRejectedValue(new Error('food service unavailable'));

            renderWithRecipeClient(<CollectionDetailContainer id="col_1" locale="en" />, client);
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

    it('asks for nothing when the collection has no members', async () => {
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'getCollectionById').mockResolvedValue(
            makeCollectionWithRecipes({ id: 'col_1', name: 'Weeknights', recipes: [] }),
        );
        const batch = vi.spyOn(client, 'getRecipeNutrition');

        renderWithRecipeClient(<CollectionDetailContainer id="col_1" locale="en" />, client);
        await settle();

        expect(batch, 'an empty batch is a guaranteed 400 — it must never be sent').not.toHaveBeenCalled();
    });
});
