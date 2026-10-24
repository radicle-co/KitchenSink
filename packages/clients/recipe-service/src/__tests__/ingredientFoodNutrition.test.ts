// @vitest-environment jsdom
/**
 * The batch food nutrition read on the CLIENT side (plan 002 U9) — `getIngredientFoodNutrition`, the
 * `ingredientQueries().foodNutrition` read seam, and `useIngredientFoodNutrition`.
 *
 * The same three properties as the recipe nutrition batch, for the same reasons: the client declares no wire shape
 * (it validates with the zod `@kitchensink/schema-recipe` publishes), the whole call has a finite deadline, and the
 * cache key is canonical, so two surfaces asking for the same foods in a different order share one entry.
 */
import { act, cleanup, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MAX_FOOD_NUTRITION_REFS } from '@kitchensink/schema-recipe';

import { RecipeServiceClient } from '../index.js';
import { UnexpectedResponseError, isInvalidRequestError, type InvalidRequestError } from '../errors.js';
import { ingredientQueries, recipeServiceKeys } from '../queries.js';
import { useIngredientFoodNutrition } from '../hooks.js';
import { requestAt, stubFetch } from './utils/fetchDouble.js';
import { cachedQueryKeys, makeGuardedClient, renderRecipeHook } from './utils/hookHarness.js';

const BASE = 'https://recipes.example.test';
const ROOT = { kind: 'root', id: 'f1' } as const;
const VARIANT = { kind: 'variant', id: 'v1' } as const;

/** A well-formed response: one found, one absent. */
const BODY = {
    entries: [
        { outcome: 'found', ref: ROOT, freshness: 'fresh', caloriesPer100g: 52, portions: [] },
        { outcome: 'absent', ref: VARIANT },
    ],
};

function makeClient(fetchMock: typeof fetch): RecipeServiceClient {
    return new RecipeServiceClient({ baseUrl: BASE, token: 'tok', fetch: fetchMock });
}

