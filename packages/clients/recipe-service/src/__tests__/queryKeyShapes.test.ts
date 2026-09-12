/**
 * A flat read and an infinite read of the same params are NOT the same cache entry — and this suite proves
 * it against TanStack's real `QueryClient` rather than arguing it from the docs.
 *
 * ⛔ THE CLAIM THIS REPLACES. `recipeQueries`' docstring used to say the pair "shares ONE query key (a flat and
 * an infinite read of the same params are the same logical cache entry; TanStack distinguishes their
 * internal page shape by which hook subscribes to them)". TanStack does no such thing: the cache holds ONE
 * `data` per key, an infinite observer stores `{ pages, pageParams }` there, and a flat observer stores the
 * bare page body. Whoever populates the key first decides what the second reader is handed. The web pages
 * already knew — `discover/page.tsx` and `collections/page.tsx` both carry a warning that "a flat prefetch
 * would dehydrate a bare page body under a key the infinite observer expects `{ pages, pageParams }` for"
 * — which is a hazard being dodged by discipline at every call site instead of being made unrepresentable.
 *
 * The first case below is the collision itself, reproduced: a flat search cached first, then the infinite
 * variant read through the same client, yields data with no `pages` at all. The remaining cases pin the
 * repair: each infinite variant keys under its OWN segment of the same prefix, so the two shapes can never
 * meet, while every broad invalidation (`recipeLists`, `recipeSearches`, `collections`) still reaches both.
 *
 * The key factory's own `ingredientSuggest` states the rule this restores: "the two return different shapes,
 * so one cache key serving both would be a type error waiting to happen".
 */
import { QueryClient, infiniteQueryOptions } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import { collectionQueries, recipeQueries, recipeServiceKeys } from '../queries.js';
import type { RecipeServiceClient } from '../client.js';

/** A minimal fake client — only the methods a given case exercises need to be real `vi.fn()`s. */
function makeFakeClient(overrides: Partial<Record<keyof RecipeServiceClient, unknown>> = {}): RecipeServiceClient {
    return overrides as never;
}

/** A search page the way the service returns it. */
function searchPage(page: number, hasMore: boolean) {
    return {
        results: [],
        total: 0,
        page,
        pageSize: 20,
        hasMore,
        facets: { dietaryFlags: [], tags: [], cuisine: [], totalTime: [] },
    };
}

/** A list page the way the service returns it. */
function listPage(page: number, hasMore: boolean) {
    return { data: [], total: 0, page, pageSize: 20, hasMore };
}

/** Does `prefix` address `key` under TanStack's partial-matching rule (element-wise prefix)? */
function isAddressedBy(key: readonly unknown[], prefix: readonly unknown[]): boolean {
    return prefix.every((segment, index) => JSON.stringify(key[index]) === JSON.stringify(segment));
}

