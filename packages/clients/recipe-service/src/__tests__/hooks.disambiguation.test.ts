// @vitest-environment jsdom
/**
 * Hook contract for the ingredient async-resolution hooks (T028/T029/T067 / data-model R5): `useIngredientStatus`
 * (the self-limiting poll) and the add-by hooks.
 *
 * **The poll's stop condition**, pinned adversarially: `useIngredientStatus` refetches WHILE `PENDING` and stops the
 * instant a non-`PENDING` state is seen. Proven both ways: a `PENDING → RESOLVED` transition keeps polling until it
 * resolves and then goes quiet, and an `UNRESOLVED` result is polled exactly ONCE (a mutation that changed the
 * predicate to "poll everything not RESOLVED" would spin forever on `UNRESOLVED` and redden this).
 *
 * Client transport is stubbed at the client method (see `utils/hookHarness.ts`); no network, no fake timers
 * for the query cache — the poll uses a short real interval so the stop condition is observed, not simulated.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, waitFor } from '@testing-library/react';

import { FoodResolutionStatus } from '@kitchensink/recipe-core';

import { NotFoundError, UnauthorizedError } from '../errors.js';
import {
    recipeServiceKeys,
    useAddIngredientByFood,
    useAddIngredientByFoodVariant,
    useAddIngredientByName,
    useIngredientStatus,
} from '../hooks.js';
import { makeIngredient } from '../__fixtures__/recipes.js';
import { cachedQueryKeys, makeGuardedClient, makeTestQueryClient, renderRecipeHook } from './utils/hookHarness.js';

/** Resolve after `ms` on the real clock — the poll cadence is real, so its stop condition is really observed. */
function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

const ID = 'ing_async';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('useIngredientStatus (poll)', () => {
    it('caches the refreshed ingredient under the literal status key', async () => {
        const client = makeGuardedClient();
        vi.spyOn(client, 'getIngredientStatus').mockResolvedValue(
            makeIngredient({ id: ID, foodResolutionStatus: FoodResolutionStatus.RESOLVED }),
        );

        const { result, queryClient } = renderRecipeHook(() => useIngredientStatus(ID), { client });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(cachedQueryKeys(queryClient)).toEqual([['recipe-service', 'ingredients', 'detail', ID, 'status']]);
    });

    it('stays idle and issues no request for an empty id', () => {
        const client = makeGuardedClient();
        const spy = vi.spyOn(client, 'getIngredientStatus');

        const { result } = renderRecipeHook(() => useIngredientStatus(''), { client });

        expect(result.current.fetchStatus).toBe('idle');
        expect(spy).not.toHaveBeenCalled();
    });

    it('keeps polling while PENDING, then STOPS once the food RESOLVES', async () => {
        const client = makeGuardedClient();
        const sequence = [FoodResolutionStatus.PENDING, FoodResolutionStatus.PENDING, FoodResolutionStatus.RESOLVED];
        let call = 0;
        const spy = vi.spyOn(client, 'getIngredientStatus').mockImplementation(async () => {
            const status = sequence[Math.min(call, sequence.length - 1)]!;
            call += 1;

            return makeIngredient({ id: ID, foodResolutionStatus: status });
        });

        const { result } = renderRecipeHook(() => useIngredientStatus(ID, { pollIntervalMs: 20 }), { client });

        // The poll must fire repeatedly through the PENDING ticks until it observes RESOLVED.
        await waitFor(() => expect(result.current.data?.foodResolutionStatus).toBe(FoodResolutionStatus.RESOLVED), {
            timeout: 2000,
        });
        expect(spy.mock.calls.length).toBeGreaterThanOrEqual(3);

        // Having RESOLVED, the interval predicate returns false — no further polling.
        const settledCalls = spy.mock.calls.length;
        await delay(120);
        expect(spy.mock.calls.length).toBe(settledCalls);
    });

    it('polls an UNRESOLVED food exactly ONCE — it is a stop state, not silently polled like PENDING', async () => {
        const client = makeGuardedClient();
        const spy = vi
            .spyOn(client, 'getIngredientStatus')
            .mockResolvedValue(makeIngredient({ id: ID, foodResolutionStatus: FoodResolutionStatus.UNRESOLVED }));

        const { result } = renderRecipeHook(() => useIngredientStatus(ID, { pollIntervalMs: 20 }), { client });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        // Give several poll windows the chance to (wrongly) fire.
        await delay(120);
        expect(spy).toHaveBeenCalledTimes(1);
    });

    it('propagates a client rejection as the typed error', async () => {
        const client = makeGuardedClient();
        vi.spyOn(client, 'getIngredientStatus').mockRejectedValue(new NotFoundError('Ingredient not found'));

        const { result } = renderRecipeHook(() => useIngredientStatus(ID), { client });

        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(result.current.error).toBeInstanceOf(NotFoundError);
    });
});

