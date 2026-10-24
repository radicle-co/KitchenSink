// @vitest-environment jsdom
/**
 * Unit tests for `useAmbiguityPick`, the recipe detail's ambiguity review command. A pick re-points ONE stored line
 * through the rebind command (owner ruling 2026-10-02, "Fix one line at a time"; `docs/design/rowEditorBlueprint.md`
 * decision 7).
 *
 * What must hold:
 * - a pick sends one rebind, for the line it was made on, at the version the surface read;
 * - picks are serialised across rows, because every pick edits the same version;
 * - a taken pick names its line and counts once; a refused one names its line and counts nothing;
 * - a version conflict asks for the recipe again, so the next pick sends the version the recipe has now;
 * - a remote food is adopted first, and its root then re-points the line, as ONE pick (ADR-0055 point 10, S7 list
 *   contract P8 and P12); each of the adopt's refusals names its line and how it ended, and the cook's own limit stops
 *   a remote pick before it asks.
 *
 * The REAL client hooks run over TanStack Query and network-guarded clients whose methods are stubbed.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RecipeDetail } from '@kitchensink/recipe-core';
import { makeRecipeDetail } from '@kitchensink/recipe-core/testing';
import { recipeServiceKeys, VersionConflictError } from '@kitchensink/recipe-service-client';
import { RecipeServiceProvider } from '@kitchensink/recipe-service-client/hooks';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import {
    FoodServiceClient,
    RemoteFoodGoneError,
    RequesterLimitReachedError,
    SourceBusyError,
} from '@kitchensink/food-service-client';
import { FoodServiceProvider } from '@kitchensink/food-service-client/hooks';

import type { RemoteFoodPick } from '../lineCommit.js';
import { useAmbiguityPick } from '../useAmbiguityPick.js';

const RECIPE_ID = '00000000-0000-4000-8000-00000000a001';
const RECIPE = makeRecipeDetail({ id: RECIPE_ID, currentVersion: 7 });

/** A rebind the test settles when it chooses. */
function heldRebind() {
    let settle: { resolve: (detail: RecipeDetail) => void; reject: (error: unknown) => void } | undefined;
    const answer = new Promise<RecipeDetail>((resolve, reject) => {
        settle = { resolve, reject };
    });

    return {
        answer,
        resolve: async (detail: RecipeDetail): Promise<void> => {
            await act(async () => {
                settle?.resolve(detail);
                await answer;
            });
        },
        reject: async (error: unknown): Promise<void> => {
            await act(async () => {
                settle?.reject(error);
                await answer.catch(() => undefined);
            });
        },
    };
}

