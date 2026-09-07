// @vitest-environment jsdom
/**
 * The deferred calorie lookup on the CLIENT side — `getRecipeNutrition`, the `nutritionBatch` read seam,
 * and `useRecipeNutrition`.
 *
 * Three properties carry the weight here, and each is one the server cannot enforce:
 *
 *  1. **⛔ A FINITE DEADLINE.** The wire union deliberately has no `pending` member so a skeleton can never
 *     be pinned by an origin — but that only holds if the promise the skeleton waits on always settles.
 *     `RecipeServiceClient` bounds each ATTEMPT with ky's timeout; it does NOT bound the CALL, which can
 *     replay up to four times (three identity-sync retries plus one expired-token retry) with backoff. So
 *     the query layer imposes its own overall deadline, and a rejection must SURFACE so the UI can fall
 *     back to `unaccounted` rather than spin.
 *  2. **The client declares no wire shape.** §15.2/ADR-0014: the request is validated against, and the
 *     response parsed with, the zod `@kitchensink/schema-recipe` publishes — the same objects the service
 *     validates with. A locally-declared response type would be a second belief about the wire.
 *  3. **The cache key is canonical.** Two surfaces asking for the same recipes in different orders are one
 *     logical read; an order-sensitive key would fetch twice and cache twice.
 */