describe('a flat read and an infinite read of the same params', () => {
    it('are handed to each other as-is when they share a key — the collision, reproduced', async () => {
        // Deliberately built on the FLAT key for both, to show what the shared-key design does. The factories
        // no longer do this; this case exists so the failure mode stays legible to the next reader.
        const searchRecipes = vi.fn().mockResolvedValue(searchPage(1, true));
        const client = makeFakeClient({ searchRecipes });
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const params = { query: 'pie' };
        const sharedKey = recipeServiceKeys.recipeSearch(params);

        await queryClient.fetchQuery(recipeQueries(client).search(params));
        // Hand-built rather than through the factory, because the factory can no longer express this key.
        const infinite = await queryClient.fetchInfiniteQuery(
            infiniteQueryOptions({
                queryKey: sharedKey,
                queryFn: ({ pageParam }) => client.searchRecipes({ ...params, page: pageParam }),
                initialPageParam: 1,
                getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.page + 1 : undefined),
                // The factory's own policy: fresh data under the key is served, not refetched.
                staleTime: 60_000,
            }),
        );

        // The infinite read found fresh data under its key and returned it WITHOUT fetching: the flat page
        // body, which has no `pages`. A "Load more" control reading `data.pages` would crash here.
        expect(searchRecipes).toHaveBeenCalledTimes(1);
        expect(infinite).not.toHaveProperty('pages');
        expect(infinite).toHaveProperty('results');
    });

    it('cannot collide through the factories: the infinite search keys under its own segment', async () => {
        const searchRecipes = vi.fn().mockResolvedValue(searchPage(1, true));
        const client = makeFakeClient({ searchRecipes });
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const params = { query: 'pie' };

        await queryClient.fetchQuery(recipeQueries(client).search(params));
        const infinite = await queryClient.fetchInfiniteQuery(recipeQueries(client).searchInfinite(params));

        expect(searchRecipes).toHaveBeenCalledTimes(2);
        expect(infinite.pages).toEqual([searchPage(1, true)]);
        expect(infinite.pageParams).toEqual([1]);
        expect(recipeQueries(client).searchInfinite(params).queryKey).not.toEqual(
            recipeQueries(client).search(params).queryKey,
        );
    });

    it('cannot collide through the factories: the infinite recipe list keys under its own segment', async () => {
        const listRecipes = vi.fn().mockResolvedValue(listPage(1, false));
        const client = makeFakeClient({ listRecipes });
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const params = { pageSize: 20 };

        await queryClient.fetchQuery(recipeQueries(client).list(params));
        const infinite = await queryClient.fetchInfiniteQuery(recipeQueries(client).listInfinite(params));

        expect(listRecipes).toHaveBeenCalledTimes(2);
        expect(infinite.pages).toEqual([listPage(1, false)]);
        expect(recipeQueries(client).listInfinite(params).queryKey).not.toEqual(
            recipeQueries(client).list(params).queryKey,
        );
    });

    it('cannot collide through the factories: the infinite collection list keys under its own segment', async () => {
        const listCollections = vi.fn().mockResolvedValue(listPage(1, false));
        const client = makeFakeClient({ listCollections });
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const params = { pageSize: 20 };

        await queryClient.fetchQuery(collectionQueries(client).list(params));
        const infinite = await queryClient.fetchInfiniteQuery(collectionQueries(client).listInfinite(params));

        expect(listCollections).toHaveBeenCalledTimes(2);
        expect(infinite.pages).toEqual([listPage(1, false)]);
        expect(collectionQueries(client).listInfinite(params).queryKey).not.toEqual(
            collectionQueries(client).list(params).queryKey,
        );
    });

    // The reason the infinite key is a SEGMENT under the existing prefix rather than a new namespace: every
    // mutation's broad invalidation must keep staling both shapes, or a "Load more" surface would render a
    // pre-write page after a write the flat surface already reflects.
    it('keep both shapes under the ONE prefix each broad invalidation addresses', () => {
        const client = makeFakeClient();
        const recipeParams = { pageSize: 20 };
        const searchParams = { query: 'pie' };

        expect(
            isAddressedBy(recipeQueries(client).listInfinite(recipeParams).queryKey, recipeServiceKeys.recipeLists),
        ).toBe(true);
        expect(
            isAddressedBy(
                recipeQueries(client).searchInfinite(searchParams).queryKey,
                recipeServiceKeys.recipeSearches,
            ),
        ).toBe(true);
        expect(
            isAddressedBy(collectionQueries(client).listInfinite(recipeParams).queryKey, recipeServiceKeys.collections),
        ).toBe(true);
        // And the key authority spells each infinite address ONCE, beside its flat twin.
        expect(recipeQueries(client).listInfinite(recipeParams).queryKey).toEqual(
            recipeServiceKeys.recipeListInfinite(recipeParams),
        );
        expect(recipeQueries(client).searchInfinite(searchParams).queryKey).toEqual(
            recipeServiceKeys.recipeSearchInfinite(searchParams),
        );
        expect(collectionQueries(client).listInfinite(recipeParams).queryKey).toEqual(
            recipeServiceKeys.collectionListInfinite(recipeParams),
        );
    });
});