function harness(recipe: Pick<RecipeDetail, 'id' | 'currentVersion'> = RECIPE) {
    const client = createFakeRecipeServiceClient();
    const food = new FoodServiceClient({
        baseUrl: 'https://food.test',
        fetch: () => Promise.reject(new Error('unstubbed network call')),
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const rebind = vi.spyOn(client, 'rebindIngredientLine');
    const adopt = vi.spyOn(food, 'adoptRemoteFood');
    const wrapper = ({ children }: { readonly children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>
            <RecipeServiceProvider client={client}>
                <FoodServiceProvider client={food} subject="user_1">
                    {children}
                </FoodServiceProvider>
            </RecipeServiceProvider>
        </QueryClientProvider>
    );

    return { queryClient, rebind, adopt, ...renderHook(() => useAmbiguityPick(recipe), { wrapper }) };
}

/** A pick of a root of our catalog. */
const root = (foodId: string) => ({ kind: 'catalogFood', foodId }) as const;

const STEWED: RemoteFoodPick = { kind: 'remoteFood', reference: 'sealed.s', name: 'Apples, stewed', source: 'usda' };

afterEach(() => {
    vi.restoreAllMocks();
});

describe('useAmbiguityPick', () => {
    it.each([
        { position: 0, foodId: 'food_canned' },
        { position: 3, foodId: 'food_homemade' },
    ])(
        'a pick at position $position sends ONE rebind for that line, at the version read, naming the food',
        async ({ position, foodId }) => {
            const { result, rebind } = harness();

            rebind.mockReturnValue(heldRebind().answer);
            act(() => result.current.pick(position, root(foodId)));

            await waitFor(() => expect(rebind).toHaveBeenCalledTimes(1));
            expect(rebind).toHaveBeenCalledWith(RECIPE_ID, position, {
                expectedVersion: 7,
                target: { kind: 'catalogFood', foodId },
            });
        },
    );

    it('⛔ while a pick is in flight every pick is refused — each pick edits the same version', async () => {
        const { result, rebind } = harness();
        const held = heldRebind();

        rebind.mockReturnValue(held.answer);
        act(() => result.current.pick(1, root('food_canned')));
        await waitFor(() => expect(result.current.picking).toBe(true));
        act(() => result.current.pick(2, root('food_canned')));
        act(() => result.current.pick(1, root('food_homemade')));
        // Settle the first, so any pick that was not refused has had every chance to reach the client.
        await held.resolve(makeRecipeDetail({ id: RECIPE_ID, currentVersion: 8 }));
        await waitFor(() => expect(result.current.picking).toBe(false));

        expect(rebind).toHaveBeenCalledTimes(1);
        expect(result.current.takenAt).toBe(1);
    });

    it('a pick the recipe takes names THAT line, and counts once per taken pick', async () => {
        const { result, rebind } = harness();
        const first = heldRebind();
        const second = heldRebind();

        expect(result.current).toMatchObject({ picking: false, takenAt: undefined, saves: 0, failedAt: undefined });

        rebind.mockReturnValueOnce(first.answer).mockReturnValueOnce(second.answer);
        act(() => result.current.pick(1, root('food_canned')));
        await waitFor(() => expect(rebind).toHaveBeenCalledTimes(1));
        await first.resolve(makeRecipeDetail({ id: RECIPE_ID, currentVersion: 8 }));

        expect(result.current).toMatchObject({ picking: false, takenAt: 1, saves: 1, failedAt: undefined });

        act(() => result.current.pick(2, root('food_canned')));
        await waitFor(() => expect(rebind).toHaveBeenCalledTimes(2));
        expect(result.current.takenAt).toBeUndefined();
        await second.resolve(makeRecipeDetail({ id: RECIPE_ID, currentVersion: 9 }));

        expect(result.current).toMatchObject({ takenAt: 2, saves: 2 });
    });

    it('a pick the recipe refuses names THAT line, and counts nothing', async () => {
        const { result, rebind } = harness();
        const held = heldRebind();

        rebind.mockReturnValue(held.answer);
        act(() => result.current.pick(2, root('food_canned')));
        await waitFor(() => expect(rebind).toHaveBeenCalledTimes(1));
        await held.reject(new Error('refused'));

        await waitFor(() => expect(result.current.failedAt).toBe(2));
        expect(result.current).toMatchObject({ picking: false, takenAt: undefined, saves: 0 });
    });

    it('⛔ a version conflict marks the recipe read stale, so the next pick sends the version it has now', async () => {
        const { result, rebind, queryClient } = harness();
        const held = heldRebind();

        queryClient.setQueryData(recipeServiceKeys.recipe(RECIPE_ID), RECIPE);
        rebind.mockReturnValue(held.answer);
        act(() => result.current.pick(1, root('food_canned')));
        await waitFor(() => expect(rebind).toHaveBeenCalledTimes(1));
        await held.reject(new VersionConflictError(8, 7));

        await waitFor(() => expect(result.current.failedAt).toBe(1));
        expect(queryClient.getQueryState(recipeServiceKeys.recipe(RECIPE_ID))?.isInvalidated).toBe(true);
    });

    it('any other refusal leaves the recipe read alone: nothing about the version was learned', async () => {
        const { result, rebind, queryClient } = harness();
        const held = heldRebind();

        queryClient.setQueryData(recipeServiceKeys.recipe(RECIPE_ID), RECIPE);
        rebind.mockReturnValue(held.answer);
        act(() => result.current.pick(1, root('food_canned')));
        await waitFor(() => expect(rebind).toHaveBeenCalledTimes(1));
        await held.reject(new Error('refused'));

        await waitFor(() => expect(result.current.failedAt).toBe(1));
        expect(queryClient.getQueryState(recipeServiceKeys.recipe(RECIPE_ID))?.isInvalidated).toBe(false);
    });
});

describe('useAmbiguityPick — a remote food (ADR-0055 point 10; S7 list contract P8, P12)', () => {
    it('adopts the hit, then re-points THAT line to the root it became, at the version read', async () => {
        const { result, rebind, adopt } = harness();

        adopt.mockResolvedValue({ id: 'food_stewed' });
        rebind.mockReturnValue(heldRebind().answer);
        act(() => result.current.pick(2, STEWED));

        await waitFor(() => expect(rebind).toHaveBeenCalledTimes(1));
        expect(adopt).toHaveBeenCalledWith('sealed.s');
        expect(rebind).toHaveBeenCalledWith(RECIPE_ID, 2, {
            expectedVersion: 7,
            target: { kind: 'catalogFood', foodId: 'food_stewed' },
        });
    });

    // V3-9: the row a remote pick was made on says it is adding from that source, for as long as the pick runs.
    it('names the remote pick in flight, its line and its food, through the adopt and the re-point, and then none', async () => {
        const { result, rebind, adopt } = harness();
        const rebound = heldRebind();
        let adopted: (root: { readonly id: string }) => void = () => undefined;

        adopt.mockReturnValue(
            new Promise((resolve) => {
                adopted = resolve;
            }),
        );
        rebind.mockReturnValue(rebound.answer);
        expect(result.current.adding).toBeUndefined();
        act(() => result.current.pick(2, STEWED));

        await waitFor(() => expect(result.current.adding).toEqual({ position: 2, pick: STEWED }));
        await act(async () => {
            adopted({ id: 'food_stewed' });
        });
        await waitFor(() => expect(rebind).toHaveBeenCalledTimes(1));
        expect(result.current.adding).toEqual({ position: 2, pick: STEWED });

        await rebound.resolve(RECIPE);
        await waitFor(() => expect(result.current.adding).toBeUndefined());
    });

    it('names no remote pick once the adopt refused it, nor for a pick of our own catalog made after it', async () => {
        const { result, rebind, adopt } = harness();

        adopt.mockRejectedValue(new RemoteFoodGoneError('gone'));
        act(() => result.current.pick(2, STEWED));
        await waitFor(() => expect(result.current.failedAt).toBe(2));
        expect(result.current.adding).toBeUndefined();

        rebind.mockReturnValue(heldRebind().answer);
        act(() => result.current.pick(0, root('food_canned')));
        await waitFor(() => expect(result.current.picking).toBe(true));
        expect(result.current.adding).toBeUndefined();
    });

    it('reads picking from the adopt on, so every candidate is busy until the line is re-pointed', async () => {
        const { result, adopt } = harness();

        adopt.mockReturnValue(new Promise(() => undefined));
        act(() => result.current.pick(2, STEWED));

        await waitFor(() => expect(result.current.picking).toBe(true));
    });

    it.each<[string, unknown, unknown]>([
        ['food refused the item', new RemoteFoodGoneError('gone'), { kind: 'remoteGone' }],
        ['the source is busy', new SourceBusyError(2), { kind: 'sourceBusy' }],
        ['nothing answered', new Error('down'), { kind: 'failed' }],
    ])('names THAT line and how the pick ended when %s, and re-points nothing', async (_case, refusal, outcome) => {
        const { result, rebind, adopt } = harness();

        adopt.mockRejectedValue(refusal);
        act(() => result.current.pick(2, STEWED));

        await waitFor(() => expect(result.current.failure).toEqual({ position: 2, pick: STEWED, outcome }));
        expect(result.current.failedAt).toBe(2);
        expect(rebind).not.toHaveBeenCalled();
    });

    // P8: "The cached answer for this text is dropped, so the list asks again."
    it('tells the row its hit is gone, so the row asks its search again', async () => {
        const { result, adopt } = harness();
        const onGone = vi.fn();

        adopt.mockRejectedValue(new RemoteFoodGoneError('gone'));
        act(() => result.current.pick(2, STEWED, onGone));

        await waitFor(() => expect(onGone).toHaveBeenCalledTimes(1));
    });

    it('holds the cook’s limit when the adopt is refused for it, then refuses every remote pick before asking', async () => {
        const { result, adopt } = harness();

        adopt.mockRejectedValue(new RequesterLimitReachedError(600));
        act(() => result.current.pick(2, STEWED));
        await waitFor(() => expect(result.current.failure?.outcome.kind).toBe('limited'));

        act(() => result.current.pick(3, STEWED));
        act(() => result.current.pick(3, STEWED));

        expect(adopt).toHaveBeenCalledTimes(1);
        expect(result.current.failure).toMatchObject({ position: 3, outcome: { kind: 'limited' } });
        expect(result.current.limitRefusals).toBe(2);
    });

    it('still re-points a line to a root of our catalog while the limit stands: it spends no lookup', async () => {
        const { result, rebind, adopt } = harness();

        adopt.mockRejectedValue(new RequesterLimitReachedError(600));
        act(() => result.current.pick(2, STEWED));
        await waitFor(() => expect(result.current.failure?.outcome.kind).toBe('limited'));
        rebind.mockReturnValue(heldRebind().answer);
        act(() => result.current.pick(2, root('food_canned')));

        await waitFor(() => expect(rebind).toHaveBeenCalledTimes(1));
    });
});
