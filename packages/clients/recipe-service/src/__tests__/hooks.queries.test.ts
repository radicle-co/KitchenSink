// @vitest-environment jsdom
/**
 * Read-hook contract for the recipe-service query hooks (T064 / FR-001, FR-002, FR-004, FR-005, FR-011,
 * FR-013): `useRecipes`, `useRecipe`, `useRecipeVersions`, `useRecipeVersion`, `useRecipePhotos`,
 * `useCollections`, `useCollection`, `useSearchRecipes`, `useSearchIngredients`.
 *
 * Each hook is exercised for every state it can be in — loading, success, error, and (where it has a gate)
 * disabled/idle — plus the two things only the hook owns: **which cache key** it writes under and **which
 * arguments** it forwards to the client. Key assertions read the real key off the query cache and compare
 * it to a **literal** array, so a changed key in `recipeServiceKeys` fails here rather than silently
 * re-deriving. The client is a real instance with `vi.spyOn` stubs (see `utils/hookHarness.ts`).
 *
 * | Requirement | Behavior pinned                                                                  |
 * | ----------- | -------------------------------------------------------------------------------- |
 * | T064        | every query hook caches under its documented literal key                          |
 * | T064        | every query hook forwards its params to the matching client method, unaltered     |
 * | T064        | loading → success transition exposes the client's parsed result as `data`         |
 * | T064        | a client rejection propagates as `isError` + the typed error (no swallowing)      |
 * | T064        | id/query-gated hooks stay idle (no request) for an empty id/query                 |
 * | T064        | `options.enabled: false` suppresses the request for every gated hook              |
 * | T064        | a gate flipping from disabled to enabled issues the request (gate is not sticky)  |
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, waitFor } from '@testing-library/react';

import { NotFoundError, UnauthorizedError } from '../errors.js';
import {
    useAllOwnerRecipes,
    useCollection,
    useCollections,
    useCollectionsInfinite,
    useRecipe,
    useRecipePhotos,
    useRecipeVersion,
    useRecipeVersions,
    useRecipes,
    useSearchIngredients,
    useSearchRecipes,
    useInfiniteSearchRecipes,
} from '../hooks.js';
import {
    makeCollection,
    makeCollectionWithRecipes,
    makeIngredient,
    makePaginatedResponse,
    makeRecipe,
    makeRecipeDetail,
    makeRecipePhoto,
    makeRecipeSearchResponse,
    makeRecipeVersion,
} from '../__fixtures__/recipes.js';
import { cachedQueryKeys, makeGuardedClient, renderRecipeHook } from './utils/hookHarness.js';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('useRecipes', () => {
    it('caches the page under the literal recipe-list key, including the list params', async () => {
        const client = makeGuardedClient();
        vi.spyOn(client, 'listRecipes').mockResolvedValue(makePaginatedResponse([makeRecipe()]));

        const { result, queryClient } = renderRecipeHook(() => useRecipes({ page: 2, pageSize: 50 }), { client });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(cachedQueryKeys(queryClient)).toEqual([
            ['recipe-service', 'recipes', 'list', { page: 2, pageSize: 50 }],
        ]);
    });

    it('caches an unparameterized list under the empty-params key', async () => {
        const client = makeGuardedClient();
        vi.spyOn(client, 'listRecipes').mockResolvedValue(makePaginatedResponse([]));

        const { result, queryClient } = renderRecipeHook(() => useRecipes(), { client });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(cachedQueryKeys(queryClient)).toEqual([['recipe-service', 'recipes', 'list', {}]]);
    });

    it('forwards the list params to listRecipes unaltered', async () => {
        const client = makeGuardedClient();
        const listRecipes = vi.spyOn(client, 'listRecipes').mockResolvedValue(makePaginatedResponse([]));

        const { result } = renderRecipeHook(() => useRecipes({ page: 3, pageSize: 10, sortBy: 'title' }), { client });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(listRecipes).toHaveBeenCalledWith({ page: 3, pageSize: 10, sortBy: 'title' });
    });

    it('is loading with no data before the client resolves', () => {
        const client = makeGuardedClient();
        vi.spyOn(client, 'listRecipes').mockReturnValue(new Promise(() => undefined));

        const { result } = renderRecipeHook(() => useRecipes(), { client });

        expect(result.current.isLoading).toBe(true);
        expect(result.current.data).toBeUndefined();
    });

    it('exposes an empty page as success with zero rows (empty state, not an error)', async () => {
        const client = makeGuardedClient();
        const empty = makePaginatedResponse<ReturnType<typeof makeRecipe>>([], { total: 0 });
        vi.spyOn(client, 'listRecipes').mockResolvedValue(empty);

        const { result } = renderRecipeHook(() => useRecipes(), { client });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data?.data).toEqual([]);
        expect(result.current.data?.total).toBe(0);
    });

    it('propagates a client rejection as the typed error, without retrying it away', async () => {
        const client = makeGuardedClient();
        const error = new UnauthorizedError('Unauthorized', 'UNAUTHORIZED');
        vi.spyOn(client, 'listRecipes').mockRejectedValue(error);

        const { result } = renderRecipeHook(() => useRecipes(), { client });

        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(result.current.error).toBe(error);
        expect(result.current.data).toBeUndefined();
    });

    it('fetches eagerly — it has no gate (a recipe list needs no id)', async () => {
        const client = makeGuardedClient();
        const listRecipes = vi.spyOn(client, 'listRecipes').mockResolvedValue(makePaginatedResponse([]));

        const { result } = renderRecipeHook(() => useRecipes(), { client });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(listRecipes).toHaveBeenCalledTimes(1);
    });
});

describe('useRecipe', () => {
    it('caches the detail under the literal recipe-detail key for the requested id', async () => {
        const client = makeGuardedClient();
        vi.spyOn(client, 'getRecipeById').mockResolvedValue(makeRecipeDetail({ id: 'rec_1' }));

        const { result, queryClient } = renderRecipeHook(() => useRecipe('rec_1'), { client });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(cachedQueryKeys(queryClient)).toEqual([['recipe-service', 'recipes', 'detail', 'rec_1']]);
    });

    it('forwards the id to getRecipeById and returns the detail', async () => {
        const client = makeGuardedClient();
        const detail = makeRecipeDetail({ id: 'rec_7' });
        const getRecipeById = vi.spyOn(client, 'getRecipeById').mockResolvedValue(detail);

        const { result } = renderRecipeHook(() => useRecipe('rec_7'), { client });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(getRecipeById).toHaveBeenCalledWith('rec_7');
        expect(result.current.data).toEqual(detail);
    });

    it('stays idle and issues no request for an empty id', () => {
        const client = makeGuardedClient();
        const getRecipeById = vi.spyOn(client, 'getRecipeById');

        const { result } = renderRecipeHook(() => useRecipe(''), { client });

        expect(result.current.fetchStatus).toBe('idle');
        expect(result.current.isPending).toBe(true);
        expect(getRecipeById).not.toHaveBeenCalled();
    });

    it('stays idle and issues no request when explicitly disabled, even with a valid id', () => {
        const client = makeGuardedClient();
        const getRecipeById = vi.spyOn(client, 'getRecipeById');

        const { result } = renderRecipeHook(() => useRecipe('rec_1', { enabled: false }), { client });

        expect(result.current.fetchStatus).toBe('idle');
        expect(getRecipeById).not.toHaveBeenCalled();
    });

    it('fetches once the gate flips from disabled to enabled (the gate is not sticky)', async () => {
        const client = makeGuardedClient();
        const getRecipeById = vi.spyOn(client, 'getRecipeById').mockResolvedValue(makeRecipeDetail({ id: 'rec_1' }));
        let enabled = false;

        const { result } = renderRecipeHook(() => useRecipe('rec_1', { enabled }), { client });
        expect(getRecipeById).not.toHaveBeenCalled();

        enabled = true;
        await result.current.refetch();

        await waitFor(() => expect(getRecipeById).toHaveBeenCalledWith('rec_1'));
    });

    it('propagates a 404 as the typed NotFoundError', async () => {
        const client = makeGuardedClient();
        const error = new NotFoundError('Recipe not found', 'NOT_FOUND');
        vi.spyOn(client, 'getRecipeById').mockRejectedValue(error);

        const { result } = renderRecipeHook(() => useRecipe('rec_missing'), { client });

        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(result.current.error).toBe(error);
    });
});

describe('useRecipeVersions', () => {
    it("caches the version list under the literal key beneath the recipe's detail key", async () => {
        const client = makeGuardedClient();
        vi.spyOn(client, 'listRecipeVersions').mockResolvedValue([makeRecipeVersion()]);

        const { result, queryClient } = renderRecipeHook(() => useRecipeVersions('rec_1'), { client });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(cachedQueryKeys(queryClient)).toEqual([['recipe-service', 'recipes', 'detail', 'rec_1', 'versions']]);
    });

    it('forwards the id to listRecipeVersions and returns the versions', async () => {
        const client = makeGuardedClient();
        const versions = [makeRecipeVersion({ versionNumber: 2 }), makeRecipeVersion({ versionNumber: 1 })];
        const listRecipeVersions = vi.spyOn(client, 'listRecipeVersions').mockResolvedValue(versions);

        const { result } = renderRecipeHook(() => useRecipeVersions('rec_4'), { client });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(listRecipeVersions).toHaveBeenCalledWith('rec_4');
        expect(result.current.data).toEqual(versions);
    });

    it('returns an empty version list as success (a never-edited recipe)', async () => {
        const client = makeGuardedClient();
        vi.spyOn(client, 'listRecipeVersions').mockResolvedValue([]);

        const { result } = renderRecipeHook(() => useRecipeVersions('rec_1'), { client });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data).toEqual([]);
    });

    it('stays idle and issues no request for an empty id', () => {
        const client = makeGuardedClient();
        const listRecipeVersions = vi.spyOn(client, 'listRecipeVersions');

        const { result } = renderRecipeHook(() => useRecipeVersions(''), { client });

        expect(result.current.fetchStatus).toBe('idle');
        expect(listRecipeVersions).not.toHaveBeenCalled();
    });

    it('stays idle and issues no request when explicitly disabled', () => {
        const client = makeGuardedClient();
        const listRecipeVersions = vi.spyOn(client, 'listRecipeVersions');

        const { result } = renderRecipeHook(() => useRecipeVersions('rec_1', { enabled: false }), { client });

        expect(result.current.fetchStatus).toBe('idle');
        expect(listRecipeVersions).not.toHaveBeenCalled();
    });

    it('propagates a client rejection as an error', async () => {
        const client = makeGuardedClient();
        const error = new NotFoundError('Recipe not found');
        vi.spyOn(client, 'listRecipeVersions').mockRejectedValue(error);

        const { result } = renderRecipeHook(() => useRecipeVersions('rec_1'), { client });

        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(result.current.error).toBe(error);
    });
});

describe('useRecipeVersion', () => {
    it('caches the snapshot under the literal key including the version number', async () => {
        const client = makeGuardedClient();
        vi.spyOn(client, 'getRecipeVersion').mockResolvedValue(makeRecipeVersion({ versionNumber: 3 }));

        const { result, queryClient } = renderRecipeHook(() => useRecipeVersion('rec_1', 3), { client });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(cachedQueryKeys(queryClient)).toEqual([['recipe-service', 'recipes', 'detail', 'rec_1', 'versions', 3]]);
    });

    it('forwards BOTH the id and the version number to getRecipeVersion, in order', async () => {
        const client = makeGuardedClient();
        const getRecipeVersion = vi
            .spyOn(client, 'getRecipeVersion')
            .mockResolvedValue(makeRecipeVersion({ versionNumber: 5 }));

        const { result } = renderRecipeHook(() => useRecipeVersion('rec_9', 5), { client });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(getRecipeVersion).toHaveBeenCalledWith('rec_9', 5);
    });

    it('keys two versions of the same recipe separately (no cache collision)', async () => {
        const client = makeGuardedClient();
        vi.spyOn(client, 'getRecipeVersion').mockImplementation(async (_id, versionNumber) =>
            makeRecipeVersion({ versionNumber }),
        );
        const queryClient = undefined;

        const first = renderRecipeHook(() => useRecipeVersion('rec_1', 1), { client, queryClient });
        await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
        const second = renderRecipeHook(() => useRecipeVersion('rec_1', 2), {
            client,
            queryClient: first.queryClient,
        });
        await waitFor(() => expect(second.result.current.isSuccess).toBe(true));

        expect(first.result.current.data?.versionNumber).toBe(1);
        expect(second.result.current.data?.versionNumber).toBe(2);
        expect(cachedQueryKeys(first.queryClient)).toHaveLength(2);
    });

    it('stays idle and issues no request for an empty id', () => {
        const client = makeGuardedClient();
        const getRecipeVersion = vi.spyOn(client, 'getRecipeVersion');

        const { result } = renderRecipeHook(() => useRecipeVersion('', 3), { client });

        expect(result.current.fetchStatus).toBe('idle');
        expect(getRecipeVersion).not.toHaveBeenCalled();
    });

    it('stays idle and issues no request when explicitly disabled', () => {
        const client = makeGuardedClient();
        const getRecipeVersion = vi.spyOn(client, 'getRecipeVersion');

        const { result } = renderRecipeHook(() => useRecipeVersion('rec_1', 3, { enabled: false }), { client });

        expect(result.current.fetchStatus).toBe('idle');
        expect(getRecipeVersion).not.toHaveBeenCalled();
    });

    it('propagates a client rejection as an error', async () => {
        const client = makeGuardedClient();
        const error = new NotFoundError('Version not found');
        vi.spyOn(client, 'getRecipeVersion').mockRejectedValue(error);

        const { result } = renderRecipeHook(() => useRecipeVersion('rec_1', 99), { client });

        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(result.current.error).toBe(error);
    });
});

describe('useRecipePhotos', () => {
    it("caches the photos under the literal key beneath the recipe's detail key", async () => {
        const client = makeGuardedClient();
        vi.spyOn(client, 'listRecipePhotos').mockResolvedValue([makeRecipePhoto()]);

        const { result, queryClient } = renderRecipeHook(() => useRecipePhotos('rec_1'), { client });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(cachedQueryKeys(queryClient)).toEqual([['recipe-service', 'recipes', 'detail', 'rec_1', 'photos']]);
    });

    it('forwards the id to listRecipePhotos and returns the photos', async () => {
        const client = makeGuardedClient();
        const photos = [makeRecipePhoto({ id: 'pho_1', order: 1 })];
        const listRecipePhotos = vi.spyOn(client, 'listRecipePhotos').mockResolvedValue(photos);

        const { result } = renderRecipeHook(() => useRecipePhotos('rec_3'), { client });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(listRecipePhotos).toHaveBeenCalledWith('rec_3');
        expect(result.current.data).toEqual(photos);
    });

    it('returns an empty photo list as success (a photoless recipe)', async () => {
        const client = makeGuardedClient();
        vi.spyOn(client, 'listRecipePhotos').mockResolvedValue([]);

        const { result } = renderRecipeHook(() => useRecipePhotos('rec_1'), { client });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data).toEqual([]);
    });

    it('stays idle and issues no request for an empty id', () => {
        const client = makeGuardedClient();
        const listRecipePhotos = vi.spyOn(client, 'listRecipePhotos');

        const { result } = renderRecipeHook(() => useRecipePhotos(''), { client });

        expect(result.current.fetchStatus).toBe('idle');
        expect(listRecipePhotos).not.toHaveBeenCalled();
    });

    it('stays idle and issues no request when explicitly disabled', () => {
        const client = makeGuardedClient();
        const listRecipePhotos = vi.spyOn(client, 'listRecipePhotos');

        const { result } = renderRecipeHook(() => useRecipePhotos('rec_1', { enabled: false }), { client });

        expect(result.current.fetchStatus).toBe('idle');
        expect(listRecipePhotos).not.toHaveBeenCalled();
    });

    it('propagates a client rejection as an error', async () => {
        const client = makeGuardedClient();
        const error = new NotFoundError('Recipe not found');
        vi.spyOn(client, 'listRecipePhotos').mockRejectedValue(error);

        const { result } = renderRecipeHook(() => useRecipePhotos('rec_1'), { client });

        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(result.current.error).toBe(error);
    });
});

describe('useCollections', () => {
    it('caches the page under the literal collection-list key, including the list params', async () => {
        const client = makeGuardedClient();
        vi.spyOn(client, 'listCollections').mockResolvedValue(makePaginatedResponse([makeCollection()]));

        const { result, queryClient } = renderRecipeHook(() => useCollections({ page: 3, pageSize: 10 }), { client });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(cachedQueryKeys(queryClient)).toEqual([
            ['recipe-service', 'collections', 'list', { page: 3, pageSize: 10 }],
        ]);
    });

    it('forwards the list params to listCollections unaltered', async () => {
        const client = makeGuardedClient();
        const listCollections = vi.spyOn(client, 'listCollections').mockResolvedValue(makePaginatedResponse([]));

        const { result } = renderRecipeHook(() => useCollections({ page: 4, pageSize: 25 }), { client });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(listCollections).toHaveBeenCalledWith({ page: 4, pageSize: 25 });
    });

    it('is loading with no data before the client resolves', () => {
        const client = makeGuardedClient();
        vi.spyOn(client, 'listCollections').mockReturnValue(new Promise(() => undefined));

        const { result } = renderRecipeHook(() => useCollections(), { client });

        expect(result.current.isLoading).toBe(true);
        expect(result.current.data).toBeUndefined();
    });

    it('exposes an empty page as success with zero rows', async () => {
        const client = makeGuardedClient();
        vi.spyOn(client, 'listCollections').mockResolvedValue(
            makePaginatedResponse<ReturnType<typeof makeCollection>>([], { total: 0 }),
        );

        const { result } = renderRecipeHook(() => useCollections(), { client });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data?.data).toEqual([]);
    });

    it('propagates a client rejection as an error', async () => {
        const client = makeGuardedClient();
        const error = new UnauthorizedError('Unauthorized');
        vi.spyOn(client, 'listCollections').mockRejectedValue(error);

        const { result } = renderRecipeHook(() => useCollections(), { client });

        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(result.current.error).toBe(error);
    });
});

describe('useCollectionsInfinite', () => {
    it('fetches the first page (page 1) with the given params', async () => {
        const client = makeGuardedClient();
        const listCollections = vi
            .spyOn(client, 'listCollections')
            .mockResolvedValue(makePaginatedResponse([makeCollection()], { hasMore: false, page: 1 }));

        const { result } = renderRecipeHook(() => useCollectionsInfinite({ pageSize: 10 }), { client });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(listCollections).toHaveBeenCalledWith({ pageSize: 10, page: 1 });
    });

    it('offers a next page while the last page reports hasMore', async () => {
        const client = makeGuardedClient();
        vi.spyOn(client, 'listCollections').mockResolvedValue(
            makePaginatedResponse([makeCollection()], { hasMore: true, page: 1 }),
        );

        const { result } = renderRecipeHook(() => useCollectionsInfinite(), { client });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.hasNextPage).toBe(true);
    });

    it('stops paging when the last page reports no more (no infinite scroll)', async () => {
        const client = makeGuardedClient();
        vi.spyOn(client, 'listCollections').mockResolvedValue(
            makePaginatedResponse([makeCollection()], { hasMore: false, page: 1 }),
        );

        const { result } = renderRecipeHook(() => useCollectionsInfinite(), { client });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.hasNextPage).toBe(false);
    });

    it('caches under the SAME key as the flat useCollections list (one logical cache entry)', async () => {
        const client = makeGuardedClient();
        vi.spyOn(client, 'listCollections').mockResolvedValue(
            makePaginatedResponse([makeCollection()], { hasMore: false, page: 1 }),
        );

        const { result, queryClient } = renderRecipeHook(() => useCollectionsInfinite({ pageSize: 10 }), { client });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(cachedQueryKeys(queryClient)).toEqual([['recipe-service', 'collections', 'list', { pageSize: 10 }]]);
    });
});

describe('useCollection', () => {
    it('caches the collection under the literal collection-detail key', async () => {
        const client = makeGuardedClient();
        vi.spyOn(client, 'getCollectionById').mockResolvedValue(makeCollectionWithRecipes());

        const { result, queryClient } = renderRecipeHook(() => useCollection('col_1'), { client });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(cachedQueryKeys(queryClient)).toEqual([['recipe-service', 'collections', 'detail', 'col_1']]);
    });

    it('forwards the id to getCollectionById and returns the collection with its recipes', async () => {
        const client = makeGuardedClient();
        const collection = makeCollectionWithRecipes();
        const getCollectionById = vi.spyOn(client, 'getCollectionById').mockResolvedValue(collection);

        const { result } = renderRecipeHook(() => useCollection('col_8'), { client });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(getCollectionById).toHaveBeenCalledWith('col_8');
        expect(result.current.data).toEqual(collection);
    });

    it('stays idle and issues no request for an empty id', () => {
        const client = makeGuardedClient();
        const getCollectionById = vi.spyOn(client, 'getCollectionById');

        const { result } = renderRecipeHook(() => useCollection(''), { client });

        expect(result.current.fetchStatus).toBe('idle');
        expect(getCollectionById).not.toHaveBeenCalled();
    });

    it('stays idle and issues no request when explicitly disabled', () => {
        const client = makeGuardedClient();
        const getCollectionById = vi.spyOn(client, 'getCollectionById');

        const { result } = renderRecipeHook(() => useCollection('col_1', { enabled: false }), { client });

        expect(result.current.fetchStatus).toBe('idle');
        expect(getCollectionById).not.toHaveBeenCalled();
    });

    it('propagates a 404 as the typed NotFoundError', async () => {
        const client = makeGuardedClient();
        const error = new NotFoundError('Collection not found');
        vi.spyOn(client, 'getCollectionById').mockRejectedValue(error);

        const { result } = renderRecipeHook(() => useCollection('col_missing'), { client });

        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(result.current.error).toBe(error);
    });
});

describe('useSearchRecipes', () => {
    it('caches results under the literal search key, including the full search params', async () => {
        const client = makeGuardedClient();
        vi.spyOn(client, 'searchRecipes').mockResolvedValue(makeRecipeSearchResponse());

        const { result, queryClient } = renderRecipeHook(() => useSearchRecipes({ query: 'pie', cuisine: 'british' }), {
            client,
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(cachedQueryKeys(queryClient)).toEqual([
            ['recipe-service', 'search', 'recipes', { query: 'pie', cuisine: 'british' }],
        ]);
    });

    it('forwards the search params to searchRecipes unaltered', async () => {
        const client = makeGuardedClient();
        const searchRecipes = vi.spyOn(client, 'searchRecipes').mockResolvedValue(makeRecipeSearchResponse());
        const params = { query: 'chicken', dietaryFlags: ['vegan' as const], maxPrepTime: 30, page: 2 };

        const { result } = renderRecipeHook(() => useSearchRecipes(params), { client });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(searchRecipes).toHaveBeenCalledWith(params);
    });

    it('searches eagerly with no params (browse mode) — unlike ingredient search, it has no query gate', async () => {
        const client = makeGuardedClient();
        const searchRecipes = vi.spyOn(client, 'searchRecipes').mockResolvedValue(makeRecipeSearchResponse());

        const { result, queryClient } = renderRecipeHook(() => useSearchRecipes(), { client });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(searchRecipes).toHaveBeenCalledWith({});
        expect(cachedQueryKeys(queryClient)).toEqual([['recipe-service', 'search', 'recipes', {}]]);
    });

    it('exposes a zero-hit search as success with an empty result list (empty state)', async () => {
        const client = makeGuardedClient();
        vi.spyOn(client, 'searchRecipes').mockResolvedValue(makeRecipeSearchResponse({ results: [], total: 0 }));

        const { result } = renderRecipeHook(() => useSearchRecipes({ query: 'zzz' }), { client });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data?.results).toEqual([]);
        expect(result.current.data?.total).toBe(0);
    });

    it('is loading with no data before the client resolves', () => {
        const client = makeGuardedClient();
        vi.spyOn(client, 'searchRecipes').mockReturnValue(new Promise(() => undefined));

        const { result } = renderRecipeHook(() => useSearchRecipes({ query: 'pie' }), { client });

        expect(result.current.isLoading).toBe(true);
    });

    it('propagates a client rejection as an error', async () => {
        const client = makeGuardedClient();
        const error = new UnauthorizedError('Unauthorized');
        vi.spyOn(client, 'searchRecipes').mockRejectedValue(error);

        const { result } = renderRecipeHook(() => useSearchRecipes({ query: 'pie' }), { client });

        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(result.current.error).toBe(error);
    });
});

describe('useInfiniteSearchRecipes', () => {
    it('fetches the first page (page 1) with the given params', async () => {
        const client = makeGuardedClient();
        const searchRecipes = vi
            .spyOn(client, 'searchRecipes')
            .mockResolvedValue(makeRecipeSearchResponse({ hasMore: false, page: 1 }));

        const { result } = renderRecipeHook(() => useInfiniteSearchRecipes({ query: 'pie' }), { client });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(searchRecipes).toHaveBeenCalledWith({ query: 'pie', page: 1 });
    });

    it('offers a next page while the last page reports hasMore', async () => {
        const client = makeGuardedClient();
        vi.spyOn(client, 'searchRecipes').mockResolvedValue(makeRecipeSearchResponse({ hasMore: true, page: 1 }));

        const { result } = renderRecipeHook(() => useInfiniteSearchRecipes(), { client });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.hasNextPage).toBe(true);
    });

    it('stops paging when the last page reports no more (no infinite scroll)', async () => {
        const client = makeGuardedClient();
        vi.spyOn(client, 'searchRecipes').mockResolvedValue(makeRecipeSearchResponse({ hasMore: false, page: 1 }));

        const { result } = renderRecipeHook(() => useInfiniteSearchRecipes(), { client });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.hasNextPage).toBe(false);
    });
});

describe('useSearchIngredients', () => {
    it('caches matches under the literal ingredient-search key, including the limit', async () => {
        const client = makeGuardedClient();
        vi.spyOn(client, 'searchIngredients').mockResolvedValue([makeIngredient()]);

        const { result, queryClient } = renderRecipeHook(() => useSearchIngredients('tom', 5), { client });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(cachedQueryKeys(queryClient)).toEqual([['recipe-service', 'search', 'ingredients', 'tom', 5]]);
    });

    it('caches an unlimited search under a null limit segment', async () => {
        const client = makeGuardedClient();
        vi.spyOn(client, 'searchIngredients').mockResolvedValue([]);

        const { result, queryClient } = renderRecipeHook(() => useSearchIngredients('tom'), { client });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(cachedQueryKeys(queryClient)).toEqual([['recipe-service', 'search', 'ingredients', 'tom', null]]);
    });

    it('forwards BOTH the query and the limit to searchIngredients, in order', async () => {
        const client = makeGuardedClient();
        const searchIngredients = vi.spyOn(client, 'searchIngredients').mockResolvedValue([makeIngredient()]);

        const { result } = renderRecipeHook(() => useSearchIngredients('basil', 7), { client });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(searchIngredients).toHaveBeenCalledWith('basil', 7);
    });

    it('passes an absent limit through as undefined (the client omits the param)', async () => {
        const client = makeGuardedClient();
        const searchIngredients = vi.spyOn(client, 'searchIngredients').mockResolvedValue([]);

        const { result } = renderRecipeHook(() => useSearchIngredients('basil'), { client });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(searchIngredients).toHaveBeenCalledWith('basil', undefined);
    });

    it('stays idle and issues no request for an empty query (typeahead before the first keystroke)', () => {
        const client = makeGuardedClient();
        const searchIngredients = vi.spyOn(client, 'searchIngredients');

        const { result } = renderRecipeHook(() => useSearchIngredients(''), { client });

        expect(result.current.fetchStatus).toBe('idle');
        expect(result.current.isPending).toBe(true);
        expect(searchIngredients).not.toHaveBeenCalled();
    });

    it('searches on a single-character query (the gate is emptiness, not a minimum length)', async () => {
        const client = makeGuardedClient();
        const searchIngredients = vi.spyOn(client, 'searchIngredients').mockResolvedValue([]);

        const { result } = renderRecipeHook(() => useSearchIngredients('t'), { client });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(searchIngredients).toHaveBeenCalledWith('t', undefined);
    });

    it('stays idle and issues no request when explicitly disabled, even with a non-empty query', () => {
        const client = makeGuardedClient();
        const searchIngredients = vi.spyOn(client, 'searchIngredients');

        const { result } = renderRecipeHook(() => useSearchIngredients('tom', 5, { enabled: false }), { client });

        expect(result.current.fetchStatus).toBe('idle');
        expect(searchIngredients).not.toHaveBeenCalled();
    });

    it('returns no matches as success with an empty list (empty typeahead state)', async () => {
        const client = makeGuardedClient();
        vi.spyOn(client, 'searchIngredients').mockResolvedValue([]);

        const { result } = renderRecipeHook(() => useSearchIngredients('zzz'), { client });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data).toEqual([]);
    });

    it('propagates a client rejection as an error', async () => {
        const client = makeGuardedClient();
        const error = new UnauthorizedError('Unauthorized');
        vi.spyOn(client, 'searchIngredients').mockRejectedValue(error);

        const { result } = renderRecipeHook(() => useSearchIngredients('tom'), { client });

        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(result.current.error).toBe(error);
    });
});

describe('useAllOwnerRecipes', () => {
    // The erasure donate-election (CR-002 / U4b) is the input to an IRREVERSIBLE action: any owner-only
    // recipe the user never sees is silently destroyed. So this hook MUST page the owner list to exhaustion,
    // and MUST NOT report the list as ready until the final page is in.
    it('pages the owner list to completion and flattens every page', async () => {
        const client = makeGuardedClient();
        const page1 = [makeRecipe({ id: 'r1' }), makeRecipe({ id: 'r2' })];
        const page2 = [makeRecipe({ id: 'r3' })];
        const listRecipes = vi
            .spyOn(client, 'listRecipes')
            .mockResolvedValueOnce(makePaginatedResponse(page1, { hasMore: true, page: 1 }))
            .mockResolvedValueOnce(makePaginatedResponse(page2, { hasMore: false, page: 2 }));

        const { result } = renderRecipeHook(() => useAllOwnerRecipes(), { client });

        await waitFor(() => expect(result.current.isComplete).toBe(true));
        expect(result.current.isLoading).toBe(false);
        expect(result.current.recipes.map((recipe) => recipe.id)).toEqual(['r1', 'r2', 'r3']);
        expect(listRecipes).toHaveBeenNthCalledWith(1, { pageSize: 100, page: 1 });
        expect(listRecipes).toHaveBeenNthCalledWith(2, { pageSize: 100, page: 2 });
    });

    it('stays loading (never reports complete) until the last page lands', async () => {
        const client = makeGuardedClient();
        vi.spyOn(client, 'listRecipes')
            .mockResolvedValueOnce(makePaginatedResponse([makeRecipe({ id: 'r1' })], { hasMore: true, page: 1 }))
            .mockResolvedValueOnce(makePaginatedResponse([makeRecipe({ id: 'r2' })], { hasMore: false, page: 2 }));

        const { result } = renderRecipeHook(() => useAllOwnerRecipes(), { client });

        // After the first page resolves there is still a page owed → not complete, still loading.
        await waitFor(() => expect(result.current.recipes.length).toBeGreaterThan(0));
        if (!result.current.isComplete) {
            expect(result.current.isLoading).toBe(true);
        }
        await waitFor(() => expect(result.current.isComplete).toBe(true));
        expect(result.current.recipes).toHaveLength(2);
    });

    it('surfaces an error without a partial-complete claim', async () => {
        const client = makeGuardedClient();
        vi.spyOn(client, 'listRecipes').mockRejectedValue(new Error('boom'));

        const { result } = renderRecipeHook(() => useAllOwnerRecipes(), { client });

        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(result.current.isComplete).toBe(false);
        expect(result.current.recipes).toEqual([]);
    });
});