describe('useAddIngredientByName (the async-resolution vertical entry point)', () => {
    it('adds the food by name through the client and returns the non-terminal ingredient', async () => {
        const client = makeGuardedClient();
        const added = makeIngredient({ id: ID, foodResolutionStatus: FoodResolutionStatus.PENDING });
        const spy = vi.spyOn(client, 'addIngredientByName').mockResolvedValue(added);

        const { result } = renderRecipeHook(() => useAddIngredientByName(), { client });

        await act(async () => {
            await result.current.mutateAsync('Quinoa');
        });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        // Mutation guard: the add path must hit addIngredientByName (the /by-name async route), NOT
        // createIngredient (the freeform 201 create) — a regression to the freeform client method fails here.
        expect(spy).toHaveBeenCalledWith('Quinoa');
        expect(result.current.data).toEqual(added);
    });

    it('stales exactly the ingredient-search namespace on success — and nothing else', async () => {
        const client = makeGuardedClient();
        vi.spyOn(client, 'addIngredientByName').mockResolvedValue(
            makeIngredient({ id: ID, foodResolutionStatus: FoodResolutionStatus.PENDING }),
        );
        const queryClient = makeTestQueryClient();

        // A cached ingredient search badges foodResolutionStatus → it must go stale so the new/deduped row shows.
        queryClient.setQueryData(recipeServiceKeys.ingredientSearch('quin', 5), [makeIngredient({ id: ID })]);
        // Scope guards: a recipe list + a specific ingredient's status must NOT be touched by a catalog add.
        queryClient.setQueryData(recipeServiceKeys.recipeList({}), { data: [], page: 1, pageSize: 20, total: 0 });
        queryClient.setQueryData(recipeServiceKeys.ingredientStatus(ID), makeIngredient({ id: ID }));

        const { result } = renderRecipeHook(() => useAddIngredientByName(), { client, queryClient });

        await act(async () => {
            await result.current.mutateAsync('Quinoa');
        });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(queryClient.getQueryState(recipeServiceKeys.ingredientSearch('quin', 5))?.isInvalidated).toBe(true);
        expect(queryClient.getQueryState(recipeServiceKeys.recipeList({}))?.isInvalidated).toBe(false);
        expect(queryClient.getQueryState(recipeServiceKeys.ingredientStatus(ID))?.isInvalidated).toBe(false);
    });

    it('surfaces a rejection as the typed error and invalidates nothing', async () => {
        const client = makeGuardedClient();
        vi.spyOn(client, 'addIngredientByName').mockRejectedValue(new UnauthorizedError('Unauthorized'));
        const queryClient = makeTestQueryClient();
        queryClient.setQueryData(recipeServiceKeys.ingredientSearch('quin', 5), [makeIngredient({ id: ID })]);

        const { result } = renderRecipeHook(() => useAddIngredientByName(), { client, queryClient });

        await act(async () => {
            await expect(result.current.mutateAsync('Quinoa')).rejects.toBeInstanceOf(UnauthorizedError);
        });

        expect(queryClient.getQueryState(recipeServiceKeys.ingredientSearch('quin', 5))?.isInvalidated).toBe(false);
    });
});

