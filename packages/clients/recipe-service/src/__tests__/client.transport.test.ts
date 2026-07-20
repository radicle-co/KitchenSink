/**
 * Cross-cutting transport tests for {@link RecipeServiceClient}: the identity-sync retry's backoff
 * schedule + request replay, status→error mapping edges (unexpected status, empty error body), and
 * degenerate response bodies (empty, malformed, network failure) plus empty result lists. These probe
 * the shared `send`/`sendOnce`/`normalizeResponse`/`toError` path that every public method funnels
 * through. Transport is a mocked `fetch`; no real network is touched.
 */
import { describe, expect, it, vi } from 'vitest';
import { IDENTITY_SYNC_PENDING_CODE } from '@kitchensink/recipe-core';

import {
    ForbiddenError,
    RecipeServiceClient,
    UnauthorizedError,
    UnexpectedResponseError,
    isRecipeServiceClientError,
} from '../index.js';
import { makePaginatedResponse, makeRecipeDetail } from '../__fixtures__/recipes.js';
import { callsOf, rejectingFetch, requestAt, sequenceFetch, stubFetch } from './utils/fetchDouble.js';

const BASE = 'https://recipes.example.test';
const SYNC_PENDING = { code: IDENTITY_SYNC_PENDING_CODE, message: 'identity not yet available' };

/** A sleep double that records each requested backoff (ms) instead of waiting. */
function recordingSleep(): { sleep: (ms: number) => Promise<void>; waits: number[] } {
    const waits: number[] = [];

    return {
        waits,
        sleep: async (ms: number): Promise<void> => {
            waits.push(ms);
        },
    };
}

describe('RecipeServiceClient — identity-sync retry backoff + replay', () => {
    it('walks the configured backoff and REPEATS the last entry when retries exceed it', async () => {
        const { sleep, waits } = recordingSleep();
        const fetchMock = sequenceFetch([{ status: 401, body: SYNC_PENDING }]); // persistent sync-pending
        const client = new RecipeServiceClient({
            baseUrl: BASE,
            token: 'tok',
            fetch: fetchMock,
            maxIdentitySyncRetries: 3,
            identitySyncBackoffMs: [10, 20],
            sleep,
        });

        await expect(client.getRecipeById('rec_1')).rejects.toBeInstanceOf(UnauthorizedError);

        // 1 initial + 3 retries; backoff walks [10, 20] then repeats the last (20) for the 3rd retry.
        expect(callsOf(fetchMock)).toHaveLength(4);
        expect(waits).toEqual([10, 20, 20]);
    });

    it('uses the default backoff [250, 500, 1000] for the default 3 retries', async () => {
        const { sleep, waits } = recordingSleep();
        const fetchMock = sequenceFetch([{ status: 401, body: SYNC_PENDING }]);
        const client = new RecipeServiceClient({ baseUrl: BASE, token: 'tok', fetch: fetchMock, sleep });

        await expect(client.getRecipeById('rec_1')).rejects.toBeInstanceOf(UnauthorizedError);

        expect(callsOf(fetchMock)).toHaveLength(4);
        expect(waits).toEqual([250, 500, 1000]);
    });

    it('force-refreshes the token on EVERY retry (false first, true thereafter)', async () => {
        const { sleep } = recordingSleep();
        const flags: (boolean | undefined)[] = [];
        const getToken = vi.fn((opts?: { forceRefresh?: boolean }) => {
            flags.push(opts?.forceRefresh);

            return 'tok';
        });
        const fetchMock = sequenceFetch([
            { status: 401, body: SYNC_PENDING },
            { status: 401, body: SYNC_PENDING },
            { status: 200, body: makeRecipeDetail({ id: 'rec_1' }) },
        ]);
        const client = new RecipeServiceClient({ baseUrl: BASE, token: getToken, fetch: fetchMock, sleep });

        await client.getRecipeById('rec_1');

        expect(flags).toEqual([false, true, true]);
    });

    it('replays the SAME method, body, and query on a retried POST (the create is not dropped)', async () => {
        const { sleep } = recordingSleep();
        const fetchMock = sequenceFetch([
            { status: 401, body: SYNC_PENDING },
            { status: 201, body: makeRecipeDetail({ id: 'rec_new' }) },
        ]);
        const client = new RecipeServiceClient({ baseUrl: BASE, token: 'tok', fetch: fetchMock, sleep });
        const input = {
            title: 'Soup',
            ingredients: [],
            steps: [],
            servings: 2,
            prepTimeMinutes: 5,
            cookTimeMinutes: 10,
            totalTimeMinutes: 15,
        };

        await client.createRecipe(input);

        const first = requestAt(fetchMock, 0);
        const retried = requestAt(fetchMock, 1);
        expect(retried.method).toBe('POST');
        expect(retried.url).toBe(first.url);
        expect(JSON.parse(retried.body as string)).toEqual(input);
    });

    it('does NOT retry a non-401 failure (e.g. 409) even if a later call would differ', async () => {
        const { sleep, waits } = recordingSleep();
        const fetchMock = sequenceFetch([
            { status: 409, body: { code: 'VERSION_CONFLICT', details: { currentVersion: 2 } } },
            { status: 200, body: makeRecipeDetail({ id: 'rec_1' }) },
        ]);
        const client = new RecipeServiceClient({ baseUrl: BASE, token: 'tok', fetch: fetchMock, sleep });

        await expect(client.updateRecipe('rec_1', { expectedVersion: 1 })).rejects.toBeInstanceOf(Error);
        expect(callsOf(fetchMock)).toHaveLength(1);
        expect(waits).toEqual([]);
    });

    it('does not retry a successful first response (happy path issues exactly one request)', async () => {
        const fetchMock = stubFetch(200, makeRecipeDetail({ id: 'rec_1' }));
        const client = new RecipeServiceClient({ baseUrl: BASE, token: 'tok', fetch: fetchMock });

        await client.getRecipeById('rec_1');

        expect(callsOf(fetchMock)).toHaveLength(1);
    });
});