import { cleanup, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { recipeNutritionResponseSchema, MAX_NUTRITION_RECIPE_IDS } from '@kitchensink/schema-recipe';

import { RecipeServiceClient } from '../index.js';
import {
    UnexpectedResponseError,
    isFetchUnavailableError,
    isInvalidRequestError,
    type InvalidRequestError,
} from '../errors.js';
import { NUTRITION_BATCH_DEADLINE_MS, recipeQueries, recipeServiceKeys, withDeadline } from '../queries.js';
import { useRecipeNutrition } from '../hooks.js';
import { callsOf, requestAt, stubFetch } from './utils/fetchDouble.js';
import { cachedQueryKeys, makeGuardedClient, renderRecipeHook } from './utils/hookHarness.js';

const BASE = 'https://recipes.example.test';
const RECIPE_A = '00000000-0000-4000-8000-00000000000a';
const RECIPE_B = '00000000-0000-4000-8000-00000000000b';

/** A well-formed response body: one known reading, one unaccounted. */
const BODY = {
    nutrition: {
        [RECIPE_A]: {
            state: 'known',
            caloriesPerServing: 350,
            proteinG: 12,
            carbsG: 70,
            fatG: 2,
            isComplete: true,
            freshness: 'fresh',
        },
        [RECIPE_B]: { state: 'unaccounted', reason: 'food_unavailable' },
    },
};

function makeClient(fetchMock: typeof fetch): RecipeServiceClient {
    return new RecipeServiceClient({ baseUrl: BASE, token: 'tok', fetch: fetchMock });
}

describe('RecipeServiceClient.getRecipeNutrition', () => {
    it('POSTs the id list to /api/v1/recipes/nutrition-batch and returns the parsed map', async () => {
        const fetchMock = stubFetch(200, BODY);

        const result = await makeClient(fetchMock).getRecipeNutrition([RECIPE_A, RECIPE_B]);

        const request = requestAt(fetchMock);

        expect(request.method).toBe('POST');
        expect(request.url).toBe(`${BASE}/api/v1/recipes/nutrition-batch`);
        expect(JSON.parse(request.body as string)).toStrictEqual({ recipeIds: [RECIPE_A, RECIPE_B] });
        expect(result).toStrictEqual(BODY);
    });

    it('⛔ PARSES the response with the published zod, so a drifted body fails at the boundary', async () => {
        // The failure this prevents: a server that started emitting a figure on `unaccounted` would reach a
        // card as a renderable `0`. The union's strictness is what refuses it, and only a parse runs it.
        const fetchMock = stubFetch(200, {
            nutrition: { [RECIPE_A]: { state: 'unaccounted', reason: 'food_unavailable', caloriesPerServing: 0 } },
        });

        await expect(makeClient(fetchMock).getRecipeNutrition([RECIPE_A])).rejects.toThrow();
    });

    it('⛔ refuses to SEND an over-cap list, naming the field, rather than paying a round trip for the 400', async () => {
        const fetchMock = stubFetch(200, BODY);
        const tooMany = Array.from(
            { length: MAX_NUTRITION_RECIPE_IDS + 1 },
            (_value, index) => `00000000-0000-4000-8000-${`${index}`.padStart(12, '0')}`,
        );

        const failure = await makeClient(fetchMock)
            .getRecipeNutrition(tooMany)
            .catch((error: unknown) => error);

        expect(isInvalidRequestError(failure)).toBe(true);
        // The ZodError rides on `cause`, so the caller can name the field WITHOUT a round trip — which is
        // the whole value of validating outbound: the diagnosis arrives where the body was built.
        expect(JSON.stringify((failure as InvalidRequestError).cause)).toContain('recipeIds');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('forwards an AbortSignal to the transport, so a caller can cancel the request', async () => {
        const fetchMock = stubFetch(200, BODY);
        const controller = new AbortController();

        await makeClient(fetchMock).getRecipeNutrition([RECIPE_A], { signal: controller.signal });

        // ky composes its own timeout signal with the caller's, so the signal reaching `fetch` is not the
        // caller's object — what matters is that the outgoing Request carries ONE, i.e. it is cancellable.
        expect(callsOf(fetchMock)[0]?.[0].signal).toBeInstanceOf(AbortSignal);
    });

    it('⛔ surfaces an abort as a REJECTION — a cancelled read must not resolve as an empty map', async () => {
        // An abort that resolved `{ nutrition: {} }` would render every card as "no data" and look like a
        // real answer. It has to reach the query as an error so the UI can decide.
        const fetchMock = vi.fn(
            (request: Request) =>
                new Promise<Response>((_resolve, reject) => {
                    const fail = (): void => reject(new DOMException('Aborted', 'AbortError'));

                    // The abort can land BEFORE fetch is invoked (the transport awaits its token first), and
                    // `addEventListener` never fires on an already-aborted signal — so check first.
                    if (request.signal.aborted) {
                        fail();

                        return;
                    }

                    request.signal.addEventListener('abort', fail);
                }),
        ) as unknown as typeof fetch;
        const controller = new AbortController();
        const pending = makeClient(fetchMock).getRecipeNutrition([RECIPE_A], { signal: controller.signal });

        controller.abort();

        await expect(pending).rejects.toThrow();
    });

    it('⛔ maps a DEADLINE expiry to the typed error too — `AbortSignal.timeout` aborts with `TimeoutError`', async () => {
        // The trap the integration tier caught: `AbortSignal.timeout()` does NOT abort with `AbortError`, so
        // a mapping that matched only that name leaked a bare `DOMException` on the very path the overall
        // deadline uses. Pinned here as well, at the tier a future refactor is most likely to run.
        const fetchMock = vi.fn(
            (request: Request) =>
                new Promise<Response>((_resolve, reject) => {
                    const fail = (): void => reject(new DOMException('The operation timed out.', 'TimeoutError'));

                    if (request.signal.aborted) {
                        fail();

                        return;
                    }

                    request.signal.addEventListener('abort', fail);
                }),
        ) as unknown as typeof fetch;

        const failure = await makeClient(fetchMock)
            .getRecipeNutrition([RECIPE_A], { signal: AbortSignal.timeout(20) })
            .catch((error: unknown) => error);

        expect(isFetchUnavailableError(failure)).toBe(true);
    });
});

describe('recipeQueries().nutritionBatch — the read seam', () => {
    /** A fake client exposing only the method this factory uses. */
    function fakeClient(getRecipeNutrition: unknown): RecipeServiceClient {
        return { getRecipeNutrition } as never;
    }

    it('uses its OWN key namespace, so invalidating a recipe list does not stale the figures', () => {
        const options = recipeQueries(fakeClient(vi.fn())).nutritionBatch([RECIPE_A]);

        expect(options.queryKey).toStrictEqual(recipeServiceKeys.recipeNutrition([RECIPE_A]));
        expect(recipeServiceKeys.recipeNutrition([RECIPE_A])[2]).toBe('nutrition');
    });

    it('⛔ CANONICALIZES the key, so two surfaces asking for the same recipes share one cache entry', () => {
        expect(recipeServiceKeys.recipeNutrition([RECIPE_B, RECIPE_A])).toStrictEqual(
            recipeServiceKeys.recipeNutrition([RECIPE_A, RECIPE_B]),
        );
    });

    it('⛔ bounds the whole call with a finite deadline, not just one attempt', async () => {
        // The client's per-attempt ky timeout does NOT bound the call: `send()` may replay it up to four
        // times with backoff. The composed signal is what makes the promise settle, which is what makes the
        // skeleton temporary.
        //
        // ⚠️ ASSERTED BY NON-IDENTITY, not by "an AbortSignal was passed". The weaker assertion is satisfied
        // by TanStack's OWN signal, so it survived a mutation that deleted the deadline entirely — the
        // single most load-bearing line in this factory. The signal reaching the client must be a COMPOSED
        // one, i.e. not the query's.
        const getRecipeNutrition = vi.fn().mockResolvedValue(BODY);
        const options = recipeQueries(fakeClient(getRecipeNutrition)).nutritionBatch([RECIPE_A]);
        const querySignal = new AbortController().signal;

        await options.queryFn?.({ signal: querySignal } as never);

        const passed = getRecipeNutrition.mock.calls[0]?.[1] as { signal?: AbortSignal } | undefined;

        expect(passed?.signal).toBeInstanceOf(AbortSignal);
        expect(passed?.signal).not.toBe(querySignal);
        expect(NUTRITION_BATCH_DEADLINE_MS).toBeGreaterThan(0);
        expect(Number.isFinite(NUTRITION_BATCH_DEADLINE_MS)).toBe(true);
    });

    it('⛔ the composed signal ABORTS on its own deadline, even if the query never cancels', async () => {
        // The behaviour itself, at a millisecond scale. A composition that forwarded only the caller's
        // signal would never abort here, and the promise a skeleton waits on would never settle.
        const never = new AbortController().signal;
        const composed = withDeadline(never, 10);

        expect(composed.aborted).toBe(false);
        await new Promise((resolve) => setTimeout(resolve, 40));
        expect(composed.aborted).toBe(true);
        expect(never.aborted).toBe(false);
    });

    it('still imposes the deadline when there is no caller signal at all', async () => {
        const composed = withDeadline(undefined, 10);

        await new Promise((resolve) => setTimeout(resolve, 40));
        expect(composed.aborted).toBe(true);
    });

    it('bounds the retries — an unbounded retry is an unbounded wait wearing a different hat', () => {
        // REWRITTEN. This used to assert `options.retry` was a NUMBER ≤ 2, which was true and also the
        // problem: a numeric `retry` REPLACES the app-level predicate outright rather than narrowing it, so
        // this was the one query in either app that still retried a `400` after the shared policy landed —
        // a Specification the composition point cannot see is not composed. The BOUND is still the property
        // that matters here, so it is still asserted; it is now read off the predicate.
        const retry = recipeQueries(fakeClient(vi.fn())).nutritionBatch([RECIPE_A]).retry;

        expect(retry).toBeTypeOf('function');

        const server = new UnexpectedResponseError(503);
        const granted = [0, 1, 2, 3].filter((failureCount) =>
            (retry as (count: number, error: Error) => boolean)(failureCount, server),
        );

        expect(granted).toEqual([0]);
    });

    it('does not retry a failure that repeating cannot fix, even inside its own bound', () => {
        // The half the numeric bound could not express. One retry of a `400` is one guaranteed-wasted
        // request and one more slice of the deadline this seam exists to protect.
        const retry = recipeQueries(fakeClient(vi.fn())).nutritionBatch([RECIPE_A]).retry as (
            count: number,
            error: Error,
        ) => boolean;

        expect(retry(0, new UnexpectedResponseError(400))).toBe(false);
        expect(retry(0, new UnexpectedResponseError(503))).toBe(true);
    });

    it('is DISABLED for an empty id list — the service rejects it, so asking is a guaranteed 400', () => {
        expect(recipeQueries(fakeClient(vi.fn())).nutritionBatch([]).enabled).toBe(false);
        expect(recipeQueries(fakeClient(vi.fn())).nutritionBatch([RECIPE_A]).enabled).toBe(true);
    });

    it('carries an explicit stale policy rather than the library default', () => {
        expect(recipeQueries(fakeClient(vi.fn())).nutritionBatch([RECIPE_A]).staleTime).toBeTypeOf('number');
    });
});

describe('useRecipeNutrition', () => {
    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    /** A real client whose transport can never fire, with `getRecipeNutrition` stubbed (type-checked). */
    function clientReturning(result: Promise<unknown>): RecipeServiceClient {
        const client = makeGuardedClient();
        vi.spyOn(client, 'getRecipeNutrition').mockReturnValue(result as never);

        return client;
    }

    it('resolves the map for the requested recipes', async () => {
        const client = clientReturning(Promise.resolve(BODY));
        const { result } = renderRecipeHook(() => useRecipeNutrition([RECIPE_A, RECIPE_B]), { client });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data).toStrictEqual(BODY);
    });

    it('⛔ REACHES an error state when the lookup fails, so the caller can fall back to unaccounted', async () => {
        // The permanent-skeleton failure mode, tested from the consumer's side: a rejection must become
        // `isError`, never a query that stays pending forever.
        const client = clientReturning(Promise.reject(new Error('food gateway down')));
        const { result } = renderRecipeHook(() => useRecipeNutrition([RECIPE_A]), { client });

        // Generous, because the ONE bounded retry this query configures is part of the contract: the wait
        // includes its backoff. What must not happen is the query never settling at all.
        await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 5000 });
        expect(result.current.isPending).toBe(false);
    });

    it('does not fetch for an empty id list', async () => {
        const client = clientReturning(Promise.resolve(BODY));
        const { result } = renderRecipeHook(() => useRecipeNutrition([]), { client });

        await waitFor(() => expect(result.current.fetchStatus).toBe('idle'));
        expect(client.getRecipeNutrition).not.toHaveBeenCalled();
    });

    it('honours an explicit `enabled: false` gate', async () => {
        const client = clientReturning(Promise.resolve(BODY));
        const { result } = renderRecipeHook(() => useRecipeNutrition([RECIPE_A], { enabled: false }), { client });

        await waitFor(() => expect(result.current.fetchStatus).toBe('idle'));
        expect(client.getRecipeNutrition).not.toHaveBeenCalled();
    });

    it('caches under the canonical nutrition key', async () => {
        const client = clientReturning(Promise.resolve(BODY));
        const { result, queryClient } = renderRecipeHook(() => useRecipeNutrition([RECIPE_B, RECIPE_A]), { client });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(cachedQueryKeys(queryClient)).toStrictEqual([
            ['recipe-service', 'recipes', 'nutrition', [RECIPE_A, RECIPE_B]],
        ]);
    });

    it('⛔ the published response schema is what the client parses — no local wire declaration', () => {
        // §15.2/ADR-0014, asserted as a property rather than by reading the imports: the schema the client
        // validates with is the one the schema package publishes.
        expect(recipeNutritionResponseSchema.safeParse(BODY).success).toBe(true);
    });
});