describe('useAddIngredientByFoodVariant (curated U9 — the details dialog’s pick)', () => {
    it('binds the variant through the client and returns the ingredient with its root and parts', async () => {
        const client = makeGuardedClient();
        const flat = { id: '01J0VARIANT', parts: [{ attribute: 'cut', text: 'flat' }] };
        const bound = makeIngredient({ id: ID, foodId: '01J0ROOT', variant: flat });
        const byVariant = vi.spyOn(client, 'addIngredientByFoodVariant').mockResolvedValue(bound);
        const byFood = vi.spyOn(client, 'addIngredientByFood');

        const { result } = renderRecipeHook(() => useAddIngredientByFoodVariant(), { client });

        await act(async () => {
            await result.current.mutateAsync('01J0VARIANT');
        });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(byVariant).toHaveBeenCalledWith('01J0VARIANT');
        expect(byFood).not.toHaveBeenCalled();
        expect(result.current.data?.variant).toStrictEqual(flat);
    });
});

describe('useAddIngredientByFood (search Stage 2 — the catalog pick)', () => {
    const FOOD_ID = '01J0FOOD';

    it('admits the food through the client and returns an ingredient that ALREADY carries nutrition', async () => {
        const client = makeGuardedClient();
        const admitted = makeIngredient({
            id: ID,
            foodId: FOOD_ID,
            foodResolutionStatus: FoodResolutionStatus.RESOLVED,
            caloriesPer100g: 165,
        });
        const byFood = vi.spyOn(client, 'addIngredientByFood').mockResolvedValue(admitted);
        const byName = vi.spyOn(client, 'addIngredientByName');

        const { result } = renderRecipeHook(() => useAddIngredientByFood(), { client });

        await act(async () => {
            await result.current.mutateAsync(FOOD_ID);
        });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        // Mutation guard: the pick must go through the by-FOOD route. Falling back to by-name would
        // re-enter the async name fan-out (which can split UNRESOLVED) and lose the deterministic pick.
        expect(byFood).toHaveBeenCalledWith(FOOD_ID);
        expect(byName).not.toHaveBeenCalled();
        expect(result.current.data?.caloriesPer100g).toBe(165);
    });

    it('stales the cached ingredient search on success — the picked food now has a binding', async () => {
        const client = makeGuardedClient();
        vi.spyOn(client, 'addIngredientByFood').mockResolvedValue(
            makeIngredient({ id: ID, foodId: FOOD_ID, foodResolutionStatus: FoodResolutionStatus.RESOLVED }),
        );
        const queryClient = makeTestQueryClient();

        // The cached search renders the pre-pick world, where this food has no binding, so it must go stale.
        queryClient.setQueryData(recipeServiceKeys.ingredientSearch('chick', 5), []);
        // Scope guards: a catalog admit changes no recipe projection and no other ingredient's status.
        queryClient.setQueryData(recipeServiceKeys.recipeList({}), { data: [], page: 1, pageSize: 20, total: 0 });
        queryClient.setQueryData(recipeServiceKeys.ingredientStatus(ID), makeIngredient({ id: ID }));

        const { result } = renderRecipeHook(() => useAddIngredientByFood(), { client, queryClient });

        await act(async () => {
            await result.current.mutateAsync(FOOD_ID);
        });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(queryClient.getQueryState(recipeServiceKeys.ingredientSearch('chick', 5))?.isInvalidated).toBe(true);
        expect(queryClient.getQueryState(recipeServiceKeys.recipeList({}))?.isInvalidated).toBe(false);
        expect(queryClient.getQueryState(recipeServiceKeys.ingredientStatus(ID))?.isInvalidated).toBe(false);
    });

    it('surfaces a rejection as the typed error and invalidates nothing', async () => {
        const client = makeGuardedClient();
        vi.spyOn(client, 'addIngredientByFood').mockRejectedValue(new UnauthorizedError('Unauthorized'));
        const queryClient = makeTestQueryClient();
        queryClient.setQueryData(recipeServiceKeys.ingredientSearch('chick', 5), []);

        const { result } = renderRecipeHook(() => useAddIngredientByFood(), { client, queryClient });

        await act(async () => {
            await expect(result.current.mutateAsync(FOOD_ID)).rejects.toBeInstanceOf(UnauthorizedError);
        });

        expect(queryClient.getQueryState(recipeServiceKeys.ingredientSearch('chick', 5))?.isInvalidated).toBe(false);
    });
});