describe('RecipeServiceClient.getIngredientFoodNutrition', () => {
    it('POSTs the refs to /api/v1/ingredients/food-nutrition and returns the parsed entries', async () => {
        const fetchMock = stubFetch(200, BODY);

        const result = await makeClient(fetchMock).getIngredientFoodNutrition([ROOT, VARIANT]);
        const request = requestAt(fetchMock);

        expect(request.method).toBe('POST');
        expect(request.url).toBe(`${BASE}/api/v1/ingredients/food-nutrition`);
        expect(JSON.parse(request.body as string)).toStrictEqual({ refs: [ROOT, VARIANT] });
        expect(result).toStrictEqual(BODY);
    });

    it('⛔ PARSES the response with the published zod, so a found entry with no freshness fails at the boundary', async () => {
        const fetchMock = stubFetch(200, { entries: [{ outcome: 'found', ref: ROOT, portions: [] }] });

        await expect(makeClient(fetchMock).getIngredientFoodNutrition([ROOT])).rejects.toThrow();
    });

    it.each([
        ['an empty list', []],
        [
            'an over-cap list',
            Array.from({ length: MAX_FOOD_NUTRITION_REFS + 1 }, (_, index) => ({ kind: 'root', id: `f${index}` })),
        ],
    ])('⛔ refuses to SEND %s, naming the field, rather than paying a round trip for the 400', async (_, refs) => {
        const fetchMock = stubFetch(200, BODY);

        const failure = await makeClient(fetchMock)
            .getIngredientFoodNutrition(refs as never)
            .catch((error: unknown) => error);

        expect(isInvalidRequestError(failure)).toBe(true);
        expect(JSON.stringify((failure as InvalidRequestError).cause)).toContain('refs');
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe('ingredientQueries().foodNutrition — the read seam', () => {
    function fakeClient(getIngredientFoodNutrition: unknown): RecipeServiceClient {
        return { getIngredientFoodNutrition } as never;
    }

    it('⛔ CANONICALIZES the key: order and repeats do not make a second cache entry', () => {
        expect(recipeServiceKeys.ingredientFoodNutrition([VARIANT, ROOT, ROOT])).toStrictEqual(
            recipeServiceKeys.ingredientFoodNutrition([ROOT, VARIANT]),
        );
        // Positive control: a different ref is a different entry, and the kind is part of the identity.
        expect(recipeServiceKeys.ingredientFoodNutrition([ROOT])).not.toStrictEqual(
            recipeServiceKeys.ingredientFoodNutrition([{ kind: 'variant', id: 'f1' }]),
        );
    });

    it('keys the read under that canonical key', () => {
        const options = ingredientQueries(fakeClient(vi.fn())).foodNutrition([ROOT]);

        expect(options.queryKey).toStrictEqual(recipeServiceKeys.ingredientFoodNutrition([ROOT]));
    });

    it('⛔ bounds the whole call with a finite deadline, not just one attempt', async () => {
        const getIngredientFoodNutrition = vi.fn().mockResolvedValue(BODY);
        const options = ingredientQueries(fakeClient(getIngredientFoodNutrition)).foodNutrition([ROOT]);
        const querySignal = new AbortController().signal;

        await options.queryFn?.({ signal: querySignal } as never);

        const passed = getIngredientFoodNutrition.mock.calls[0]?.[1] as { signal?: AbortSignal } | undefined;

        expect(getIngredientFoodNutrition.mock.calls[0]?.[0]).toStrictEqual([ROOT]);
        expect(passed?.signal).toBeInstanceOf(AbortSignal);
        expect(passed?.signal).not.toBe(querySignal);
    });

    it('⛔ SENDS the canonical refs the key names, so a shared cache entry has one order for every caller', async () => {
        // The response is in order of first appearance. Sent as given, two callers asking for the same foods in a
        // different order would share one entry ordered for whoever fetched first.
        const getIngredientFoodNutrition = vi.fn().mockResolvedValue(BODY);
        const options = ingredientQueries(fakeClient(getIngredientFoodNutrition)).foodNutrition([
            VARIANT,
            ROOT,
            VARIANT,
        ]);

        await options.queryFn?.({ signal: new AbortController().signal } as never);

        expect(getIngredientFoodNutrition.mock.calls[0]?.[0]).toStrictEqual([ROOT, VARIANT]);
        expect(options.queryKey[3]).toStrictEqual(['root:f1', 'variant:v1']);
    });

    it('retries once for a failure worth repeating, and never for a 400', () => {
        const retry = ingredientQueries(fakeClient(vi.fn())).foodNutrition([ROOT]).retry as (
            count: number,
            error: Error,
        ) => boolean;

        expect([0, 1, 2].filter((count) => retry(count, new UnexpectedResponseError(503)))).toStrictEqual([0]);
        expect(retry(0, new UnexpectedResponseError(400))).toBe(false);
    });

    it('is DISABLED for an empty list — the service rejects it', () => {
        expect(ingredientQueries(fakeClient(vi.fn())).foodNutrition([]).enabled).toBe(false);
        expect(ingredientQueries(fakeClient(vi.fn())).foodNutrition([ROOT]).enabled).toBe(true);
    });

    it('carries an explicit stale policy rather than the library default', () => {
        expect(ingredientQueries(fakeClient(vi.fn())).foodNutrition([ROOT]).staleTime).toBeTypeOf('number');
    });
});

describe('useIngredientFoodNutrition', () => {
    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    function clientReturning(result: Promise<unknown>): RecipeServiceClient {
        const client = makeGuardedClient();
        vi.spyOn(client, 'getIngredientFoodNutrition').mockReturnValue(result as never);

        return client;
    }

    it('resolves the entries for the requested refs, under the canonical key', async () => {
        const client = clientReturning(Promise.resolve(BODY));
        const { result, queryClient } = renderRecipeHook(() => useIngredientFoodNutrition([VARIANT, ROOT]), {
            client,
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data).toStrictEqual(BODY);
        expect(cachedQueryKeys(queryClient)).toContainEqual(recipeServiceKeys.ingredientFoodNutrition([ROOT, VARIANT]));
    });

    it('⛔ REACHES an error state when the read fails, so a caller can show the numbers as unavailable', async () => {
        const client = clientReturning(Promise.reject(new Error('recipe service down')));
        const { result } = renderRecipeHook(() => useIngredientFoodNutrition([ROOT]), { client });

        await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 5000 });
    });

    /**
     * Plan 002 V1 B5: the editor reads ONE batch for every line, so adding a line changes the refs. Without the
     * previous answer kept on screen, every add would blank the running total until the new read lands.
     */
    it('keepPreviousData: a new ref list keeps the previous answer on screen, marked as a placeholder', async () => {
        const client = makeGuardedClient();
        vi.spyOn(client, 'getIngredientFoodNutrition')
            .mockReturnValueOnce(Promise.resolve(BODY) as never)
            .mockReturnValueOnce(new Promise(() => undefined) as never);
        let setRefs: (refs: readonly (typeof ROOT | typeof VARIANT)[]) => void = () => undefined;
        const { result } = renderRecipeHook(
            () => {
                const [refs, set] = useState<readonly (typeof ROOT | typeof VARIANT)[]>([ROOT]);
                setRefs = set;

                return useIngredientFoodNutrition([...refs], { keepPreviousData: true });
            },
            { client },
        );
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        act(() => {
            setRefs([ROOT, VARIANT]);
        });

        await waitFor(() => expect(client.getIngredientFoodNutrition).toHaveBeenCalledTimes(2));
        expect(result.current.data).toStrictEqual(BODY);
        expect(result.current.isPlaceholderData).toBe(true);
    });

    it('does not fetch for an empty list, or behind an explicit enabled: false', async () => {
        const client = clientReturning(Promise.resolve(BODY));
        const empty = renderRecipeHook(() => useIngredientFoodNutrition([]), { client });
        const gated = renderRecipeHook(() => useIngredientFoodNutrition([ROOT], { enabled: false }), { client });

        await waitFor(() => expect(empty.result.current.fetchStatus).toBe('idle'));
        await waitFor(() => expect(gated.result.current.fetchStatus).toBe('idle'));
        expect(client.getIngredientFoodNutrition).not.toHaveBeenCalled();
    });
});
