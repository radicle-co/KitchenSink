/**
 * Cross-cutting transport tests for {@link RecipeServiceClient}: the identity-sync retry's backoff
 * schedule + request replay, status→error mapping edges (unexpected status, empty error body), and
 * degenerate response bodies (empty, malformed, network failure) plus empty result lists. These probe
 * the shared `send`/`sendOnce`/`normalizeResponse`/`toError` path that every public method funnels
 * through. Transport is a mocked `fetch`; no real network is touched.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDENTITY_SYNC_PENDING_CODE } from '@kitchensink/recipe-core';
import { CONTRACT_HASH } from '@kitchensink/schema-recipe';

import {
    DEFAULT_REQUEST_TIMEOUT_MS,
    ForbiddenError,
    RecipeServiceClient,
    UnauthorizedError,
    UnexpectedResponseError,
    isFetchUnavailableError,
    isRecipeServiceClientError,
} from '../index.js';
import type { FetchUnavailableError } from '../index.js';
import { makePaginatedResponse, makeRecipeDetail } from '../__fixtures__/recipes.js';
import { resetContractSkewLatchForTests } from '../contractSkew.js';
import {
    callsOf,
    hangingFetch,
    rejectingFetch,
    requestAt,
    sequenceFetch,
    skewProbeCallsOf,
    stubFetch,
} from './utils/fetchDouble.js';

const BASE = 'https://recipes.example.test';
const SYNC_PENDING = { code: IDENTITY_SYNC_PENDING_CODE, message: 'identity not yet available' };

// The drift-layer-3 skew probe latches once per ORIGIN per process (see `../contractSkew.ts`). Clearing it per
// test keeps these cases order-independent — otherwise only whichever test ran first would exercise the probe.
beforeEach(() => {
    resetContractSkewLatchForTests();
});

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

describe('RecipeServiceClient — request timeout (bounded wait)', () => {
    it('rejects a HUNG request with a typed FetchUnavailableError instead of waiting forever', async () => {
        // The infinite-loading root cause: a connection that never answers. Without a client timeout the
        // returned promise never settles, so a consuming `useQuery` stays `isPending && isFetching` for the
        // life of the page — the surface's loading branch never flips and its empty/error branches are
        // unreachable. A bounded wait turns the hang into a SETTLED failure the UI can render and retry.
        const fetchMock = hangingFetch();
        const client = new RecipeServiceClient({ baseUrl: BASE, token: 't', fetch: fetchMock, timeoutMs: 25 });

        const error = await client.listRecipes().catch((caught: unknown) => caught);

        expect(isFetchUnavailableError(error)).toBe(true);
        expect(isRecipeServiceClientError(error)).toBe(true);
        // A transport failure has no HTTP status — nothing answered.
        expect((error as FetchUnavailableError).status).toBeUndefined();
    });

    it('ABORTS the hung request rather than leaking the connection', async () => {
        const fetchMock = hangingFetch();
        const client = new RecipeServiceClient({ baseUrl: BASE, token: 't', fetch: fetchMock, timeoutMs: 25 });

        await client.listRecipes().catch(() => undefined);

        // Racing a rejection is not enough: the in-flight request must actually be cancelled, or a stalled
        // socket per navigation accumulates until the platform's connection pool is exhausted.
        expect(callsOf(fetchMock)[0]![0].signal.aborted).toBe(true);
    });

    it('bounds the wait by DEFAULT, not only when a caller passes timeoutMs', async () => {
        // The default is the one that ships: every app constructs this client WITHOUT a timeout override
        // (`RecipeProviders` on web, `RecipeServiceGate` on mobile), so a finite default is the fix.
        vi.useFakeTimers();

        try {
            const client = new RecipeServiceClient({ baseUrl: BASE, token: 't', fetch: hangingFetch() });
            const settled = client.listRecipes().catch((caught: unknown) => caught);

            await vi.advanceTimersByTimeAsync(DEFAULT_REQUEST_TIMEOUT_MS + 1);

            expect(isFetchUnavailableError(await settled)).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });

    it('does not abort a request that answers within the timeout', async () => {
        // The regression guard: the timeout must not clip a healthy response.
        const empty = makePaginatedResponse<never>([], { total: 0 });
        const fetchMock = stubFetch(200, empty);
        const client = new RecipeServiceClient({ baseUrl: BASE, token: 't', fetch: fetchMock, timeoutMs: 25 });

        await expect(client.listRecipes()).resolves.toEqual(empty);
        expect(callsOf(fetchMock)[0]![0].signal.aborted).toBe(false);
    });

    it('does not retry a timeout (the query layer owns retry; the client fails fast)', async () => {
        const fetchMock = hangingFetch();
        const client = new RecipeServiceClient({ baseUrl: BASE, token: 't', fetch: fetchMock, timeoutMs: 25 });

        await client.listRecipes().catch(() => undefined);

        // A timeout is not a 401, so neither the identity-sync loop nor the expired-token retry may replay it
        // — otherwise the bounded wait multiplies back into a near-infinite one.
        expect(callsOf(fetchMock)).toHaveLength(1);
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

/**
 * DRIFT LAYER 3 (Skew) WIRING — CODING_STANDARDS §15.2.5, owner ruling 2026-08-11: a mismatch WARNS.
 *
 * `contractSkew.test.ts` proves the comparison. These cases prove the CLIENT's half: that the check fires from
 * the transport funnel rather than the constructor, reaches the configured sink, and — the only part that can
 * hurt anyone — cannot influence the caller's call at all. This client ships in the released mobile binary, so
 * "cannot influence the caller" is the property that keeps a contract change from needing an App Store release.
 */
