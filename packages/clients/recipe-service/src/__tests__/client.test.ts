/**
 * Unit tests for {@link RecipeServiceClient} (T-004 / T-095) with a mocked `fetch`: request build (URL,
 * method, body, bearer-token attach from a literal and a callback, query-string serialization) + status
 * mapping (`201`/`200`/`204`/`202` → typed results; `400`/`401`/`403`/`404`/`409`/`410` → typed errors).
 *
 * The client drives HTTP through `ky`, which invokes the injected `fetch` with a `Request` object (not a
 * `(url, init)` pair). These tests therefore assert the *observable* request a fake fetch receives — the
 * `Request`'s URL, method, headers, and body — via {@link requestAt}. The request body is captured at
 * call time because ky cancels the request body stream once the call settles.
 */
import { describe, expect, it, vi } from 'vitest';
import { IDENTITY_SYNC_PENDING_CODE } from '@kitchensink/recipe-core';

import {
    BadRequestError,
    ForbiddenError,
    GoneError,
    NotFoundError,
    RecipeServiceClient,
    UnauthorizedError,
    VersionConflictError,
    isGoneError,
    isVersionConflictError,
} from '../index.js';
import { makeRecipeDetail } from '../__fixtures__/recipes.js';
import { callsOf, requestAt, sequenceFetch, stubFetch } from './utils/fetchDouble.js';

const BASE = 'https://recipes.example.test';

describe('RecipeServiceClient — first-token sync-race retry', () => {
    const instantSleep = (): Promise<void> => Promise.resolve();
    const SYNC_PENDING = { code: IDENTITY_SYNC_PENDING_CODE, message: 'identity not yet available' };

    it('retries a 401 IDENTITY_SYNC_PENDING with a force-refreshed token, then succeeds', async () => {
        const recipe = makeRecipeDetail({ id: 'rec_1', ownerId: 'usr_1', title: 'Soup' });
        const fetchMock = sequenceFetch([
            { status: 401, body: SYNC_PENDING },
            { status: 200, body: recipe },
        ]);
        const forceRefreshFlags: (boolean | undefined)[] = [];
        const getToken = vi.fn((opts?: { forceRefresh?: boolean }) => {
            forceRefreshFlags.push(opts?.forceRefresh);

            return 'tok';
        });
        const client = new RecipeServiceClient({
            baseUrl: BASE,
            token: getToken,
            fetch: fetchMock,
            sleep: instantSleep,
        });

        const result = await client.getRecipeById('rec_1');

        expect(result).toEqual(recipe);
        expect(callsOf(fetchMock)).toHaveLength(2);
        // First attempt uses the cached token; the retry forces a fresh mint.
        expect(forceRefreshFlags).toEqual([false, true]);
    });

    it('exhausts retries on persistent IDENTITY_SYNC_PENDING and throws UnauthorizedError', async () => {
        const fetchMock = sequenceFetch([{ status: 401, body: SYNC_PENDING }]);
        const client = new RecipeServiceClient({
            baseUrl: BASE,
            token: 'tok',
            fetch: fetchMock,
            maxIdentitySyncRetries: 2,
            sleep: instantSleep,
        });

        await expect(client.getRecipeById('rec_1')).rejects.toBeInstanceOf(UnauthorizedError);
        expect(callsOf(fetchMock)).toHaveLength(3); // 1 initial + 2 retries
    });

    it('does NOT retry a plain 401 (no IDENTITY_SYNC_PENDING code)', async () => {
        const fetchMock = sequenceFetch([{ status: 401, body: { code: 'UNAUTHORIZED', message: 'nope' } }]);
        const client = new RecipeServiceClient({ baseUrl: BASE, token: 'tok', fetch: fetchMock, sleep: instantSleep });

        await expect(client.getRecipeById('rec_1')).rejects.toBeInstanceOf(UnauthorizedError);
        expect(callsOf(fetchMock)).toHaveLength(1);
    });

    it('honors maxIdentitySyncRetries: 0 (never retries)', async () => {
        const fetchMock = sequenceFetch([{ status: 401, body: SYNC_PENDING }]);
        const client = new RecipeServiceClient({
            baseUrl: BASE,
            token: 'tok',
            fetch: fetchMock,
            maxIdentitySyncRetries: 0,
            sleep: instantSleep,
        });

        await expect(client.getRecipeById('rec_1')).rejects.toBeInstanceOf(UnauthorizedError);
        expect(callsOf(fetchMock)).toHaveLength(1);
    });
});

