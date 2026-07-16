// @vitest-environment jsdom
/**
 * Hook contract for the ingredient async-resolution hooks (T028/T029/T067 / data-model R5):
 * `useIngredientStatus` (the self-limiting poll), `useIngredientCandidates`, and `useResolveIngredient`.
 *
 * The three behaviours only these hooks own, each pinned adversarially:
 *
 * 1. **The poll's stop condition.** `useIngredientStatus` refetches WHILE `PENDING` and stops the instant a
 *    non-`PENDING` state is seen. Proven both ways: a `PENDING → RESOLVED` transition keeps polling until it
 *    resolves and then goes quiet, and an `UNRESOLVED` result is polled exactly ONCE (a mutation that changed
 *    the predicate to "poll everything not RESOLVED" would spin forever on `UNRESOLVED` and redden this).
 * 2. **The candidate query** caches under its literal key, gates on a non-empty id, and forwards the id.
 * 3. **The resolve invalidation.** On success it stales EXACTLY the ingredient's status, its candidate set,
 *    and the ingredient-search namespace — and nothing else — asserted as seeded probes flipping to
 *    `isInvalidated`.
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
    useAddIngredientByName,
    useIngredientCandidates,
    useIngredientStatus,
    useResolveIngredient,
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

describe('useIngredientCandidates', () => {
    it('caches the candidates under the literal candidates key and forwards the id', async () => {
        const client = makeGuardedClient();
        const candidates = [{ candidateId: 'c1', source: 'usda', externalKey: 'k1', name: 'Quinoa', summary: null }];
        const spy = vi.spyOn(client, 'getIngredientCandidates').mockResolvedValue(candidates);

        const { result, queryClient } = renderRecipeHook(() => useIngredientCandidates(ID), { client });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(spy).toHaveBeenCalledWith(ID);
        expect(result.current.data).toEqual(candidates);
        expect(cachedQueryKeys(queryClient)).toEqual([['recipe-service', 'ingredients', 'detail', ID, 'candidates']]);
    });

    it('stays idle for an empty id and when explicitly disabled', () => {
        const client = makeGuardedClient();
        const spy = vi.spyOn(client, 'getIngredientCandidates');

        const empty = renderRecipeHook(() => useIngredientCandidates(''), { client });
        expect(empty.result.current.fetchStatus).toBe('idle');

        const disabled = renderRecipeHook(() => useIngredientCandidates(ID, { enabled: false }), { client });
        expect(disabled.result.current.fetchStatus).toBe('idle');

        expect(spy).not.toHaveBeenCalled();
    });
});

describe('useResolveIngredient', () => {
    it('forwards the id + picked candidate ids to the client, in order', async () => {
        const client = makeGuardedClient();
        const spy = vi
            .spyOn(client, 'resolveIngredient')
            .mockResolvedValue(makeIngredient({ id: ID, foodResolutionStatus: FoodResolutionStatus.RESOLVED }));

        const { result } = renderRecipeHook(() => useResolveIngredient(), { client });

        await act(async () => {
            await result.current.mutateAsync({ id: ID, candidateIds: ['c2'] });
        });

        // Mutation guard: the EXACT id + pick must reach the client — a wrong candidate id fails here.
        expect(spy).toHaveBeenCalledWith(ID, ['c2']);
    });

    it('stales exactly the ingredient status, its candidates, and the ingredient-search namespace on success', async () => {
        const client = makeGuardedClient();
        vi.spyOn(client, 'resolveIngredient').mockResolvedValue(
            makeIngredient({ id: ID, foodResolutionStatus: FoodResolutionStatus.RESOLVED }),
        );
        const queryClient = makeTestQueryClient();

        // Seed probes at the literal keys the resolve should (and should not) touch.
        queryClient.setQueryData(recipeServiceKeys.ingredientStatus(ID), makeIngredient({ id: ID }));
        queryClient.setQueryData(recipeServiceKeys.ingredientCandidates(ID), []);
        queryClient.setQueryData(recipeServiceKeys.ingredientSearch('quin', 5), [makeIngredient({ id: ID })]);
        // A different ingredient's status must NOT be invalidated (the write is keyed to ID).
        queryClient.setQueryData(recipeServiceKeys.ingredientStatus('other'), makeIngredient({ id: 'other' }));

        const { result } = renderRecipeHook(() => useResolveIngredient(), { client, queryClient });

        await act(async () => {
            await result.current.mutateAsync({ id: ID, candidateIds: ['c1'] });
        });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(queryClient.getQueryState(recipeServiceKeys.ingredientStatus(ID))?.isInvalidated).toBe(true);
        expect(queryClient.getQueryState(recipeServiceKeys.ingredientCandidates(ID))?.isInvalidated).toBe(true);
        expect(queryClient.getQueryState(recipeServiceKeys.ingredientSearch('quin', 5))?.isInvalidated).toBe(true);
        // Scope guard: a sibling ingredient's status stays fresh.
        expect(queryClient.getQueryState(recipeServiceKeys.ingredientStatus('other'))?.isInvalidated).toBe(false);
    });

    it('surfaces a rejection as the typed error and invalidates nothing', async () => {
        const client = makeGuardedClient();
        vi.spyOn(client, 'resolveIngredient').mockRejectedValue(new UnauthorizedError('Unauthorized'));
        const queryClient = makeTestQueryClient();
        queryClient.setQueryData(recipeServiceKeys.ingredientStatus(ID), makeIngredient({ id: ID }));

        const { result } = renderRecipeHook(() => useResolveIngredient(), { client, queryClient });

        await act(async () => {
            await expect(result.current.mutateAsync({ id: ID, candidateIds: ['c1'] })).rejects.toBeInstanceOf(
                UnauthorizedError,
            );
        });

        expect(queryClient.getQueryState(recipeServiceKeys.ingredientStatus(ID))?.isInvalidated).toBe(false);
    });
});