describe('RecipeServiceClient — contract-skew reporting', () => {
    const SERVED_HASH = 'c'.repeat(64);

    /**
     * A `fetch` double that answers the skew probe (a plain string URL ending `/health`) with `healthBody` and
     * every ky request (a `Request`) with `apiBody`.
     */
    function routingFetch(apiBody: unknown, healthBody: unknown): typeof fetch {
        return vi.fn(async (input: Request | string) =>
            typeof input === 'string' && input.endsWith('/health')
                ? new Response(JSON.stringify(healthBody), { status: 200 })
                : new Response(JSON.stringify(apiBody), { status: 200 }),
        ) as unknown as typeof fetch;
    }

    it('performs NO network call when a client is merely constructed', () => {
        const fetchMock = stubFetch(200, makeRecipeDetail());

        new RecipeServiceClient({ baseUrl: BASE, fetch: fetchMock, onContractSkew: vi.fn() });

        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('warns through the configured sink when the service serves a different fingerprint', async () => {
        const onContractSkew = vi.fn();
        const client = new RecipeServiceClient({
            baseUrl: BASE,
            token: 't',
            fetch: routingFetch(makeRecipeDetail(), { status: 'ok', service: 'recipe', contractHash: SERVED_HASH }),
            onContractSkew,
        });

        await client.getRecipeById('rec_1');

        await vi.waitFor(() => {
            expect(onContractSkew).toHaveBeenCalledTimes(1);
        });
        const message = onContractSkew.mock.calls[0]?.[0] as string;
        expect(message).toContain(SERVED_HASH.slice(0, 12));
        expect(message).toContain(CONTRACT_HASH.slice(0, 12));
    });

    // THE ruling at the boundary that matters: warn, do not refuse. The call still resolves with exactly the
    // value it would have returned with no skew at all.
    it('returns the caller a normal, unchanged result while skewed — it does not refuse', async () => {
        const recipe = makeRecipeDetail({ id: 'rec_1' });
        const onContractSkew = vi.fn();
        const client = new RecipeServiceClient({
            baseUrl: BASE,
            token: 't',
            fetch: routingFetch(recipe, { status: 'ok', service: 'recipe', contractHash: SERVED_HASH }),
            onContractSkew,
        });

        await expect(client.getRecipeById('rec_1')).resolves.toEqual(recipe);
        await vi.waitFor(() => {
            expect(onContractSkew).toHaveBeenCalledTimes(1);
        });
    });

    // Fire-and-forget, proven: a `/health` that never answers must not delay or hang the caller. If the probe
    // were awaited this test would time out rather than fail.
    it('does not wait for the probe: the caller resolves even when /health never answers', async () => {
        const recipe = makeRecipeDetail({ id: 'rec_1' });
        const client = new RecipeServiceClient({
            baseUrl: BASE,
            token: 't',
            onContractSkew: vi.fn(),
            fetch: vi.fn(async (input: Request | string) => {
                if (typeof input === 'string' && input.endsWith('/health')) {
                    return new Promise<Response>(() => undefined); // never settles
                }

                return new Response(JSON.stringify(recipe), { status: 200 });
            }) as unknown as typeof fetch,
        });

        await expect(client.getRecipeById('rec_1')).resolves.toEqual(recipe);
    });

    // A deployed service that predates publication serves no fingerprint. Silence, not a warning — otherwise
    // every pre-publication deployment is noisy and the signal gets muted.
    it('stays silent when the deployed service publishes no fingerprint', async () => {
        const onContractSkew = vi.fn();
        const client = new RecipeServiceClient({
            baseUrl: BASE,
            token: 't',
            fetch: routingFetch(makeRecipeDetail(), { status: 'ok', service: 'recipe' }),
            onContractSkew,
        });

        await client.getRecipeById('rec_1');
        await new Promise((resolve) => setTimeout(resolve, 5));

        expect(onContractSkew).not.toHaveBeenCalled();
    });

    it('probes once per origin across many requests and many client instances', async () => {
        const onContractSkew = vi.fn();
        const fetchMock = routingFetch(makeRecipeDetail(), {
            status: 'ok',
            service: 'recipe',
            contractHash: SERVED_HASH,
        });

        await Promise.all(
            Array.from({ length: 12 }, async () =>
                new RecipeServiceClient({ baseUrl: BASE, token: 't', fetch: fetchMock, onContractSkew }).getRecipeById(
                    'rec_1',
                ),
            ),
        );

        await vi.waitFor(() => {
            expect(onContractSkew).toHaveBeenCalledTimes(1);
        });
        expect(skewProbeCallsOf(fetchMock)).toHaveLength(1);
    });

    // The probe must not spend the viewer's credential: it bypasses ky (whose beforeRequest hook attaches the
    // bearer token) precisely because `/health` is public so a consumer can ask about skew before it holds one.
    it('sends the probe unauthenticated, bypassing the token-attaching transport', async () => {
        const getToken = vi.fn(() => 'tok');
        const fetchMock = routingFetch(makeRecipeDetail(), {
            status: 'ok',
            service: 'recipe',
            contractHash: SERVED_HASH,
        });
        const client = new RecipeServiceClient({
            baseUrl: BASE,
            token: getToken,
            fetch: fetchMock,
            onContractSkew: vi.fn(),
        });

        await client.getRecipeById('rec_1');
        await vi.waitFor(() => {
            expect(skewProbeCallsOf(fetchMock)).toHaveLength(1);
        });

        const [url, init] = skewProbeCallsOf(fetchMock)[0]! as [string, { headers?: Record<string, string> }];
        expect(url).toBe(`${BASE}/health`);
        expect(Object.keys(init.headers ?? {}).map((key) => key.toLowerCase())).not.toContain('authorization');
        // One token mint, for the real request only — the probe did not trigger a second.
        expect(getToken).toHaveBeenCalledTimes(1);
    });
});