describe('RecipeServiceClient — request build + token attach', () => {
    it('POSTs create-recipe to the right URL with a JSON body and a literal bearer token', async () => {
        const created = makeRecipeDetail({ id: 'rec_1', ownerId: 'usr_1', title: 'Soup' });
        const fetchMock = stubFetch(201, created);
        const client = new RecipeServiceClient({ baseUrl: `${BASE}/`, token: 'tok-123', fetch: fetchMock });

        const input = {
            title: 'Soup',
            ingredients: [],
            steps: [],
            servings: 2,
            prepTimeMinutes: 5,
            cookTimeMinutes: 10,
            totalTimeMinutes: 15,
        };
        const result = await client.createRecipe(input);

        expect(result).toEqual(created);
        const req = requestAt(fetchMock);
        expect(req.url).toBe(`${BASE}/v1/recipes`); // trailing slash on baseUrl normalized
        expect(req.method).toBe('POST');
        expect(req.headers.get('authorization')).toBe('Bearer tok-123');
        expect(req.headers.get('content-type')).toBe('application/json');
        expect(JSON.parse(req.body as string)).toEqual(input);
    });

    it('re-reads a token callback per request (rotated session token)', async () => {
        const tokens = ['tok-A', 'tok-B'];
        const getToken = vi.fn(() => tokens.shift() ?? 'tok-exhausted');
        const fetchMock = stubFetch(200, { data: [], total: 0, page: 1, pageSize: 20, hasMore: false });
        const client = new RecipeServiceClient({ baseUrl: BASE, token: getToken, fetch: fetchMock });

        await client.listRecipes();
        await client.listRecipes();

        expect(requestAt(fetchMock, 0).headers.get('authorization')).toBe('Bearer tok-A');
        expect(requestAt(fetchMock, 1).headers.get('authorization')).toBe('Bearer tok-B');
        expect(getToken).toHaveBeenCalledTimes(2);
    });

    it('omits Authorization when no token is configured', async () => {
        const fetchMock = stubFetch(200, []);
        const client = new RecipeServiceClient({ baseUrl: BASE, fetch: fetchMock });

        await client.searchIngredients('kale');

        const req = requestAt(fetchMock);
        expect(req.url).toBe(`${BASE}/v1/ingredients/search?q=kale`);
        expect(req.headers.get('authorization')).toBeNull();
    });

    it('serializes list params and repeats array query params (search facets)', async () => {
        const fetchMock = stubFetch(200, {
            results: [],
            total: 0,
            page: 1,
            pageSize: 20,
            hasMore: false,
            facets: {},
        });
        const client = new RecipeServiceClient({ baseUrl: BASE, fetch: fetchMock });

        await client.searchRecipes({ query: 'chicken pie', dietaryFlags: ['vegan', 'gluten_free'], page: 2 });

        expect(requestAt(fetchMock).url).toBe(
            `${BASE}/v1/search/recipes?query=chicken+pie&dietaryFlags=vegan&dietaryFlags=gluten_free&page=2`,
        );
    });

    it('encodes path ids and returns void on a 204 delete', async () => {
        const fetchMock = stubFetch(204);
        const client = new RecipeServiceClient({ baseUrl: BASE, token: 't', fetch: fetchMock });

        await expect(client.deleteRecipe('rec/1')).resolves.toBeUndefined();

        const req = requestAt(fetchMock);
        expect(req.url).toBe(`${BASE}/v1/recipes/rec%2F1`);
        expect(req.method).toBe('DELETE');
    });
});

describe('RecipeServiceClient — status → typed error mapping', () => {
    it('400 → BadRequestError carrying the domain code', async () => {
        const client = new RecipeServiceClient({
            baseUrl: BASE,
            fetch: stubFetch(400, { code: 'COLLECTION_NOT_CLONED', message: 'No source' }),
        });

        const error = await client.pullCollectionFromSource('col_1').catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(BadRequestError);
        expect((error as BadRequestError).code).toBe('COLLECTION_NOT_CLONED');
    });

    it('401 → UnauthorizedError', async () => {
        const client = new RecipeServiceClient({ baseUrl: BASE, fetch: stubFetch(401, { code: 'UNAUTHORIZED' }) });
        await expect(client.getRecipeById('rec_1')).rejects.toBeInstanceOf(UnauthorizedError);
    });

    it('403 → ForbiddenError (not owner)', async () => {
        const client = new RecipeServiceClient({ baseUrl: BASE, fetch: stubFetch(403, { code: 'NOT_OWNER' }) });
        await expect(client.deleteRecipe('rec_1')).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('404 → NotFoundError', async () => {
        const client = new RecipeServiceClient({ baseUrl: BASE, fetch: stubFetch(404, { code: 'RECIPE_NOT_FOUND' }) });
        await expect(client.getRecipeById('rec_missing')).rejects.toBeInstanceOf(NotFoundError);
    });

    it('409 → VersionConflictError carrying current + conflicting versions', async () => {
        const client = new RecipeServiceClient({
            baseUrl: BASE,
            fetch: stubFetch(409, {
                code: 'VERSION_CONFLICT',
                message: 'Recipe version conflict',
                details: { currentVersion: 7, conflictingVersion: 5 },
            }),
        });

        const error = await client
            .updateRecipe('rec_1', { expectedVersion: 5, title: 'New' })
            .catch((caught: unknown) => caught);

        expect(isVersionConflictError(error)).toBe(true);
        expect((error as VersionConflictError).currentVersion).toBe(7);
        expect((error as VersionConflictError).conflictingVersion).toBe(5);
    });

    it('410 → GoneError (account already erased)', async () => {
        const client = new RecipeServiceClient({
            baseUrl: BASE,
            fetch: stubFetch(410, { code: 'ALREADY_ERASED', message: 'Account has already been erased' }),
        });

        const error = await client.requestAccountErasure().catch((caught: unknown) => caught);

        expect(isGoneError(error)).toBe(true);
        expect((error as GoneError).status).toBe(410);
    });

    it('PATCH update sends the body and returns the updated recipe on 200', async () => {
        const updated = makeRecipeDetail({ id: 'rec_1', title: 'New', currentVersion: 6 });
        const fetchMock = stubFetch(200, updated);
        const client = new RecipeServiceClient({ baseUrl: BASE, token: 't', fetch: fetchMock });

        const result = await client.updateRecipe('rec_1', { expectedVersion: 5, title: 'New' });

        expect(result).toEqual(updated);
        const req = requestAt(fetchMock);
        expect(req.url).toBe(`${BASE}/v1/recipes/rec_1`);
        expect(req.method).toBe('PATCH');
        expect(JSON.parse(req.body as string)).toEqual({ expectedVersion: 5, title: 'New' });
    });
});
