/**
 * `queryOptions` factory contract for `@kitchensink/recipe-service-client` (W9/P5 — the Repository read
 * seam). This is a client/server-agnostic layer beneath `hooks.ts`: each factory method returns a plain
 * v5 `queryOptions`/`infiniteQueryOptions` object (key + fetcher + cache policy), built once and reused by
 * both the React hooks and any future non-hook caller (e.g. `queryClient.prefetchQuery`).
 *
 * What is pinned per factory method:
 * 1. **The key** — must equal the literal `recipeServiceKeys` entry (the single key authority).
 * 2. **The fetcher** — calls the ONE client method the domain owns, forwarding args unmodified.
 * 3. **The cache policy** — an explicit `staleTime`, asserted as a literal number (never "whatever the
 *    library defaults to"), so a change to the policy is a deliberate, reviewable diff to this file.
 *
 * `recipeProjections` is asserted separately: it is the invalidation registry `hooks.ts` folds
 * `invalidateRecipeProjections` into (DA2/P5), so its four-region shape is pinned by literal key.
 */
import { describe, expect, it, vi } from 'vitest';

import { FoodResolutionStatus } from '@kitchensink/recipe-core';
import type { Ingredient } from '@kitchensink/recipe-core';

import {
    DEFAULT_INGREDIENT_POLL_INTERVAL_MS,
    collectionQueries,
    ingredientQueries,
    recipeProjections,
    recipeQueries,
    recipeServiceKeys,
} from '../queries.js';
import type { RecipeServiceClient } from '../client.js';

/** A minimal fake client — only the methods a given test exercises need to be real `vi.fn()`s. */
function makeFakeClient(overrides: Partial<Record<keyof RecipeServiceClient, unknown>> = {}): RecipeServiceClient {
    return overrides as never;
}

describe('recipeQueries (P5 repository read seam)', () => {
    it('builds detail options with the canonical key and an explicit stale policy', () => {
        const client = makeFakeClient({ getRecipeById: vi.fn().mockResolvedValue({ id: 'rec_1' }) });
        const options = recipeQueries(client).detail('rec_1');

        expect(options.queryKey).toEqual(recipeServiceKeys.recipe('rec_1'));
        expect(options.staleTime).toBeTypeOf('number'); // a DECISION, not the library default
    });

    it('calls getRecipeById with the id, unmodified, when the fetcher runs', async () => {
        const getRecipeById = vi.fn().mockResolvedValue({ id: 'rec_1' });
        const client = makeFakeClient({ getRecipeById });
        const options = recipeQueries(client).detail('rec_1');

        await options.queryFn?.({} as never);

        expect(getRecipeById).toHaveBeenCalledExactlyOnceWith('rec_1');
    });

    it('pins detail staleTime to 30s — recipe metadata changes only on an explicit write', () => {
        const client = makeFakeClient();
        expect(recipeQueries(client).detail('rec_1').staleTime).toBe(30_000);
    });

    it('keys and calls listRecipes for list(), pinned to the same 30s policy as detail', async () => {
        const listRecipes = vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 20, hasMore: false });
        const client = makeFakeClient({ listRecipes });
        const params = { page: 2, pageSize: 20 };
        const options = recipeQueries(client).list(params);

        expect(options.queryKey).toEqual(recipeServiceKeys.recipeList(params));
        expect(options.staleTime).toBe(30_000);
        await options.queryFn?.({} as never);
        expect(listRecipes).toHaveBeenCalledExactlyOnceWith(params);
    });

    it('keys listInfinite() under the SAME list key and preserves the hasMore→page+1 pager contract', async () => {
        const listRecipes = vi.fn().mockResolvedValue({ data: [], total: 0, page: 2, pageSize: 20, hasMore: true });
        const client = makeFakeClient({ listRecipes });
        const params = { pageSize: 20 };
        const options = recipeQueries(client).listInfinite(params);

        expect(options.queryKey).toEqual(recipeServiceKeys.recipeList(params));
        expect(options.initialPageParam).toBe(1);
        expect(options.getNextPageParam({ data: [], total: 0, page: 2, pageSize: 20, hasMore: true }, [], 1, [])).toBe(
            3,
        );
        expect(
            options.getNextPageParam({ data: [], total: 0, page: 2, pageSize: 20, hasMore: false }, [], 1, []),
        ).toBeUndefined();
        await options.queryFn?.({ pageParam: 3 } as never);
        expect(listRecipes).toHaveBeenCalledExactlyOnceWith({ ...params, page: 3 });
    });

    it('pins versions() to a 60s policy — a recipe rarely gains a new version', () => {
        const listRecipeVersions = vi.fn().mockResolvedValue([]);
        const client = makeFakeClient({ listRecipeVersions });
        const options = recipeQueries(client).versions('rec_1');

        expect(options.queryKey).toEqual(recipeServiceKeys.recipeVersions('rec_1'));
        expect(options.staleTime).toBe(60_000);
    });

    it('keys and calls getRecipeVersion for version(id, n), forwarding both args in order', async () => {
        const getRecipeVersion = vi.fn().mockResolvedValue({ versionNumber: 3 });
        const client = makeFakeClient({ getRecipeVersion });
        const options = recipeQueries(client).version('rec_1', 3);

        expect(options.queryKey).toEqual(recipeServiceKeys.recipeVersion('rec_1', 3));
        expect(options.staleTime).toBe(60_000);
        await options.queryFn?.({} as never);
        expect(getRecipeVersion).toHaveBeenCalledExactlyOnceWith('rec_1', 3);
    });

    it('keys and calls listRecipePhotos for photos(id)', async () => {
        const listRecipePhotos = vi.fn().mockResolvedValue([]);
        const client = makeFakeClient({ listRecipePhotos });
        const options = recipeQueries(client).photos('rec_1');

        expect(options.queryKey).toEqual(recipeServiceKeys.recipePhotos('rec_1'));
        expect(options.staleTime).toBeTypeOf('number');
        await options.queryFn?.({} as never);
        expect(listRecipePhotos).toHaveBeenCalledExactlyOnceWith('rec_1');
    });

    it('pins search() to a tighter 15s policy — results churn faster than a single recipe', async () => {
        const searchRecipes = vi
            .fn()
            .mockResolvedValue({ results: [], total: 0, page: 1, pageSize: 20, hasMore: false, facets: {} });
        const client = makeFakeClient({ searchRecipes });
        const params = { query: 'pie' };
        const options = recipeQueries(client).search(params);

        expect(options.queryKey).toEqual(recipeServiceKeys.recipeSearch(params));
        expect(options.staleTime).toBe(15_000);
        await options.queryFn?.({} as never);
        expect(searchRecipes).toHaveBeenCalledExactlyOnceWith(params);
    });

    it('keys searchInfinite() under the SAME search key (not a distinct namespace) at the 15s policy', async () => {
        const searchRecipes = vi
            .fn()
            .mockResolvedValue({ results: [], total: 0, page: 2, pageSize: 20, hasMore: true, facets: {} });
        const client = makeFakeClient({ searchRecipes });
        const params = { query: 'pie' };
        const options = recipeQueries(client).searchInfinite(params);

        expect(options.queryKey).toEqual(recipeServiceKeys.recipeSearch(params));
        expect(options.staleTime).toBe(15_000);
        expect(options.initialPageParam).toBe(1);
        expect(
            options.getNextPageParam(
                { results: [], total: 0, page: 2, pageSize: 20, hasMore: true, facets: {} },
                [],
                1,
                [],
            ),
        ).toBe(3);
        expect(
            options.getNextPageParam(
                { results: [], total: 0, page: 2, pageSize: 20, hasMore: false, facets: {} },
                [],
                1,
                [],
            ),
        ).toBeUndefined();
        await options.queryFn?.({ pageParam: 3 } as never);
        expect(searchRecipes).toHaveBeenCalledExactlyOnceWith({ ...params, page: 3 });
    });
});