describe('RecipeServiceClient — async token source', () => {
    it('awaits an async token callback and attaches the resolved bearer token', async () => {
        const fetchMock = stubFetch(200, makeRecipeDetail({ id: 'rec_1' }));
        const getToken = vi.fn(async () => Promise.resolve('async-tok'));
        const client = new RecipeServiceClient({ baseUrl: BASE, token: getToken, fetch: fetchMock });

        await client.getRecipeById('rec_1');

        expect(requestAt(fetchMock).headers.get('authorization')).toBe('Bearer async-tok');
    });
});

describe('RecipeServiceClient — status → error mapping edges', () => {
    it('maps an unmapped status (500) to UnexpectedResponseError carrying the status', async () => {
        const client = new RecipeServiceClient({ baseUrl: BASE, fetch: stubFetch(500, { message: 'boom' }) });

        const error = await client.getRecipeById('rec_1').catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(UnexpectedResponseError);
        expect((error as UnexpectedResponseError).status).toBe(500);
    });

    it('maps an error status with an EMPTY body to the typed error with default message and no code', async () => {
        const client = new RecipeServiceClient({ baseUrl: BASE, fetch: stubFetch(403) });

        const error = await client.deleteRecipe('rec_1').catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(ForbiddenError);
        expect((error as ForbiddenError).message).toBe('Forbidden');
        expect((error as ForbiddenError).code).toBeUndefined();
    });

    it('maps a non-2xx response with a NON-JSON body (e.g. an ALB 502 HTML page) to a typed error, not a raw SyntaxError', async () => {
        // The shared internet-facing ALB emits an HTML/plaintext body for 502/503/504 during every
        // deploy; JSON.parse-ing it used to throw a raw SyntaxError that bypassed the typed-error map.
        const html502 = vi.fn(
            async () => new Response('<html><body>502 Bad Gateway</body></html>', { status: 502 }),
        ) as unknown as typeof fetch;
        const client = new RecipeServiceClient({ baseUrl: BASE, fetch: html502 });

        const error = await client.getRecipeById('rec_1').catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(UnexpectedResponseError);
        expect((error as UnexpectedResponseError).status).toBe(502);
        expect(isRecipeServiceClientError(error)).toBe(true);
    });
});

describe('RecipeServiceClient — degenerate response bodies', () => {
    it('rejects an empty 200 body for a schema-backed endpoint (parse, not cast — DA1)', async () => {
        // A 200 with no body violates the wire contract (getRecipeById MUST return a recipe). The old
        // cast silently returned `undefined` — a mystery that surfaced deep in a component; the schema
        // now fails loudly at the boundary instead. (204/void endpoints go through expectNoContent and
        // are unaffected — see the 204-delete test.)
        const emptyOk = vi.fn(async () => new Response(undefined, { status: 200 })) as unknown as typeof fetch;
        const client = new RecipeServiceClient({ baseUrl: BASE, fetch: emptyOk });

        await expect(client.getRecipeById('rec_1')).rejects.toThrow();
    });

    it('rejects a 2xx body that is valid JSON but violates the schema shape (DA1 validates shape, not just JSON)', async () => {
        // The exact failure DA1 exists to catch: a server that drifted from @kitchensink/recipe-core
        // sends a well-formed JSON object with the wrong shape (here: missing required fields, and an
        // out-of-range averageRating). The old `as RecipeDetail` cast let it through to crash a component
        // deep downstream; the schema now rejects it at the boundary.
        const driftedShape = vi.fn(
            async () => new Response(JSON.stringify({ id: 'rec_1', averageRating: 99 }), { status: 200 }),
        ) as unknown as typeof fetch;
        const client = new RecipeServiceClient({ baseUrl: BASE, fetch: driftedShape });

        await expect(client.getRecipeById('rec_1')).rejects.toThrow();
    });

    it('propagates a parse error (not a client error) when a 2xx body is malformed JSON', async () => {
        const badJson = vi.fn(async () => new Response('{ not json', { status: 200 })) as unknown as typeof fetch;
        const client = new RecipeServiceClient({ baseUrl: BASE, fetch: badJson });

        const error = await client.getRecipeById('rec_1').catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(SyntaxError);
        expect(isRecipeServiceClientError(error)).toBe(false);
    });

    it('propagates a transport/network failure unchanged (not swallowed, not an HTTPError map)', async () => {
        const failure = new TypeError('network down');
        const client = new RecipeServiceClient({ baseUrl: BASE, fetch: rejectingFetch(failure) });

        const error = await client.getRecipeById('rec_1').catch((caught: unknown) => caught);

        expect(error).toBe(failure);
        expect(isRecipeServiceClientError(error)).toBe(false);
    });
});

describe('RecipeServiceClient — empty result lists', () => {
    it('returns an empty array from searchIngredients when there are no matches', async () => {
        const client = new RecipeServiceClient({ baseUrl: BASE, token: 't', fetch: stubFetch(200, []) });

        await expect(client.searchIngredients('zzz')).resolves.toEqual([]);
    });

    it('returns an empty page from listRecipes when the caller has no recipes', async () => {
        const empty = makePaginatedResponse<never>([], { total: 0 });
        const client = new RecipeServiceClient({ baseUrl: BASE, token: 't', fetch: stubFetch(200, empty) });

        await expect(client.listRecipes()).resolves.toEqual(empty);
    });
});
