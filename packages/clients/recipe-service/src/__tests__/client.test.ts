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
    PullDriftError,
    RecipeServiceClient,
    UnauthorizedError,
    VersionConflictError,
    isGoneError,
    isPullDriftError,
    isVersionConflictError,
} from '../index.js';
import { makeCreateRecipeRequest, makePullDiff, makeRecipeDetail } from '../__fixtures__/recipes.js';
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

    it('honors maxIdentitySyncRetries: 0 (never retries the sync-pending case)', async () => {
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

describe('RecipeServiceClient — expired-token 401 force-refresh + bounded retry (B22)', () => {
    const instantSleep = (): Promise<void> => Promise.resolve();

    it('force-refreshes the token and retries ONCE on an ordinary expired-token 401, succeeding on the retry', async () => {
        const recipe = makeRecipeDetail({ id: 'rec_1', ownerId: 'usr_1', title: 'Soup' });
        const fetchMock = sequenceFetch([
            { status: 401, body: { code: 'TOKEN_EXPIRED', message: 'jwt expired' } },
            { status: 200, body: recipe },
        ]);
        const forceRefreshFlags: (boolean | undefined)[] = [];
        const getToken = vi.fn((opts?: { forceRefresh?: boolean }) => {
            forceRefreshFlags.push(opts?.forceRefresh);

            return opts?.forceRefresh === true ? 'fresh-tok' : 'stale-tok';
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
        // First attempt uses the (possibly stale) cached token; the retry forces a fresh mint.
        expect(forceRefreshFlags).toEqual([false, true]);
        expect(requestAt(fetchMock, 1).headers.get('authorization')).toBe('Bearer fresh-tok');
    });

    it('surfaces UnauthorizedError with NO third attempt when the refreshed token ALSO 401s (bounded, no loop)', async () => {
        const fetchMock = sequenceFetch([
            { status: 401, body: { code: 'TOKEN_EXPIRED', message: 'jwt expired' } },
            { status: 401, body: { code: 'TOKEN_EXPIRED', message: 'jwt expired' } },
        ]);
        const client = new RecipeServiceClient({ baseUrl: BASE, token: 'tok', fetch: fetchMock, sleep: instantSleep });

        await expect(client.getRecipeById('rec_1')).rejects.toBeInstanceOf(UnauthorizedError);
        // 1 initial + 1 bounded retry — the persistent-failure double would keep returning 401 forever if
        // this looped, so a length of exactly 2 proves the retry is bounded.
        expect(callsOf(fetchMock)).toHaveLength(2);
    });

    it('treats a 401 with NO body/code as ordinary too (still one bounded retry, not zero)', async () => {
        const recipe = makeRecipeDetail({ id: 'rec_1', ownerId: 'usr_1', title: 'Soup' });
        const fetchMock = sequenceFetch([{ status: 401 }, { status: 200, body: recipe }]);
        const client = new RecipeServiceClient({ baseUrl: BASE, token: 'tok', fetch: fetchMock, sleep: instantSleep });

        await expect(client.getRecipeById('rec_1')).resolves.toEqual(recipe);
        expect(callsOf(fetchMock)).toHaveLength(2);
    });

    it('leaves a non-401 error path unaffected (no extra retry)', async () => {
        const fetchMock = sequenceFetch([{ status: 403, body: { code: 'FORBIDDEN', message: 'nope' } }]);
        const client = new RecipeServiceClient({ baseUrl: BASE, token: 'tok', fetch: fetchMock, sleep: instantSleep });

        await expect(client.getRecipeById('rec_1')).rejects.toBeInstanceOf(ForbiddenError);
        expect(callsOf(fetchMock)).toHaveLength(1);
    });
});

describe('RecipeServiceClient — request build + token attach', () => {
    it('POSTs create-recipe to the right URL with a JSON body and a literal bearer token', async () => {
        const created = makeRecipeDetail({ id: 'rec_1', ownerId: 'usr_1', title: 'Soup' });
        const fetchMock = stubFetch(201, created);
        const client = new RecipeServiceClient({ baseUrl: `${BASE}/`, token: 'tok-123', fetch: fetchMock });

        // Built from the fixture factory rather than spelled inline: the client validates its OUTBOUND body
        // against `createRecipeRequestSchema`, whose `ingredients`/`steps` are both `.min(1)`, so the empty
        // arrays this used to send were a body the service answers `400` to — the assertion below would have
        // pinned a request that could never have succeeded in production.
        const input = makeCreateRecipeRequest({
            title: 'Soup',
            servings: 2,
            prepTimeMinutes: 5,
            cookTimeMinutes: 10,
            totalTimeMinutes: 15,
        });
        const result = await client.createRecipe(input);

        expect(result).toEqual(created);
        const req = requestAt(fetchMock);
        expect(req.url).toBe(`${BASE}/api/v1/recipes`); // trailing slash on baseUrl normalized
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
        expect(req.url).toBe(`${BASE}/api/v1/ingredients/search?q=kale`);
        expect(req.headers.get('authorization')).toBeNull();
    });

    it('serializes list params and repeats array query params (search facets)', async () => {
        // `facets: {}` here until `searchRecipes` began validating its response against the published
        // `recipeSearchResponseSchema` — which caught it. All four facet dimensions are REQUIRED on the wire
        // (the server always aggregates all four over the match sample; an empty dimension is `[]`, never an
        // absent key — see `search.schema.ts`), so the old stub asserted a body the service never sends.
        const fetchMock = stubFetch(200, {
            results: [],
            total: 0,
            page: 1,
            pageSize: 20,
            hasMore: false,
            facets: { dietaryFlags: [], tags: [], cuisine: [], totalTime: [] },
        });
        const client = new RecipeServiceClient({ baseUrl: BASE, fetch: fetchMock });

        await client.searchRecipes({ query: 'chicken pie', dietaryFlags: ['vegan', 'gluten_free'], page: 2 });

        expect(requestAt(fetchMock).url).toBe(
            `${BASE}/api/v1/search/recipes?query=chicken+pie&dietaryFlags=vegan&dietaryFlags=gluten_free&page=2`,
        );
    });

    it('encodes path ids and returns void on a 204 delete', async () => {
        const fetchMock = stubFetch(204);
        const client = new RecipeServiceClient({ baseUrl: BASE, token: 't', fetch: fetchMock });

        await expect(client.deleteRecipe('rec/1')).resolves.toBeUndefined();

        const req = requestAt(fetchMock);
        expect(req.url).toBe(`${BASE}/api/v1/recipes/rec%2F1`);
        expect(req.method).toBe('DELETE');
    });
});

describe('RecipeServiceClient — the served impact counts survive the client parse (ADR-0030 §8)', () => {
    it('getRecipeById PRESERVES impact — the non-strict detail schema must not strip the new field', async () => {
        // The exact regression class viewerRating suffered: a schema without the field's line would
        // parse successfully and SILENTLY strip the counts the server served.
        const detail = makeRecipeDetail({ id: 'rec_1', ownerId: 'usr_1', title: 'Soup' });
        const served = { ...detail, impact: { saveCount: 3, viewCount: 7 } };
        const fetchMock = stubFetch(200, served);
        const client = new RecipeServiceClient({ baseUrl: BASE, token: 'tok-123', fetch: fetchMock });

        const result = await client.getRecipeById('rec_1');

        expect(result.impact).toEqual({ saveCount: 3, viewCount: 7 });
    });

    it('tolerates an ABSENT impact — old servers and the degrade path omit it', async () => {
        const fetchMock = stubFetch(200, makeRecipeDetail({ id: 'rec_1', ownerId: 'usr_1', title: 'Soup' }));
        const client = new RecipeServiceClient({ baseUrl: BASE, token: 'tok-123', fetch: fetchMock });

        const result = await client.getRecipeById('rec_1');

        expect(result.impact).toBeUndefined();
    });
});

describe('RecipeServiceClient — analytics ingest door (analytics plan U5)', () => {
    const batch = {
        events: [
            {
                type: 'query_outcome' as const,
                eventId: '99999999-9999-4999-8999-000000000a01',
                occurredAt: '2026-09-01T12:00:00.000Z',
                query: 'salt',
                served: [{ group: 'catalog' as const, label: 'Salt, table', foodId: 'food-1' }],
                outcome: { kind: 'no_pick' as const },
            },
        ],
    };

    it('POSTs the batch to /ingest/v1/events with the bearer and keepalive (the leave-the-screen moment)', async () => {
        const fetchMock = stubFetch(202, { accepted: 1, landed: 1 });
        const client = new RecipeServiceClient({ baseUrl: BASE, token: 'tok-123', fetch: fetchMock });

        await client.emitAnalyticsEvents(batch);

        const req = requestAt(fetchMock);
        expect(req.url).toBe(`${BASE}/ingest/v1/events`);
        expect(req.method).toBe('POST');
        expect(req.headers.get('authorization')).toBe('Bearer tok-123');
        expect(req.headers.get('content-type')).toBe('application/json');
        expect(JSON.parse(req.body as string)).toEqual(batch);
        // The keepalive flag is what lets a web flush survive navigation (KTD4b). RN ignores it — recorded
        // in the emitter's docstring, and harmless here. Read off the Request itself: the client builds
        // one so the double's `callsOf` recognizes the call.
        const rawRequest = callsOf(fetchMock)[0]?.[0];
        expect(rawRequest?.keepalive).toBe(true);
    });

    it('throws on a non-2xx so the CALLER decides to swallow — the transport never hides an outcome', async () => {
        const fetchMock = stubFetch(429, { code: 'RATE_LIMITED', message: 'slow down' });
        const client = new RecipeServiceClient({ baseUrl: BASE, token: 'tok-123', fetch: fetchMock });

        await expect(client.emitAnalyticsEvents(batch)).rejects.toThrow();
        // At-most-once (origin R11): exactly one attempt, no retry machinery.
        expect(callsOf(fetchMock)).toHaveLength(1);
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
        // A bare (un-enriched) body leaves the snapshot sides undefined.
        expect((error as VersionConflictError).server).toBeUndefined();
        expect((error as VersionConflictError).base).toBeUndefined();
    });

    it('409 → VersionConflictError carrying the ENRICHED server + base snapshots (W8-a.5)', async () => {
        const side = (versionNumber: number, title: string) => ({
            versionNumber,
            updatedAt: '2026-07-19T00:00:00.000Z',
            snapshot: {
                version: versionNumber,
                title,
                description: '',
                steps: [],
                ingredients: [],
                servings: 2,
                prepTimeMinutes: 1,
                cookTimeMinutes: 1,
            },
        });
        const client = new RecipeServiceClient({
            baseUrl: BASE,
            fetch: stubFetch(409, {
                code: 'VERSION_CONFLICT',
                message: 'Recipe version conflict',
                details: {
                    currentVersion: 7,
                    conflictingVersion: 5,
                    server: side(7, 'Server title'),
                    base: side(5, 'Base title'),
                },
            }),
        });

        const error = await client
            .updateRecipe('rec_1', { expectedVersion: 5, title: 'New' })
            .catch((caught: unknown) => caught);

        expect(isVersionConflictError(error)).toBe(true);
        const conflict = error as VersionConflictError;
        expect(conflict.server?.versionNumber).toBe(7);
        expect(conflict.server?.snapshot.title).toBe('Server title');
        // The per-side metadata the enriched body still carries. `deviceLabel` was asserted here until the
        // 2026-08-26 owner ruling deleted it; `updatedAt` is what remains beside the version number, and it
        // is what the conflict banner's relative time is computed from.
        expect(conflict.server?.updatedAt).toBe('2026-07-19T00:00:00.000Z');
        expect(conflict.base?.versionNumber).toBe(5);
        expect(conflict.base?.snapshot.title).toBe('Base title');
    });

    it('409 PULL_DRIFT → PullDriftError carrying the fresh diff (NOT VersionConflictError)', async () => {
        const diff = makePullDiff({ added: ['rec_9'], removed: ['rec_3'], unchanged: ['rec_1'] });
        const client = new RecipeServiceClient({
            baseUrl: BASE,
            fetch: stubFetch(409, {
                code: 'PULL_DRIFT',
                message: 'The source changed since you previewed this pull.',
                details: { collectionId: 'col_1', diff },
            }),
        });

        const error = await client
            .pullCollectionFromSource('col_1', { previewedDiff: makePullDiff({ added: [] }) })
            .catch((caught: unknown) => caught);

        expect(isPullDriftError(error)).toBe(true);
        expect(isVersionConflictError(error)).toBe(false);
        expect((error as PullDriftError).diff).toEqual(diff);
        expect((error as PullDriftError).status).toBe(409);
        expect((error as PullDriftError).code).toBe('PULL_DRIFT');
    });

    it('409 VERSION_CONFLICT (recipe update) STILL maps to VersionConflictError — regression guard', async () => {
        // Pins that adding the PULL_DRIFT branch to the shared 409 dispatch did not divert the
        // pre-existing version-conflict path onto it.
        const client = new RecipeServiceClient({
            baseUrl: BASE,
            fetch: stubFetch(409, {
                code: 'VERSION_CONFLICT',
                message: 'Recipe version conflict',
                details: { currentVersion: 3, conflictingVersion: 2 },
            }),
        });

        const error = await client
            .updateRecipe('rec_1', { expectedVersion: 2, title: 'New' })
            .catch((caught: unknown) => caught);

        expect(isVersionConflictError(error)).toBe(true);
        expect(isPullDriftError(error)).toBe(false);
        expect((error as VersionConflictError).currentVersion).toBe(3);
        expect((error as VersionConflictError).conflictingVersion).toBe(2);
    });

    it('410 → GoneError (account already erased)', async () => {
        const client = new RecipeServiceClient({
            baseUrl: BASE,
            fetch: stubFetch(410, { code: 'ALREADY_ERASED', message: 'Account has already been erased' }),
        });

        const error = await client
            .requestAccountErasure({ confirmationPhrase: 'ERASE MY DATA' })
            .catch((caught: unknown) => caught);

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
        expect(req.url).toBe(`${BASE}/api/v1/recipes/rec_1`);
        expect(req.method).toBe('PATCH');
        expect(JSON.parse(req.body as string)).toEqual({ expectedVersion: 5, title: 'New' });
    });
});