describe('collectionQueries (P5 repository read seam)', () => {
    it('keys and calls listCollections for list(), with an explicit stale policy', async () => {
        const listCollections = vi
            .fn()
            .mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 20, hasMore: false });
        const client = makeFakeClient({ listCollections });
        const params = { page: 1 };
        const options = collectionQueries(client).list(params);

        expect(options.queryKey).toEqual(recipeServiceKeys.collectionList(params));
        expect(options.staleTime).toBeTypeOf('number');
        await options.queryFn?.({} as never);
        expect(listCollections).toHaveBeenCalledExactlyOnceWith(params);
    });

    it('keys and calls getCollectionById for detail(id)', async () => {
        const getCollectionById = vi.fn().mockResolvedValue({ id: 'col_1' });
        const client = makeFakeClient({ getCollectionById });
        const options = collectionQueries(client).detail('col_1');

        expect(options.queryKey).toEqual(recipeServiceKeys.collection('col_1'));
        expect(options.staleTime).toBeTypeOf('number');
        await options.queryFn?.({} as never);
        expect(getCollectionById).toHaveBeenCalledExactlyOnceWith('col_1');
    });

    it('keys listInfinite() under the SAME list key and preserves the hasMore→page+1 pager contract', async () => {
        const listCollections = vi.fn().mockResolvedValue({ data: [], total: 0, page: 2, pageSize: 20, hasMore: true });
        const client = makeFakeClient({ listCollections });
        const params = { pageSize: 20 };
        const options = collectionQueries(client).listInfinite(params);

        expect(options.queryKey).toEqual(recipeServiceKeys.collectionList(params));
        expect(options.initialPageParam).toBe(1);
        expect(options.getNextPageParam({ data: [], total: 0, page: 2, pageSize: 20, hasMore: true }, [], 1, [])).toBe(
            3,
        );
        expect(
            options.getNextPageParam({ data: [], total: 0, page: 2, pageSize: 20, hasMore: false }, [], 1, []),
        ).toBeUndefined();
        await options.queryFn?.({ pageParam: 3 } as never);
        expect(listCollections).toHaveBeenCalledExactlyOnceWith({ ...params, page: 3 });
    });
});

describe('ingredientQueries (P5 repository read seam)', () => {
    it('keys and calls searchIngredients for search(query, limit), in order', async () => {
        const searchIngredients = vi.fn().mockResolvedValue([]);
        const client = makeFakeClient({ searchIngredients });
        const options = ingredientQueries(client).search('tom', 5);

        expect(options.queryKey).toEqual(recipeServiceKeys.ingredientSearch('tom', 5));
        await options.queryFn?.({} as never);
        expect(searchIngredients).toHaveBeenCalledExactlyOnceWith('tom', 5);
    });

    it('keys and calls suggestIngredients for suggest(query, limit), in order', async () => {
        const suggestIngredients = vi.fn().mockResolvedValue({ suggestions: [], catalogAvailability: 'ok' });
        const client = makeFakeClient({ suggestIngredients });
        const options = ingredientQueries(client).suggest('chick', 5);

        expect(options.queryKey).toEqual(recipeServiceKeys.ingredientSuggest('chick', 5));
        expect(options.staleTime).toBeTypeOf('number'); // a DECISION, not the library default
        await options.queryFn?.({} as never);
        expect(suggestIngredients).toHaveBeenCalledExactlyOnceWith('chick', 5);
    });

    it('gives search and suggest DISTINCT keys for the same terms (they return different shapes)', () => {
        const client = makeFakeClient({ searchIngredients: vi.fn(), suggestIngredients: vi.fn() });
        const factories = ingredientQueries(client);

        expect(factories.suggest('chick', 5).queryKey).not.toEqual(factories.search('chick', 5).queryKey);
    });

    it('nests the suggest key under the shared ingredientSearches invalidation prefix', () => {
        // One ingredient write must stale BOTH typeahead reads; that only holds if `suggest` lives under the
        // same prefix `useAddIngredientByName`/`useAddIngredientByFood`/`useResolveIngredient` invalidate.
        const prefix = recipeServiceKeys.ingredientSearches;

        expect(recipeServiceKeys.ingredientSuggest('chick', 5).slice(0, prefix.length)).toEqual([...prefix]);
    });

    it('preserves the self-limiting refetchInterval on status(id) — polls ONLY while PENDING', () => {
        const getIngredientStatus = vi.fn().mockResolvedValue({ id: 'ing_1' });
        const client = makeFakeClient({ getIngredientStatus });
        const options = ingredientQueries(client).status('ing_1');

        expect(options.queryKey).toEqual(recipeServiceKeys.ingredientStatus('ing_1'));
        expect(typeof options.refetchInterval).toBe('function');

        const refetchInterval = options.refetchInterval as (query: {
            state: { data: Ingredient | undefined };
        }) => unknown;

        expect(
            refetchInterval({ state: { data: { foodResolutionStatus: FoodResolutionStatus.PENDING } as Ingredient } }),
        ).toBe(DEFAULT_INGREDIENT_POLL_INTERVAL_MS);
        expect(
            refetchInterval({ state: { data: { foodResolutionStatus: FoodResolutionStatus.RESOLVED } as Ingredient } }),
        ).toBe(false);
        expect(
            refetchInterval({
                state: { data: { foodResolutionStatus: FoodResolutionStatus.UNRESOLVED } as Ingredient },
            }),
        ).toBe(false);
        expect(refetchInterval({ state: { data: undefined } })).toBe(false);
    });

    it('honors a caller-supplied poll cadence for status(id, pollIntervalMs)', () => {
        const client = makeFakeClient({ getIngredientStatus: vi.fn() });
        const options = ingredientQueries(client).status('ing_1', 9000);
        const refetchInterval = options.refetchInterval as (query: {
            state: { data: Ingredient | undefined };
        }) => unknown;

        expect(
            refetchInterval({ state: { data: { foodResolutionStatus: FoodResolutionStatus.PENDING } as Ingredient } }),
        ).toBe(9000);
    });

    it('keys and calls getIngredientCandidates for candidates(id)', async () => {
        const getIngredientCandidates = vi.fn().mockResolvedValue([]);
        const client = makeFakeClient({ getIngredientCandidates });
        const options = ingredientQueries(client).candidates('ing_1');

        expect(options.queryKey).toEqual(recipeServiceKeys.ingredientCandidates('ing_1'));
        await options.queryFn?.({} as never);
        expect(getIngredientCandidates).toHaveBeenCalledExactlyOnceWith('ing_1');
    });
});

describe('recipeProjections (P5 registry, folds DA2)', () => {
    it('names exactly the four regions a recipe write stales', () => {
        expect(recipeProjections('rec_1')).toEqual([
            recipeServiceKeys.recipe('rec_1'),
            recipeServiceKeys.recipeLists,
            recipeServiceKeys.recipeSearches,
            recipeServiceKeys.collections,
        ]);
    });

    it('is keyed off the given recipe id — a different id names a different subtree', () => {
        expect(recipeProjections('rec_2')[0]).toEqual(recipeServiceKeys.recipe('rec_2'));
    });
});
