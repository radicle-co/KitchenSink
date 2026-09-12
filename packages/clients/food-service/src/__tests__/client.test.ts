/**
 * Unit tests for {@link FoodServiceClient} (T-057) with a mocked `fetch`: request build (URL, method, body,
 * bearer-token attach from a literal and a callback) + response mapping (`202`/`200` → typed results; the coded
 * error envelope → typed errors; the remote pick's per-caller `429` → `RequesterLimitReachedError`).
 *
 * ⚠️ EVERY ERROR BODY BELOW IS THE ONE ENVELOPE — `{ code, message, details? }`. The food service published three
 * error shapes until 2026-08-12 and this client discriminated a `409` with `/candidate/i.test(body.error)`; both
 * are gone. Discrimination is on the stable `code`.
 *
 * These are still LITERALS, i.e. this file's own belief about the server, which is the limitation §15.1 names. The
 * body the SERVICE actually produces is driven through this client for real in
 * `packages/services/food-service/src/common/__tests__/errorContractLockstep.test.ts` — that is the tier that
 * fails when only one side of the contract moves. Cases here cover what that tier cannot: an unknown code, and a
 * non-envelope body.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetContractSkewLatchForTests } from '../contractSkew.js';
import {
    BadRequestError,
    CandidateMismatchError,
    ConflictError,
    FetchUnavailableError,
    FoodServiceClient,
    ForbiddenError,
    InvalidRequestError,
    NotFoundError,
    RateLimitedError,
    RemoteFoodGoneError,
    RequesterLimitReachedError,
    SearchRateLimitedError,
    SourceBusyError,
    UnauthorizedError,
    isCandidateMismatchError,
    isConflictError,
    isFetchUnavailableError,
    isInvalidRequestError,
    isNotFoundError,
    isRateLimitedError,
    isRemoteFoodGoneError,
    isRequesterLimitReachedError,
    isSearchRateLimitedError,
    isSourceBusyError,
    isUnauthorizedError,
    isUnexpectedResponseError,
} from '../index.js';

const BASE = 'https://food.example.test';

// Every request also fires the drift-layer-3 skew probe (`GET /health`, CODING_STANDARDS §15.2.5) — once per
// ORIGIN per process, fire-and-forget. Clearing the latch per test keeps these cases order-independent: without
// it only whichever test ran first would see the probe, and the rest would pass for the wrong reason.
beforeEach(() => {
    resetContractSkewLatchForTests();
});

/** The calls a `fetch` double received that are API requests, i.e. excluding the `/health` skew probe. */
function apiCalls(fetchMock: typeof fetch): unknown[][] {
    return (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
        (call) => !String(call[0]).endsWith('/health'),
    );
}

/** A `fetch` double that returns a single canned response and records the call. */
function stubFetch(status: number, body?: unknown, headers: Record<string, string> = {}): typeof fetch {
    const init = body === undefined ? undefined : JSON.stringify(body);

    return vi.fn(async () => new Response(init, { status, headers })) as unknown as typeof fetch;
}

describe('FoodServiceClient — the default fetch', () => {
    /**
     * A browser's `fetch` throws "Illegal invocation" when it is called as a method of another object. Node's does
     * not, so a client that stores the global unbound passes every Node test and fails every browser read (plan 002
     * S5 moved the apps' reads onto this client; the Data sources Playwright spec found it).
     */
    it('calls the global fetch with the global as its receiver, as a browser requires', async () => {
        const original = globalThis.fetch;
        const receivers: unknown[] = [];

        globalThis.fetch = function browserLikeFetch(this: unknown): Promise<Response> {
            receivers.push(this);

            if (this !== globalThis && this !== undefined) {
                return Promise.reject(new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation"));
            }

            return Promise.resolve(new Response(JSON.stringify({ sources: [] }), { status: 200 }));
        } as typeof fetch;

        try {
            const client = new FoodServiceClient({ baseUrl: 'https://food.test', onContractSkew: () => undefined });

            await expect(client.listSources()).resolves.toEqual({ sources: [] });
            expect(receivers.every((receiver) => receiver === globalThis)).toBe(true);
        } finally {
            globalThis.fetch = original;
        }
    });
});

describe('FoodServiceClient — request build + token attach', () => {
    it('POSTs add-by-name to the right URL with a JSON body and a literal bearer token', async () => {
        const fetchMock = stubFetch(202, { id: 'food_1', status: 'PENDING', estimatedWaitSeconds: 30 });
        const client = new FoodServiceClient({ baseUrl: `${BASE}/`, token: 'tok-123', fetch: fetchMock });

        const result = await client.addByName('Broccoli');

        expect(result).toEqual({ id: 'food_1', status: 'PENDING', estimatedWaitSeconds: 30 });
        // Exactly ONE API request. (The double also sees the unauthenticated `/health` skew probe, which is
        // fired after the response and is not part of the caller's request.)
        expect(apiCalls(fetchMock)).toHaveLength(1);
        const [url, init] = apiCalls(fetchMock)[0]! as [string, Record<string, never>];
        expect(url).toBe(`${BASE}/api/v1/foods`); // trailing slash on baseUrl normalized
        expect(init.method).toBe('POST');
        expect(init.headers['authorization']).toBe('Bearer tok-123');
        expect(init.headers['content-type']).toBe('application/json');
        expect(JSON.parse(init.body)).toEqual({ name: 'Broccoli' });
    });

    it('re-reads a token callback per request (rotated M2M token)', async () => {
        const tokens = ['tok-A', 'tok-B'];
        const getToken = vi.fn(() => tokens.shift() ?? 'tok-exhausted');
        const fetchMock = stubFetch(200, { results: [] });
        const client = new FoodServiceClient({ baseUrl: BASE, token: getToken, fetch: fetchMock });

        await client.search('x');
        await client.search('y');

        // `apiCalls`, not the raw calls: the `/health` skew probe lands BETWEEN the two searches (it fires
        // after the first response) and carries no `Authorization` by design, so indexing the raw list here
        // would compare the second search against the probe.
        const calls = apiCalls(fetchMock) as [string, { headers: Record<string, string> }][];
        expect(calls[0]![1].headers['authorization']).toBe('Bearer tok-A');
        expect(calls[1]![1].headers['authorization']).toBe('Bearer tok-B');
        expect(getToken).toHaveBeenCalledTimes(2);
    });

    it('omits Authorization when no token is configured', async () => {
        const fetchMock = stubFetch(200, { results: [] });
        const client = new FoodServiceClient({ baseUrl: BASE, fetch: fetchMock });

        await client.search('kale');

        const [url, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
        expect(url).toBe(`${BASE}/api/v1/foods/search?query=kale`);
        expect(init.headers['authorization']).toBeUndefined();
    });

    it('URL-encodes the search query and path ids', async () => {
        // A VALID `SearchResponse` body: the client parses responses now, so a stub that is not a real search
        // response fails at the boundary before the assertion about the URL can be reached.
        const fetchMock = stubFetch(200, { results: [] });
        const client = new FoodServiceClient({ baseUrl: BASE, fetch: fetchMock });

        await client.search('chicken breast');
        const [searchUrl] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
        expect(searchUrl).toBe(`${BASE}/api/v1/foods/search?query=chicken%20breast`);
    });
});

/**
 * A refused bearer is replayed ONCE with a token minted afresh, as the recipe client's own `401` replay is. The apps'
 * token source reads Clerk's cache unless asked to skip it, so a query retry alone resends the refused token; food's
 * `IDENTITY_SYNC_PENDING` says outright to retry with a refreshed one. A `401` means food processed nothing, so the
 * replay is safe on a write too. A replay needs a different token: a literal bearer, or a callback that answers the
 * refused token again (recipe-service forwarding a cook's bearer), is not replayed.
 */
describe('FoodServiceClient — a refused bearer is replayed once with a fresh token', () => {
    /** A `fetch` double answering the API requests with `statuses` in order, and the skew probe with `200`. */
    function sequenceFetch(...statuses: readonly number[]): typeof fetch {
        const queue = [...statuses];

        return vi.fn(async (input: unknown) => {
            if (String(input).endsWith('/health')) {
                return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
            }

            const status = queue.shift() ?? 500;
            const body =
                status === 401
                    ? { code: 'UNAUTHORIZED', message: 'expired' }
                    : status === 200
                      ? { results: [] }
                      : { code: 'FORBIDDEN', message: 'no' };

            return new Response(JSON.stringify(body), { status });
        }) as unknown as typeof fetch;
    }

    /** A token callback that mints a new token on each call and records the options it was called with. */
    function mintingToken() {
        let minted = 0;

        return vi.fn((_options?: { readonly forceRefresh?: boolean }) => {
            minted += 1;

            return `tok-${String(minted)}`;
        });
    }

    /** The bearer each API request carried. */
    function bearers(fetchMock: typeof fetch): (string | undefined)[] {
        return (apiCalls(fetchMock) as [string, { headers: Record<string, string> }][]).map(
            ([, init]) => init.headers['authorization'],
        );
    }

    it.each([
        ['a read', (client: FoodServiceClient) => client.search('kale')],
        ['a write', (client: FoodServiceClient) => client.addByName('kale')],
    ])('replays %s once with a force-refreshed token after a 401, and answers the replay', async (_label, call) => {
        const token = mintingToken();
        const fetchMock = sequenceFetch(401, 200);
        const client = new FoodServiceClient({ baseUrl: BASE, token, fetch: fetchMock });

        await call(client).catch(() => undefined);

        expect(token.mock.calls.map(([options]) => options?.forceRefresh === true)).toStrictEqual([false, true]);
        expect(bearers(fetchMock)).toStrictEqual(['Bearer tok-1', 'Bearer tok-2']);
    });

    it('answers the replay itself, not the refusal before it', async () => {
        const client = new FoodServiceClient({ baseUrl: BASE, token: mintingToken(), fetch: sequenceFetch(401, 200) });

        await expect(client.search('kale')).resolves.toEqual({ results: [] });
    });

    /**
     * `IDENTITY_SYNC_PENDING` is waited out by the back-off `@kitchensink/retry-after/bearer-replay` owns, the one the
     * recipe client uses: a token minted at once still lacks the app-user id identity has not written back yet.
     */
    it.each([
        ['a read', (client: FoodServiceClient) => client.search('kale'), 200, { results: [] }],
        ['a write', (client: FoodServiceClient) => client.addByName('kale'), 202, { id: 'f_1', status: 'PENDING' }],
    ])('waits out IDENTITY_SYNC_PENDING on %s, then replays with a fresh token', async (_label, call, status, body) => {
        const token = mintingToken();
        const waits: number[] = [];
        const fetchMock = vi.fn(async (input: unknown) =>
            String(input).endsWith('/health')
                ? new Response(JSON.stringify({ status: 'ok' }), { status: 200 })
                : apiCalls(fetchMock as unknown as typeof fetch).length <= 2
                  ? new Response(JSON.stringify({ code: 'IDENTITY_SYNC_PENDING', message: 'sync' }), { status: 401 })
                  : new Response(JSON.stringify(body), { status }),
        ) as unknown as typeof fetch;
        const client = new FoodServiceClient({
            baseUrl: BASE,
            token,
            fetch: fetchMock,
            sleep: async (ms) => {
                waits.push(ms);
            },
        });

        await expect(call(client)).resolves.toEqual(body);
        expect(waits).toStrictEqual([250, 500]);
        expect(bearers(fetchMock)).toStrictEqual(['Bearer tok-1', 'Bearer tok-2', 'Bearer tok-3']);
    });

    it('answers the refusal, sending nothing more, when the caller’s deadline ends during the back-off', async () => {
        const caller = new AbortController();
        const token = mintingToken();
        const fetchMock = vi.fn(async (input: unknown) =>
            String(input).endsWith('/health')
                ? new Response(JSON.stringify({ status: 'ok' }), { status: 200 })
                : new Response(JSON.stringify({ code: 'IDENTITY_SYNC_PENDING', message: 'sync' }), { status: 401 }),
        ) as unknown as typeof fetch;
        const client = new FoodServiceClient({
            baseUrl: BASE,
            token,
            fetch: fetchMock,
            sleep: async () => {
                caller.abort();
            },
        });

        await expect(client.getNutrition(['f_1'], { signal: caller.signal })).rejects.toBeInstanceOf(UnauthorizedError);
        expect(apiCalls(fetchMock)).toHaveLength(1);
        expect(token).toHaveBeenCalledTimes(1);
    });

    it('replays at most once: a second 401 is the answer, after exactly two requests', async () => {
        const fetchMock = sequenceFetch(401, 401, 200);
        const client = new FoodServiceClient({ baseUrl: BASE, token: mintingToken(), fetch: fetchMock });

        await expect(client.search('kale')).rejects.toBeInstanceOf(UnauthorizedError);
        expect(apiCalls(fetchMock)).toHaveLength(2);
    });

    it('does not replay when a fresh mint answers the token food refused: a forwarded bearer, or none yet', async () => {
        const token = vi.fn((_options?: { readonly forceRefresh?: boolean }) => 'tok-forwarded');
        const fetchMock = sequenceFetch(401, 200);
        const client = new FoodServiceClient({ baseUrl: BASE, token, fetch: fetchMock });

        await expect(client.search('kale')).rejects.toBeInstanceOf(UnauthorizedError);
        expect(apiCalls(fetchMock)).toHaveLength(1);
        expect(token).toHaveBeenLastCalledWith({ forceRefresh: true });
    });

    it('never replays a literal bearer, which cannot be minted again', async () => {
        const fetchMock = sequenceFetch(401, 200);
        const client = new FoodServiceClient({ baseUrl: BASE, token: 'tok-literal', fetch: fetchMock });

        await expect(client.search('kale')).rejects.toBeInstanceOf(UnauthorizedError);
        expect(apiCalls(fetchMock)).toHaveLength(1);
    });

    it('never replays a refusal that is not a 401', async () => {
        const token = mintingToken();
        const fetchMock = sequenceFetch(403, 200);
        const client = new FoodServiceClient({ baseUrl: BASE, token, fetch: fetchMock });

        await expect(client.search('kale')).rejects.toBeInstanceOf(ForbiddenError);
        expect(apiCalls(fetchMock)).toHaveLength(1);
        expect(token).toHaveBeenCalledTimes(1);
    });
});

/**
 * A proxy in front of food answers with its own page, not food's envelope: the ALB's and CloudFront's HTML gateway
 * pages, and the shared ALB's `404 text/plain` for a host it does not route (ADR-0003). Such a body maps by its status,
 * on a buffered call and on the progressive search, whose refusal and `401` are read before any frame.
 */
describe('FoodServiceClient — a body that is not JSON maps by its status', () => {
    const PAGES: readonly (readonly [string, number, string, string, (error: unknown) => boolean])[] = [
        ['a 502 HTML page', 502, 'text/html', '<html><body>502 Bad Gateway</body></html>', isUnexpectedResponseError],
        [
            'a 504 HTML page',
            504,
            'text/html',
            '<html><body>504 Gateway Time-out</body></html>',
            isUnexpectedResponseError,
        ],
        ['a 503 HTML page', 503, 'text/html', '<html><body>503 Service Unavailable</body></html>', isSourceBusyError],
        ['the ALB’s 404', 404, 'text/plain; charset=utf-8', 'Not Found', isNotFoundError],
        ['a plain 401', 401, 'text/plain', 'Unauthorized', isUnauthorizedError],
    ];

    const CALLS: readonly (readonly [string, (client: FoodServiceClient) => Promise<unknown>])[] = [
        ['a buffered search', (client) => client.search('kale')],
        [
            'the progressive search',
            async (client) => {
                for await (const frame of client.searchProgressive('kale')) {
                    expect.unreachable(`no frame is yielded, got ${frame.type}`);
                }
            },
        ],
    ];

    describe.each(CALLS)('%s', (_call, call) => {
        it.each(PAGES)('maps %s to its typed error', async (_page, status, contentType, page, isTyped) => {
            const fetchMock = vi.fn(
                async () => new Response(page, { status, headers: { 'content-type': contentType } }),
            ) as unknown as typeof fetch;
            const client = new FoodServiceClient({ baseUrl: BASE, token: 'tok', fetch: fetchMock });

            const thrown = await call(client).then(
                () => undefined,
                (error: unknown) => error,
            );

            expect(thrown).toSatisfy(isTyped);
            expect(thrown).toHaveProperty('status', status);
        });
    });
});

describe('FoodServiceClient — getById result mapping', () => {
    it('200 → RESOLVED with the golden record', async () => {
        // Every field `foodResponseSchema` requires — `name`, `description` and `kind` were absent, so the old
        // stub was not a golden record at all. The cast this test used to exercise could not tell; the parse can.
        const food = {
            id: 'food_1',
            name: 'Chicken breast',
            description: 'raw',
            kind: 'generic',
            status: 'RESOLVED',
            nutrients: [],
            portions: [],
            provenance: {},
            // Curated U8: a root's live variants ride the read, with an attribute this client has no enum for.
            variants: [{ id: 'variant_1', parts: [{ attribute: 'smokeLevel', text: 'light' }], caloriesPer100g: 120 }],
        };
        const client = new FoodServiceClient({ baseUrl: BASE, fetch: stubFetch(200, food) });

        const result = await client.getById('food_1');

        expect(result.status).toBe('RESOLVED');
        expect(result).toEqual({ status: 'RESOLVED', food });
    });

    it('202 → a PENDING/UNRESOLVED result (not an error)', async () => {
        const client = new FoodServiceClient({
            baseUrl: BASE,
            fetch: stubFetch(202, { id: 'food_2', status: 'PENDING', estimatedWaitSeconds: 30 }),
        });

        const result = await client.getById('food_2');

        expect(result).toEqual({ status: 'PENDING', id: 'food_2', estimatedWaitSeconds: 30 });
    });

    it('404 → NotFoundError carrying the terminal food status from details', async () => {
        const client = new FoodServiceClient({
            baseUrl: BASE,
            fetch: stubFetch(404, {
                code: 'FOOD_NOT_FOUND',
                message: 'No source has this food; tombstoned until TTL (default 30 days)',
                details: { id: 'food_3', status: 'NOT_FOUND' },
            }),
        });

        const error = await client.getById('food_3').catch((caught: unknown) => caught);

        expect(isNotFoundError(error)).toBe(true);
        expect((error as NotFoundError).foodStatus).toBe('NOT_FOUND');
        expect((error as NotFoundError).id).toBe('food_3');
    });
});

describe('FoodServiceClient.createAuthoredFood (plan U16)', () => {
    const AUTHORED = {
        id: 'food_a1',
        name: 'My Protein Blend',
        description: null,
        kind: 'generic',
        status: 'RESOLVED',
        nutrients: [],
        portions: [],
        provenance: {},
        visibility: 'private',
        variants: [],
    };
    const BODY = { name: 'My Protein Blend', macros: { calories: 380, proteinG: 70, carbsG: 12, fatG: 6 } };

    it('201 → created, with the full authored record', async () => {
        const fetchMock = stubFetch(201, AUTHORED);
        const client = new FoodServiceClient({ baseUrl: BASE, token: 'tok', fetch: fetchMock });

        const result = await client.createAuthoredFood(BODY);

        expect(result.kind).toBe('created');

        if (result.kind === 'created') {
            expect(result.food.id).toBe('food_a1');
        }

        const [url, init] = apiCalls(fetchMock)[0]! as [string, { method: string; body: string }];

        expect(url).toBe(`${BASE}/api/v1/foods/authored`);
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body)).toEqual(BODY);
    });

    it('409 DUPLICATE_AUTHORED_NAME → the duplicate arm carrying the EXISTING food id, never a throw', async () => {
        // The reuse affordance (U16) needs the colliding row's id — a bare ConflictError cannot carry it.
        const fetchMock = stubFetch(409, {
            code: 'DUPLICATE_AUTHORED_NAME',
            message: 'You already authored a food with this name',
            details: { existingId: 'food_prior' },
        });
        const client = new FoodServiceClient({ baseUrl: BASE, token: 'tok', fetch: fetchMock });

        const result = await client.createAuthoredFood(BODY);

        expect(result).toEqual({ kind: 'duplicate', existingId: 'food_prior' });
    });

    it('any OTHER failure still maps through the shared error ladder', async () => {
        const client = new FoodServiceClient({
            baseUrl: BASE,
            token: 'tok',
            fetch: stubFetch(401, { code: 'UNAUTHORIZED', message: 'no' }),
        });

        await expect(client.createAuthoredFood(BODY)).rejects.toBeInstanceOf(UnauthorizedError);
    });

    it('refuses an ILLEGAL body before any request leaves (parse, do not validate)', async () => {
        const fetchMock = stubFetch(201, AUTHORED);
        const client = new FoodServiceClient({ baseUrl: BASE, token: 'tok', fetch: fetchMock });

        await expect(
            client.createAuthoredFood({ name: '', macros: { calories: -1, proteinG: 0, carbsG: 0, fatG: 0 } }),
        ).rejects.toBeInstanceOf(Error);
        expect(apiCalls(fetchMock)).toHaveLength(0);
    });
});

describe('FoodServiceClient.corroborateFood (plan U19)', () => {
    it('POSTs the corroboration trigger and returns the (possibly unchanged) status', async () => {
        const fetchMock = stubFetch(200, { id: 'food_1', status: 'RESOLVED' });
        const client = new FoodServiceClient({ baseUrl: BASE, token: 'tok', fetch: fetchMock });

        const result = await client.corroborateFood('food_1');

        expect(result).toEqual({ id: 'food_1', status: 'RESOLVED' });

        const [url, init] = apiCalls(fetchMock)[0]! as [string, { method: string }];

        expect(url).toBe(`${BASE}/api/v1/foods/food_1/corroborated`);
        expect(init.method).toBe('POST');
    });

    it('maps failures through the shared ladder', async () => {
        const client = new FoodServiceClient({
            baseUrl: BASE,
            token: 'tok',
            fetch: stubFetch(404, {
                code: 'FOOD_NOT_FOUND',
                message: 'gone',
                details: { id: 'x', status: 'NOT_FOUND' },
            }),
        });

        await expect(client.corroborateFood('x')).rejects.toBeInstanceOf(NotFoundError);
    });
});

describe('FoodServiceClient.purgeOwnAuthoredFoods (ADR-0040, food half)', () => {
    it('POSTs the test-purge door with NO body and returns the parsed counts (200)', async () => {
        const fetchMock = stubFetch(200, { deletedAuthoredFoods: 3, retainedPromotedFoods: 1 });
        const client = new FoodServiceClient({ baseUrl: BASE, token: 'tok', fetch: fetchMock });

        const result = await client.purgeOwnAuthoredFoods();

        expect(result).toEqual({ deletedAuthoredFoods: 3, retainedPromotedFoods: 1 });

        const [url, init] = apiCalls(fetchMock)[0]! as [string, { method: string; body?: unknown }];

        expect(url).toBe(`${BASE}/api/v1/foods/authored/test-purge`);
        expect(init.method).toBe('POST');
        // The principal is the token: there is no target to name, and the contract declares no body.
        expect(init.body).toBeUndefined();
    });

    it('PARSES the 200 body, so a drifted count fails here rather than as a wrong reset log', async () => {
        const client = new FoodServiceClient({
            baseUrl: BASE,
            token: 'tok',
            fetch: stubFetch(200, { deletedAuthoredFoods: -1, retainedPromotedFoods: 0 }),
        });

        await expect(client.purgeOwnAuthoredFoods()).rejects.toThrow();
    });

    it('maps the door’s unrouted-style 404 (not a test principal) to NotFoundError', async () => {
        const client = new FoodServiceClient({
            baseUrl: BASE,
            token: 'tok',
            fetch: stubFetch(404, { code: 'NOT_FOUND', message: 'Cannot POST /api/v1/foods/authored/test-purge' }),
        });

        await expect(client.purgeOwnAuthoredFoods()).rejects.toBeInstanceOf(NotFoundError);
    });
});

describe('FoodServiceClient.listSources (plan R55)', () => {
    const SOURCES = {
        sources: [
            {
                id: 'usda',
                shortName: 'USDA',
                name: 'FoodData Central',
                publisher: 'U.S. Department of Agriculture, Agricultural Research Service',
                edition: 'SR Legacy 2018-04',
                licenceName: 'CC0 1.0 Universal',
                licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
                attribution: 'U.S. Department of Agriculture, Agricultural Research Service. FoodData Central.',
                attributionLanguage: 'en',
                homepage: 'https://fdc.nal.usda.gov/',
                converted: false,
            },
        ],
    };

    it('GETs /api/v1/foods/sources with the bearer and returns the parsed sources', async () => {
        const fetchMock = stubFetch(200, SOURCES);
        const client = new FoodServiceClient({ baseUrl: BASE, token: 'tok', fetch: fetchMock });

        await expect(client.listSources()).resolves.toStrictEqual(SOURCES);

        const [url, init] = apiCalls(fetchMock)[0] as [string, RequestInit];

        expect(url).toBe(`${BASE}/api/v1/foods/sources`);
        expect(init.method).toBe('GET');
        expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer tok');
    });

    it('401 → UnauthorizedError', async () => {
        const client = new FoodServiceClient({
            baseUrl: BASE,
            fetch: stubFetch(401, { code: 'UNAUTHORIZED', message: 'nope' }),
        });

        await expect(client.listSources()).rejects.toBeInstanceOf(UnauthorizedError);
    });

    // A deployment that predates the route answers `GET /:id` with `sources` as the id. The request carries no input,
    // so a 400 here can only mean the route is not served — never a bad request this client could fix.
    it('a 400 INVALID_ID from a deployment that predates the route → UnexpectedResponseError, not BadRequestError', async () => {
        const client = new FoodServiceClient({
            baseUrl: BASE,
            fetch: stubFetch(400, { code: 'INVALID_ID', message: 'The id is not a valid food (ingredient) ULID' }),
        });
        const caught = await client.listSources().catch((error: unknown) => error);

        expect(isUnexpectedResponseError(caught)).toBe(true);
        expect(caught).not.toBeInstanceOf(BadRequestError);
    });

    it('a 404 → UnexpectedResponseError, never the NotFoundError that means "no such food"', async () => {
        const client = new FoodServiceClient({
            baseUrl: BASE,
            fetch: stubFetch(404, { code: 'NOT_FOUND', message: 'Cannot GET /api/v1/foods/sources' }),
        });
        const caught = await client.listSources().catch((error: unknown) => error);

        expect(isUnexpectedResponseError(caught)).toBe(true);
        expect(isNotFoundError(caught)).toBe(false);
    });

    it('refuses a body that is not the published shape rather than believing it', async () => {
        const client = new FoodServiceClient({
            baseUrl: BASE,
            fetch: stubFetch(200, { sources: [{ id: 'usda' }] }),
        });

        await expect(client.listSources()).rejects.toThrow();
    });

    /**
     * Rewritten for plan 002 S5: this aborted the caller's signal AFTER the read had settled and expected the request's
     * signal to follow, which held only because nothing ever detached the request from the caller. The request now
     * detaches when it settles (no listener outlives it), so the case that matters is a read cancelled IN FLIGHT.
     */
    it('hands the caller’s signal to the request, so a cancelled read stops its socket', async () => {
        let requestSignal: AbortSignal | undefined;
        const fetchMock = vi.fn(
            (url: string, init?: RequestInit) =>
                new Promise<Response>((_resolve, reject) => {
                    if (!url.endsWith('/health')) {
                        requestSignal = init?.signal ?? undefined;
                    }

                    init?.signal?.addEventListener('abort', () => {
                        reject(new DOMException('The operation was aborted.', 'AbortError'));
                    });
                }),
        ) as unknown as typeof fetch;
        const client = new FoodServiceClient({ baseUrl: BASE, fetch: fetchMock, timeoutMs: 60_000 });
        const caller = new AbortController();

        const pending = client.listSources({ signal: caller.signal }).catch((caught: unknown) => caught);
        await vi.waitFor(() => expect(requestSignal).toBeDefined());
        caller.abort();

        expect(isFetchUnavailableError(await pending)).toBe(true);
        expect(requestSignal?.aborted).toBe(true);
    });
});

describe('FoodServiceClient — status → typed error mapping', () => {
    it('401 → UnauthorizedError', async () => {
        const client = new FoodServiceClient({
            baseUrl: BASE,
            fetch: stubFetch(401, { code: 'UNAUTHORIZED', message: 'nope' }),
        });
        await expect(client.addByName('x')).rejects.toBeInstanceOf(UnauthorizedError);
    });

    it('403 → ForbiddenError', async () => {
        const client = new FoodServiceClient({
            baseUrl: BASE,
            fetch: stubFetch(403, { code: 'FORBIDDEN', message: 'no scope' }),
        });
        await expect(client.addByName('x')).rejects.toBeInstanceOf(ForbiddenError);
    });

    // The SERVER's 400, on a body this client's own outbound parse accepts — which is what makes the mapping
    // reachable at all now that the request schema runs first. `'x'` is a legal `addFoodRequestSchema` name, so
    // the request goes out and the service's rejection is what produces the error.
    it('400 → BadRequestError', async () => {
        const client = new FoodServiceClient({
            baseUrl: BASE,
            fetch: stubFetch(400, {
                code: 'VALIDATION_FAILED',
                message: 'name: too small',
                details: { fields: ['name'] },
            }),
        });
        await expect(client.addByName('x')).rejects.toBeInstanceOf(BadRequestError);
    });

    /**
     * Rewritten for plan 002 S5: a `503` that came in a response is now the narrower `SourceBusyError`, so a caller can
     * tell "food answered busy" from "nothing answered". It is still a `FetchUnavailableError`, so every caller that
     * knows only the wider type reads it as before.
     */
    it('503 FETCH_UNAVAILABLE → SourceBusyError, still a FetchUnavailableError, with the window and no cause', async () => {
        const client = new FoodServiceClient({
            baseUrl: BASE,
            fetch: stubFetch(
                503,
                {
                    code: 'FETCH_UNAVAILABLE',
                    message: 'Fetch temporarily unavailable',
                    details: { retryAfterSeconds: 42 },
                },
                { 'retry-after': '42' },
            ),
        });

        const error = await client.addByName('x').catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(SourceBusyError);
        expect(isSourceBusyError(error)).toBe(true);
        expect((error as SourceBusyError).name).toBe('SourceBusyError');
        expect(isFetchUnavailableError(error)).toBe(true);
        expect((error as FetchUnavailableError).retryAfterSeconds).toBe(42);
        expect((error as FetchUnavailableError).cause).toBeUndefined();
        // A response came, so the status is the one it carried.
        expect((error as FetchUnavailableError).status).toBe(503);
    });

    it('resolve 409 CANDIDATE_MISMATCH → CandidateMismatchError (DSN-14, never 429)', async () => {
        const client = new FoodServiceClient({
            baseUrl: BASE,
            // Note the message says nothing about candidates: the code is the discriminant, and this body is
            // exactly the one the retired `/candidate/i` regex would have mapped to a plain ConflictError.
            fetch: stubFetch(409, {
                code: 'CANDIDATE_MISMATCH',
                message: 'That selection does not belong to this ingredient',
                details: { id: 'food_1' },
            }),
        });

        const error = await client.resolve('food_1', ['cand_x']).catch((caught: unknown) => caught);

        expect(isCandidateMismatchError(error)).toBe(true);
        expect((error as CandidateMismatchError).status).toBe(409);
        expect((error as CandidateMismatchError).id).toBe('food_1');
    });

    it('resolve 409 NOT_RESOLVABLE → ConflictError, even when the message mentions candidates', async () => {
        const client = new FoodServiceClient({
            baseUrl: BASE,
            // The mirror-image trap: prose containing "candidate" on the body that must NOT become a
            // CandidateMismatchError. Under the old regex this test fails.
            fetch: stubFetch(409, {
                code: 'NOT_RESOLVABLE',
                message: 'This ingredient has no candidate list to choose from',
                details: { id: 'food_1', status: 'RESOLVED' },
            }),
        });

        const error = await client.resolve('food_1', ['cand_x']).catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(ConflictError);
        expect(isCandidateMismatchError(error)).toBe(false);
    });

    /**
     * The remote pick's refusal (ADR-0055 point 10) is its own class, never a `ConflictError`: the app tells the cook
     * the hit is no longer valid and searches again (`rowEditorOpenDecisions.md` P8), while a recipe `409` is the
     * editor's conflict state. The mapping is by `code`, so any call that receives it maps it the same way.
     */
    it('409 REMOTE_FOOD_GONE → RemoteFoodGoneError, which is not a ConflictError', async () => {
        const client = new FoodServiceClient({
            baseUrl: BASE,
            fetch: stubFetch(409, { code: 'REMOTE_FOOD_GONE', message: 'This remote food can no longer be picked' }),
        });

        const error = await client.resolve('food_1', ['cand_x']).catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(RemoteFoodGoneError);
        expect(isRemoteFoodGoneError(error)).toBe(true);
        expect(isConflictError(error)).toBe(false);
        expect(error).toMatchObject({ status: 409, message: 'This remote food can no longer be picked' });
    });

    it('never reads a recipe-shaped 409 as a gone remote food', () => {
        expect(isRemoteFoodGoneError(new ConflictError('the recipe changed'))).toBe(false);
    });

    /**
     * FORWARD COMPATIBILITY, which is the other half of keying on `code`. A DEPLOYED service adds codes ahead of
     * a released mobile binary, so an unrecognised code must degrade to "map by status alone" — never crash with
     * a `ZodError` out of the error mapper, and never be coerced into a code this build does know.
     */
    it('maps a code it has not been taught by STATUS, without crashing', async () => {
        const client = new FoodServiceClient({
            baseUrl: BASE,
            fetch: stubFetch(409, { code: 'FOOD_ON_FIRE', message: 'a code from a newer service' }),
        });

        const error = await client.resolve('food_1', ['cand_x']).catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(ConflictError);
        expect(isCandidateMismatchError(error)).toBe(false);
        // The envelope still parsed, so the server's message survives for a human reading a log.
        expect((error as ConflictError).message).toBe('a code from a newer service');
    });

    /**
     * The ALB case (ADR-0003): during every deploy the shared internet-facing load balancer answers `502`/`503`/
     * `504` with an HTML page, and its default rule answers an unmatched host with `404 text/plain`. None of that
     * is our envelope, and the error mapper must still produce the right typed error rather than throwing.
     */
    it('maps a body that is not our envelope at all by status, without throwing', async () => {
        const client = new FoodServiceClient({
            baseUrl: BASE,
            fetch: stubFetch(
                503,
                { html: '<html>503 Service Temporarily Unavailable</html>' },
                {
                    'retry-after': '5',
                },
            ),
        });

        const error = await client.addByName('kale').catch((caught: unknown) => caught);

        // Plan 002 S5: the load balancer's 503 is a response too, so it is `SourceBusyError`, not a transport failure.
        expect(isSourceBusyError(error)).toBe(true);
        expect(isFetchUnavailableError(error)).toBe(true);
        expect((error as FetchUnavailableError).retryAfterSeconds).toBe(5);
    });

    it('PATCH resolve sends the candidateIds body and returns RESOLVED on 200', async () => {
        const fetchMock = stubFetch(200, { id: 'food_1', status: 'RESOLVED' });
        const client = new FoodServiceClient({ baseUrl: BASE, token: 't', fetch: fetchMock });

        const result = await client.resolve('food_1', ['cand_1']);

        expect(result).toEqual({ id: 'food_1', status: 'RESOLVED' });
        const [url, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
        expect(url).toBe(`${BASE}/api/v1/foods/food_1`);
        expect(init.method).toBe('PATCH');
        expect(JSON.parse(init.body)).toEqual({ candidateIds: ['cand_1'] });
    });
});

describe('FoodServiceClient — per-request timeout + transport failure', () => {
    /**
     * A `fetch` double that NEVER resolves on its own — it settles only when the caller aborts the
     * request via the passed `AbortSignal` (exactly how a real `fetch` behaves against a hung server).
     * If `send()` failed to arm a timeout, awaiting this would hang forever; the promise resolving at
     * all is proof the client's own deadline fired and aborted the request.
     */
    function hangingFetch(): { fetch: typeof fetch; signalUsed: () => AbortSignal | undefined } {
        let captured: AbortSignal | undefined;
        const fn = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
            captured = init?.signal ?? undefined;

            return new Promise<Response>((_resolve, reject) => {
                init?.signal?.addEventListener('abort', () => {
                    reject(new DOMException('The operation was aborted.', 'AbortError'));
                });
            });
        });

        return { fetch: fn as unknown as typeof fetch, signalUsed: () => captured };
    }

    it('rejects with FetchUnavailableError when the request exceeds timeoutMs (client abort)', async () => {
        const { fetch: hanging } = hangingFetch();
        // A tiny deadline keeps the test fast and deterministic without fake timers: the hanging fetch
        // resolves ONLY via the abort, so a passing assertion proves the timeout path drove it.
        const client = new FoodServiceClient({ baseUrl: BASE, fetch: hanging, timeoutMs: 10 });

        const error = await client.addByName('Broccoli').catch((caught: unknown) => caught);

        expect(isFetchUnavailableError(error)).toBe(true);
        // No HTTP response occurred, so there is no Retry-After to surface.
        expect((error as FetchUnavailableError).retryAfterSeconds).toBeUndefined();
        // The originating abort is preserved for diagnosability.
        expect((error as FetchUnavailableError).cause).toBeInstanceOf(DOMException);
        expect(((error as FetchUnavailableError).cause as DOMException).name).toBe('AbortError');
    });

    it('maps a raw transport failure (fetch rejects) to FetchUnavailableError, carrying the cause', async () => {
        const transportError = new TypeError('fetch failed');
        const fetchMock = vi.fn(async () => {
            throw transportError;
        }) as unknown as typeof fetch;
        const client = new FoodServiceClient({ baseUrl: BASE, fetch: fetchMock, timeoutMs: 50 });

        const error = await client.getById('food_1').catch((caught: unknown) => caught);

        expect(isFetchUnavailableError(error)).toBe(true);
        expect((error as FetchUnavailableError).cause).toBe(transportError);
    });

    // No response came, so there is no status to carry. A caller that retries on a status (the app's mutation rule
    // retries a 429 or a 503) must not read a dropped socket, which may follow a committed write, as a refusal.
    it('carries no status on a transport failure or a timeout', async () => {
        const rejecting = vi.fn(async () => {
            throw new TypeError('fetch failed');
        }) as unknown as typeof fetch;
        const dropped = new FoodServiceClient({ baseUrl: BASE, fetch: rejecting, timeoutMs: 50 });
        const hung = new FoodServiceClient({ baseUrl: BASE, fetch: hangingFetch().fetch, timeoutMs: 10 });

        await expect(dropped.addByName('Broccoli')).rejects.toHaveProperty('status', undefined);
        await expect(hung.addByName('Broccoli')).rejects.toHaveProperty('status', undefined);
    });

    // Plan 002 S5: no response came, so neither failure is the `SourceBusyError` a 503 response is.
    it('keeps a transport failure a plain FetchUnavailableError, never SourceBusyError', async () => {
        const rejecting = vi.fn(async () => {
            throw new TypeError('fetch failed');
        }) as unknown as typeof fetch;
        const client = new FoodServiceClient({ baseUrl: BASE, fetch: rejecting, timeoutMs: 50 });

        const error = await client.searchCatalog('egg').catch((caught: unknown) => caught);

        expect(isFetchUnavailableError(error)).toBe(true);
        expect(isSourceBusyError(error)).toBe(false);
    });

    it('keeps a timeout a plain FetchUnavailableError, never SourceBusyError', async () => {
        const client = new FoodServiceClient({ baseUrl: BASE, fetch: hangingFetch().fetch, timeoutMs: 10 });

        const error = await client.searchCatalog('egg').catch((caught: unknown) => caught);

        expect(isFetchUnavailableError(error)).toBe(true);
        expect(isSourceBusyError(error)).toBe(false);
    });

    it('resolves a fast response normally and clears the timer (the request is never aborted)', async () => {
        let capturedSignal: AbortSignal | undefined;
        const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
            capturedSignal = init?.signal ?? undefined;

            return new Response(JSON.stringify({ id: 'food_1', status: 'PENDING', estimatedWaitSeconds: 5 }), {
                status: 202,
            });
        }) as unknown as typeof fetch;
        // A short deadline would fire quickly IF it leaked; the assertions below prove it did not.
        const client = new FoodServiceClient({ baseUrl: BASE, fetch: fetchMock, timeoutMs: 20 });

        const result = await client.addByName('Broccoli');

        expect(result).toEqual({ id: 'food_1', status: 'PENDING', estimatedWaitSeconds: 5 });
        // The timer was cleared in `finally`; the successful request's signal must never have aborted.
        expect(capturedSignal?.aborted).toBe(false);
    });
});

/**
 * ⛔ A CALLER'S DEADLINE REACHES THE TRANSPORT (deadline propagation).
 *
 * The per-request `timeoutMs` bounds ONE request. A caller that issues several — the recipe service's nutrition
 * gateway sends a shared chunk, more chunks in waves, then the authored call — needs ONE deadline over all of
 * them, or its worst case is the SUM of per-request bounds (8 s + 8 s was the recipe detail's 16 s). The only
 * sound way to enforce that deadline is to abort the in-flight socket, never to race a timer beside it, so the
 * caller's `signal` must reach `fetch` itself. Each case uses a `fetch` that settles ONLY through its signal,
 * with a per-request timeout far longer than the test: resolving at all proves the CALLER's signal aborted it.
 */
describe('FoodServiceClient — a caller-supplied deadline signal', () => {
    function signalOnlyFetch(): typeof fetch {
        return vi.fn(
            (_url: string | URL | Request, init?: RequestInit) =>
                new Promise<Response>((_resolve, reject) => {
                    const abort = (): void => {
                        reject(new DOMException('The operation was aborted.', 'AbortError'));
                    };

                    if (init?.signal?.aborted === true) {
                        abort();

                        return;
                    }

                    init?.signal?.addEventListener('abort', abort);
                }),
        ) as unknown as typeof fetch;
    }

    it('aborts an in-flight getNutrition when the caller`s signal fires, long before timeoutMs', async () => {
        const client = new FoodServiceClient({ baseUrl: BASE, fetch: signalOnlyFetch(), timeoutMs: 60_000 });
        const deadline = new AbortController();

        const pending = client.getNutrition(['food_1'], { signal: deadline.signal }).catch((caught: unknown) => caught);
        deadline.abort();
        const error = await pending;

        expect(isFetchUnavailableError(error)).toBe(true);
    });

    it('aborts an in-flight getAuthoredNutrition when the caller`s signal fires', async () => {
        const client = new FoodServiceClient({ baseUrl: BASE, fetch: signalOnlyFetch(), timeoutMs: 60_000 });
        const deadline = new AbortController();

        const pending = client
            .getAuthoredNutrition(['food_1'], { signal: deadline.signal })
            .catch((caught: unknown) => caught);
        deadline.abort();

        expect(isFetchUnavailableError(await pending)).toBe(true);
    });

    // Plan 002 S5: the picker's query cancels a superseded search, so both split search routes take the deadline too.
    it.each(['searchCatalog', 'searchAuthored'] as const)(
        'aborts an in-flight %s when the caller`s signal fires',
        async (method) => {
            const client = new FoodServiceClient({ baseUrl: BASE, fetch: signalOnlyFetch(), timeoutMs: 60_000 });
            const deadline = new AbortController();

            const pending = client[method]('egg', { signal: deadline.signal }).catch((caught: unknown) => caught);
            deadline.abort();

            expect(isFetchUnavailableError(await pending)).toBe(true);
        },
    );

    it('refuses to start a request whose deadline has already passed', async () => {
        const fetchMock = signalOnlyFetch();
        const client = new FoodServiceClient({ baseUrl: BASE, fetch: fetchMock, timeoutMs: 60_000 });

        const error = await client
            .getNutrition(['food_1'], { signal: AbortSignal.abort() })
            .catch((caught: unknown) => caught);

        expect(isFetchUnavailableError(error)).toBe(true);
    });

    it('still enforces its own per-request timeout when the caller`s deadline is longer', async () => {
        const client = new FoodServiceClient({ baseUrl: BASE, fetch: signalOnlyFetch(), timeoutMs: 10 });

        const error = await client
            .getNutrition(['food_1'], { signal: new AbortController().signal })
            .catch((caught: unknown) => caught);

        expect(isFetchUnavailableError(error)).toBe(true);
    });

    /**
     * The caller's signal is long-lived (a TanStack query's, or a deadline over many requests), so a listener a request
     * left on it would outlive the request. Every one added must be removed when the request settles.
     */
    it('leaves no listener on the caller`s signal once each request settles', async () => {
        const caller = new AbortController();
        const added = vi.spyOn(caller.signal, 'addEventListener');
        const removed = vi.spyOn(caller.signal, 'removeEventListener');
        const client = new FoodServiceClient({ baseUrl: BASE, fetch: stubFetch(200, { results: [] }) });

        for (const term of ['egg', 'eggs', 'egg yolk']) {
            await client.searchCatalog(term, { signal: caller.signal });
        }

        const abortListeners = (spy: typeof added): number =>
            spy.mock.calls.filter(([type]) => type === 'abort').length;

        expect(abortListeners(added)).toBeGreaterThan(0);
        expect(abortListeners(removed)).toBe(abortListeners(added));
    });
});

/**
 * Next 16 builds the web app for Chrome 111, Firefox 111 and Safari 16.4 (`next/dist/shared/lib/
 * modern-browserslist-target.js`), and none of them has `AbortSignal.any` (Chrome 116, Firefox 124, Safari 17.4). Removing
 * the statics reproduces such a browser here, where Node would otherwise supply them.
 */
describe('FoodServiceClient — on a runtime without AbortSignal.any or AbortSignal.timeout', () => {
    const statics = ['any', 'timeout'] as const;
    let saved: Record<(typeof statics)[number], PropertyDescriptor | undefined>;

    beforeEach(() => {
        saved = {
            any: Object.getOwnPropertyDescriptor(AbortSignal, 'any'),
            timeout: Object.getOwnPropertyDescriptor(AbortSignal, 'timeout'),
        };

        for (const name of statics) {
            Object.defineProperty(AbortSignal, name, { value: undefined, configurable: true, writable: true });
        }
    });

    afterEach(() => {
        for (const name of statics) {
            const descriptor = saved[name];

            if (descriptor !== undefined) {
                Object.defineProperty(AbortSignal, name, descriptor);
            }
        }
    });

    it('still sends a request that carries the caller`s signal, and returns its answer', async () => {
        const fetchMock = stubFetch(200, { results: [{ id: 'food_1', name: 'egg', score: 1 }] });
        const client = new FoodServiceClient({ baseUrl: BASE, fetch: fetchMock });

        const answer = await client.searchCatalog('egg', { signal: new AbortController().signal });

        expect(answer).toStrictEqual({ results: [{ id: 'food_1', name: 'egg', score: 1 }] });
        expect(apiCalls(fetchMock)).toHaveLength(1);
    });

    it('still aborts the request when the caller`s signal fires', async () => {
        let requestSignal: AbortSignal | undefined;
        const signalOnly = vi.fn(
            (_url: string | URL | Request, init?: RequestInit) =>
                new Promise<Response>((_resolve, reject) => {
                    requestSignal = init?.signal ?? undefined;
                    init?.signal?.addEventListener('abort', () => {
                        reject(new DOMException('The operation was aborted.', 'AbortError'));
                    });
                }),
        ) as unknown as typeof fetch;
        const client = new FoodServiceClient({ baseUrl: BASE, fetch: signalOnly, timeoutMs: 60_000 });
        const caller = new AbortController();

        const pending = client.searchAuthored('egg', { signal: caller.signal }).catch((caught: unknown) => caught);
        await vi.waitFor(() => expect(requestSignal).toBeDefined());
        caller.abort();

        expect(isFetchUnavailableError(await pending)).toBe(true);
        expect(requestSignal?.aborted).toBe(true);
    });
});

/**
 * Plan 002 S5 puts this client in the browser with the cook's session token, so the token goes only where the client
 * was pointed: a redirect is refused rather than followed (`redirect: 'error'`), and the skew probe carries none.
 */
describe('FoodServiceClient — where the bearer goes', () => {
    it.each([
        ['searchCatalog', (client: FoodServiceClient) => client.searchCatalog('egg')],
        ['searchAuthored', (client: FoodServiceClient) => client.searchAuthored('egg')],
        ['getById', (client: FoodServiceClient) => client.getById('food_1')],
        ['getNutrition', (client: FoodServiceClient) => client.getNutrition(['food_1'])],
    ] as const)('%s refuses to follow a redirect', async (_method, call) => {
        const fetchMock = stubFetch(200, { results: [] });
        const client = new FoodServiceClient({ baseUrl: BASE, token: 'tok', fetch: fetchMock });

        await call(client).catch(() => undefined);

        const [, init] = apiCalls(fetchMock)[0]! as [string, RequestInit];
        expect(init.redirect).toBe('error');
    });

    // Already true before S5; pinned so it stays true.
    it('sends the bearer only to the configured origin, and the skew probe sends none', async () => {
        const fetchMock = stubFetch(200, { results: [] });
        const client = new FoodServiceClient({ baseUrl: BASE, token: 'tok', fetch: fetchMock });

        await client.searchCatalog('egg');
        await client.searchAuthored('egg');

        const calls = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls as [string, RequestInit][];
        const withBearer = calls.filter(([, init]) => (init.headers as Record<string, string>)['authorization']);

        expect(withBearer.map(([url]) => new URL(url).origin)).toStrictEqual([BASE, BASE]);
        expect(calls.some(([url]) => url.endsWith('/health'))).toBe(true);
    });
});

/**
 * DRIFT LAYER 3 (Skew) WIRING — CODING_STANDARDS §15.2.5, owner ruling 2026-08-11 (a mismatch WARNS).
 *
 * `contractSkew.test.ts` proves the comparison itself. These cases prove the CLIENT's half of the contract:
 * that the check fires from the transport (not the constructor), that it reaches the configured sink, and —
 * the part that actually matters in production — that it cannot influence the caller's call in any way.
 */
describe('FoodServiceClient — contract-skew reporting', () => {
    const SERVED_HASH = 'b'.repeat(64);

    /** A `fetch` double that answers `/health` with `healthBody` and everything else with `apiBody`. */
    function routingFetch(apiBody: unknown, healthBody: unknown): typeof fetch {
        return vi.fn(async (url: string | URL | Request) =>
            new Request(url).url.endsWith('/health')
                ? new Response(JSON.stringify(healthBody), { status: 200 })
                : new Response(JSON.stringify(apiBody), { status: 200 }),
        ) as unknown as typeof fetch;
    }

    // The constructor is called PER REQUEST — and per keystroke for the typeahead — by the recipe service's
    // `FoodServiceClients` factory. A probe here would be a `/health` request per keystroke.
    it('performs NO network call when a client is merely constructed', () => {
        const fetchMock = stubFetch(200, { results: [] });

        new FoodServiceClient({ baseUrl: BASE, fetch: fetchMock, onContractSkew: vi.fn() });

        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('warns through the configured sink when the service serves a different fingerprint', async () => {
        const onContractSkew = vi.fn();
        const client = new FoodServiceClient({
            baseUrl: BASE,
            fetch: routingFetch({ results: [] }, { status: 'ok', service: 'food', contractHash: SERVED_HASH }),
            onContractSkew,
        });

        await client.search('kale');

        await vi.waitFor(() => {
            expect(onContractSkew).toHaveBeenCalledTimes(1);
        });
        expect(onContractSkew.mock.calls[0]?.[0]).toContain(SERVED_HASH.slice(0, 12));
    });

    // THE ruling, asserted at the boundary that matters: warn, do not refuse. The call still succeeds and
    // returns exactly what it would have returned with no skew at all.
    it('returns the caller a normal, unchanged result while skewed — it does not refuse', async () => {
        const onContractSkew = vi.fn();
        const results = { results: [{ id: 'food_1', name: 'Kale', score: 1 }] };
        const client = new FoodServiceClient({
            baseUrl: BASE,
            fetch: routingFetch(results, { status: 'ok', service: 'food', contractHash: SERVED_HASH }),
            onContractSkew,
        });

        await expect(client.search('kale')).resolves.toEqual(results);
        await vi.waitFor(() => {
            expect(onContractSkew).toHaveBeenCalledTimes(1);
        });
    });

    // The probe is fire-and-forget, and this is what proves it: a `/health` that NEVER answers must not delay
    // or hang the caller's request. If the probe were awaited, this test would time out.
    it('does not wait for the probe: the caller resolves even when /health never answers', async () => {
        const client = new FoodServiceClient({
            baseUrl: BASE,
            onContractSkew: vi.fn(),
            fetch: vi.fn(async (url: string | URL | Request) => {
                if (new Request(url).url.endsWith('/health')) {
                    return new Promise<Response>(() => {}); // never settles
                }

                return new Response(JSON.stringify({ results: [] }), { status: 200 });
            }) as unknown as typeof fetch,
        });

        await expect(client.search('kale')).resolves.toEqual({ results: [] });
    });

    // An older deployed food service predates publication. Silence, not a warning.
    it('stays silent when the deployed service publishes no fingerprint', async () => {
        const onContractSkew = vi.fn();
        const client = new FoodServiceClient({
            baseUrl: BASE,
            fetch: routingFetch({ results: [] }, { status: 'ok', service: 'food' }),
            onContractSkew,
        });

        await client.search('kale');
        // Give the fire-and-forget probe a full turn to have (incorrectly) warned.
        await new Promise((resolve) => setTimeout(resolve, 5));

        expect(onContractSkew).not.toHaveBeenCalled();
    });

    it('probes once per origin across MANY separately-constructed clients (the per-keystroke case)', async () => {
        const onContractSkew = vi.fn();
        const fetchMock = routingFetch({ results: [] }, { status: 'ok', service: 'food', contractHash: SERVED_HASH });

        await Promise.all(
            Array.from({ length: 20 }, async () =>
                new FoodServiceClient({ baseUrl: BASE, fetch: fetchMock, onContractSkew }).search('kale'),
            ),
        );

        await vi.waitFor(() => {
            expect(onContractSkew).toHaveBeenCalledTimes(1);
        });
        const healthProbes = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls.filter((call) =>
            String(call[0]).endsWith('/health'),
        );
        expect(healthProbes).toHaveLength(1);
    });
});

/**
 * RESPONSE VALIDATION AT THE WIRE BOUNDARY (§15, rule 4).
 *
 * Every success path in this client used to end in `return res.body as T` — eight of them. A cast asserts a
 * shape rather than establishing one, so the client's beliefs about the server were unfalsifiable at runtime:
 * a response that had drifted from the published contract did not fail here, it surfaced later as a mystery
 * `undefined` inside a caller (the recipe service's ingredient path, or a web component) with nothing pointing
 * back at the wire. The sibling `recipe-service` client already parsed; this one did not.
 *
 * These cases are the mutation guard. Each feeds a body that is WRONG in one specific way and asserts the call
 * rejects, so restoring any `as` cast reds the case for that method. Note they are not merely "parses the happy
 * path" — the fixtures above already cover that, and they passed while the casts were still in place, which is
 * exactly why the negative cases have to exist.
 */
describe('FoodServiceClient — a drifted response FAILS at the boundary, not deep in a caller', () => {
    const drifted: ReadonlyArray<readonly [string, number, unknown, (client: FoodServiceClient) => Promise<unknown>]> =
        [
            // A field the contract requires is missing.
            ['search: no `results` array', 200, {}, (c) => c.search('kale')],
            ['getStatus: no `status`', 200, { id: 'food_1' }, (c) => c.getStatus('food_1')],
            ['getCandidates: no `candidates`', 200, { id: 'food_1' }, (c) => c.getCandidates('food_1')],
            ['addByName: no `status`', 202, { id: 'food_1' }, (c) => c.addByName('kale')],
            ['batch: no `items`', 201, {}, (c) => c.batch(['kale'])],
            ['resolve: no `status`', 200, { id: 'food_1' }, (c) => c.resolve('food_1', ['cand_1'])],
            [
                'getById: a golden record missing `kind`',
                200,
                { id: 'f', name: 'n', description: 'd' },
                (c) => c.getById('f'),
            ],
            // A field is present but the WRONG TYPE — the case a presence-only check would miss.
            ['search: `results` is an object, not an array', 200, { results: {} }, (c) => c.search('kale')],
            ['getStatus: `status` is a number', 200, { id: 'f', status: 7 }, (c) => c.getStatus('f')],
            // A 202 answered with a status only a 200/404 may carry. `pendingResponseSchema.status` is now the
            // TWO-value enum in the service's own published contract, so the single envelope parse rejects it —
            // this used to need a second, client-side re-narrowing to catch, because the published response type
            // admitted all five values and a `GetFoodResult` could carry a status outside its own union.
            [
                'getById 202: a terminal `NOT_FOUND` status',
                202,
                { id: 'f', status: 'NOT_FOUND' },
                (c) => c.getById('f'),
            ],
        ];

    it.each(drifted)('rejects %s', async (_label, status, body, call) => {
        const client = new FoodServiceClient({ baseUrl: BASE, fetch: stubFetch(status, body) });

        await expect(call(client)).rejects.toThrow();
    });

    it('still returns a VALID body unchanged — the parse narrows, it does not rewrite', async () => {
        const client = new FoodServiceClient({ baseUrl: BASE, fetch: stubFetch(200, { results: [] }) });

        await expect(client.search('kale')).resolves.toEqual({ results: [] });
    });
});

/**
 * The OUTBOUND half of the contract (ADR-0014): a body this client cannot legally send never leaves.
 *
 * These assert the DISTINCTION, not merely that something throws. `InvalidRequestError` and
 * `BadRequestError` both mean "400-ish" to a careless caller, and collapsing them is what the separate type
 * exists to prevent: the first says "your body is illegal per the published contract, no request was made,
 * retrying it cannot work", the second says "the service rejected a body the contract allows". A test that
 * accepted either would not notice them being merged.
 */
describe('FoodServiceClient — outbound request validation', () => {
    /** A fetch double that FAILS the test if it is ever called — the proof that no request was issued. */
    const neverFetch: typeof fetch = () => {
        throw new Error('the client must not issue a request for a body that fails the published contract');
    };

    it('rejects an empty name before issuing a request', async () => {
        const client = new FoodServiceClient({ baseUrl: BASE, fetch: neverFetch });
        const error = await client.addByName('').catch((caught: unknown) => caught);

        expect(isInvalidRequestError(error)).toBe(true);
        // NOT the server's 400: nothing was sent, so blaming the service would send an operator hunting a
        // problem that is not happening.
        expect(error).not.toBeInstanceOf(BadRequestError);
        // The ZodError is carried so the offending field path survives to the caller.
        expect((error as InvalidRequestError).cause).toBeDefined();
    });

    // ⚠️ THE CASE THAT DEFINES THE BOUNDARY, and it goes the other way. An oversized batch is LEGAL per
    // `batchAddFoodRequestSchema` — that schema deliberately carries no `.max()`, because the cap is
    // `FOOD_MAX_BATCH_NAMES`, a runtime configuration value, and a static bound in the published contract would
    // be a second representation that disagrees the moment the environment variable is tuned (the schema says so
    // in its own header). So the request DOES go out and the server's `400` is the answer.
    //
    // Pinned because the tempting shape for this suite is "anything a caller might get wrong fails locally",
    // which would mean re-declaring server policy in the client — the exact duplication §15 forbids. The
    // outbound parse enforces the CONTRACT; it does not enforce configuration it cannot know.
    it('sends an oversized batch and surfaces the server 400, because the cap is not in the contract', async () => {
        const client = new FoodServiceClient({ baseUrl: BASE, fetch: stubFetch(400, { error: 'Too many names' }) });
        const names = Array.from({ length: 101 }, (_unused, index) => `food-${index}`);

        await expect(client.batch(names)).rejects.toBeInstanceOf(BadRequestError);
    });

    it('rejects an empty candidate list before issuing a request', async () => {
        const client = new FoodServiceClient({ baseUrl: BASE, fetch: neverFetch });

        expect(isInvalidRequestError(await client.resolve('id', []).catch((caught: unknown) => caught))).toBe(true);
    });

    // The mirror image, and the reason the suite is not just three rejections: a LEGAL body must still go out.
    // Without this, deleting every method's outbound parse and replacing it with an unconditional throw would
    // pass everything above.
    it('sends a body that satisfies the published request schema', async () => {
        const client = new FoodServiceClient({
            baseUrl: BASE,
            fetch: stubFetch(202, { id: 'f_1', status: 'PENDING' }),
        });

        await expect(client.addByName('tomato')).resolves.toStrictEqual({ id: 'f_1', status: 'PENDING' });
    });
});
/**
 * REWRITTEN for plan 002 S7.9 (the live search is gone): how a refused source call reads, driven through the remote
 * pick, the route that now makes a cook's one source call (ADR-0055 point 10). The client maps an error by its CODE,
 * whatever the route, so these cases pin that mapping: a `503` (our reserved lane is exhausted, or a drain holds the
 * food) and a `429` (this caller reached its own limit). The cook is told different things, so a client that collapsed
 * the two would strand the cook in the wrong loop. The route's own refusals are `searchProgressive.test.ts`'s.
 */
describe('FoodServiceClient.adoptRemoteFood — a refused source call', () => {
    it('throws FetchUnavailableError on 503, carrying the Retry-After a caller can act on', async () => {
        const client = new FoodServiceClient({
            baseUrl: BASE,
            fetch: stubFetch(
                503,
                { code: 'FETCH_UNAVAILABLE', message: 'shed', details: { retryAfterSeconds: 60 } },
                { 'retry-after': '60' },
            ),
        });

        const error = await client.adoptRemoteFood('sealed.ref').catch((thrown: unknown) => thrown);

        expect(isFetchUnavailableError(error)).toBe(true);
        expect((error as FetchUnavailableError).retryAfterSeconds).toBe(60);
    });

    /** The per-caller cap (plan 002 R42), in the envelope Nest's throttler produces. */
    it('throws RateLimitedError on 429, carrying the Retry-After seconds — not the 503 capacity error', async () => {
        const client = new FoodServiceClient({
            baseUrl: BASE,
            fetch: stubFetch(
                429,
                { code: 'TOO_MANY_REQUESTS', message: 'ThrottlerException: Too Many Requests' },
                { 'retry-after': '30' },
            ),
        });

        const error = await client.adoptRemoteFood('sealed.ref').catch((thrown: unknown) => thrown);

        expect(error).toBeInstanceOf(RateLimitedError);
        expect(isRateLimitedError(error)).toBe(true);
        expect(error).toHaveProperty('status', 429);
        expect(error).toHaveProperty('retryAfterSeconds', 30);
        // One meaning per type: this caller's cap is not service-wide capacity, and it is not contract drift.
        expect(isFetchUnavailableError(error)).toBe(false);
        expect(isUnexpectedResponseError(error)).toBe(false);
    });

    // Row editor item 10: the cook's own limit carries its own code, so the app can tell it from food being busy.
    it('throws RequesterLimitReachedError on 429 REQUESTER_LIMIT_REACHED, with the window', async () => {
        const client = new FoodServiceClient({
            baseUrl: BASE,
            fetch: stubFetch(
                429,
                { code: 'REQUESTER_LIMIT_REACHED', message: 'limit', details: { retryAfterSeconds: 1234 } },
                { 'retry-after': '1234' },
            ),
        });

        const error = await client.adoptRemoteFood('sealed.ref').catch((thrown: unknown) => thrown);

        expect(error).toBeInstanceOf(RequesterLimitReachedError);
        expect(isRequesterLimitReachedError(error)).toBe(true);
        expect(error).toHaveProperty('status', 429);
        expect(error).toHaveProperty('retryAfterSeconds', 1234);
        // Still a per-caller refusal to a caller that only knows the wider type.
        expect(isRateLimitedError(error)).toBe(true);
        expect(isFetchUnavailableError(error)).toBe(false);
    });

    it('reads the window from the body when a proxy stripped the Retry-After header', async () => {
        const client = new FoodServiceClient({
            baseUrl: BASE,
            fetch: stubFetch(429, {
                code: 'REQUESTER_LIMIT_REACHED',
                message: 'limit',
                details: { retryAfterSeconds: 90 },
            }),
        });

        const error = await client.resolve('f_1', ['c_1']).catch((thrown: unknown) => thrown);

        expect(isRequesterLimitReachedError(error)).toBe(true);
        expect(error).toHaveProperty('retryAfterSeconds', 90);
    });

    // The pre-change body: a 429 without the code is not proof of the cook's limit.
    it('keeps a 429 with no published code a plain RateLimitedError', async () => {
        const client = new FoodServiceClient({
            baseUrl: BASE,
            fetch: stubFetch(429, { code: 'TOO_MANY_REQUESTS', message: 'Too many' }, { 'retry-after': '30' }),
        });

        const error = await client.adoptRemoteFood('sealed.ref').catch((thrown: unknown) => thrown);

        expect(isRateLimitedError(error)).toBe(true);
        expect(isRequesterLimitReachedError(error)).toBe(false);
    });

    it('throws RateLimitedError on 429 with no Retry-After, leaving the window undefined', async () => {
        const client = new FoodServiceClient({ baseUrl: BASE, fetch: stubFetch(429) });

        const error = await client.adoptRemoteFood('sealed.ref').catch((thrown: unknown) => thrown);

        expect(isRateLimitedError(error)).toBe(true);
        expect(error).toHaveProperty('status', 429);
        expect(error).toHaveProperty('retryAfterSeconds', undefined);
    });

    // Food no longer sends `SOURCE_UNAVAILABLE` (plan 002 S7.9), so this build is not taught it: the 502 keeps its
    // status on the generic error, as any untaught code does, and is never read as busy.
    it('throws UnexpectedResponseError on a 502 SOURCE_UNAVAILABLE, keeping the status', async () => {
        const client = new FoodServiceClient({
            baseUrl: BASE,
            fetch: stubFetch(502, { code: 'SOURCE_UNAVAILABLE', message: 'The food data source is unavailable' }),
        });

        const error = await client.adoptRemoteFood('sealed.ref').catch((thrown: unknown) => thrown);

        expect(isUnexpectedResponseError(error)).toBe(true);
        expect(error).toHaveProperty('status', 502);
        expect(isFetchUnavailableError(error)).toBe(false);
    });
});

/**
 * `resolveRefs` — `POST /api/v1/foods/refs/resolve` (curated U8, roots slice). The recipe service calls this for
 * every line name it shows, through a gateway that must turn ANY failure into "food unreachable". So the one
 * thing this method may never do is return something that reads as an answer when there was none: every
 * non-200 THROWS. Absence is reported INSIDE a 200 body (`outcome: 'absent'`), which is why a 404 here can
 * only mean the route itself is not served (a food deployed behind recipe, ADR-0036) — and why it must not
 * surface as a {@link NotFoundError}, the error that means "no such food".
 */
describe('FoodServiceClient.resolveRefs', () => {
    const REFS = [
        { kind: 'root' as const, id: 'food_1' },
        { kind: 'variant' as const, id: 'v_1' },
    ];
    const ANSWER = {
        entries: [
            { outcome: 'found', ref: REFS[0], name: 'Broccoli, raw', status: 'RESOLVED' },
            { outcome: 'absent', ref: REFS[1] },
        ],
    };

    it('POSTs the refs to refs/resolve with the bearer and returns the parsed 200 body', async () => {
        const fetchMock = stubFetch(200, ANSWER);
        const client = new FoodServiceClient({ baseUrl: BASE, token: 'tok', fetch: fetchMock });

        await expect(client.resolveRefs(REFS)).resolves.toStrictEqual(ANSWER);

        const [url, init] = apiCalls(fetchMock)[0]! as [string, Record<string, never>];
        expect(url).toBe(`${BASE}/api/v1/foods/refs/resolve`);
        expect(init.method).toBe('POST');
        expect(init.headers['authorization']).toBe('Bearer tok');
        expect(JSON.parse(init.body)).toStrictEqual({ refs: REFS });
    });

    it('⛔ a 404 (the route is not served) THROWS — and not as NotFoundError, which means "no such food"', async () => {
        const client = new FoodServiceClient({
            baseUrl: BASE,
            fetch: stubFetch(404, { code: 'HTTP_404', message: 'Cannot POST /api/v1/foods/refs/resolve' }),
        });

        const error = await client.resolveRefs(REFS).catch((caught: unknown) => caught);

        expect(isUnexpectedResponseError(error)).toBe(true);
        expect(isNotFoundError(error)).toBe(false);
        expect((error as { status?: number }).status).toBe(404);
    });

    it('a 500 THROWS', async () => {
        const client = new FoodServiceClient({
            baseUrl: BASE,
            fetch: stubFetch(500, { code: 'INTERNAL_ERROR', message: 'Internal server error' }),
        });

        const error = await client.resolveRefs(REFS).catch((caught: unknown) => caught);

        expect(isUnexpectedResponseError(error)).toBe(true);
    });

    it('a 401 THROWS the typed auth error', async () => {
        const client = new FoodServiceClient({
            baseUrl: BASE,
            fetch: stubFetch(401, { code: 'UNAUTHORIZED', message: 'no token' }),
        });

        expect(isUnauthorizedError(await client.resolveRefs(REFS).catch((caught: unknown) => caught))).toBe(true);
    });

    it('a 201 is not the route’s success status, so it THROWS rather than being read as an answer', async () => {
        const client = new FoodServiceClient({ baseUrl: BASE, fetch: stubFetch(201, ANSWER) });

        await expect(client.resolveRefs(REFS)).rejects.toThrow();
    });

    it('a 200 whose body drifted from the contract fails at the boundary', async () => {
        const client = new FoodServiceClient({ baseUrl: BASE, fetch: stubFetch(200, { results: [] }) });

        await expect(client.resolveRefs(REFS)).rejects.toThrow();
    });

    it.each([
        ['an empty list', []],
        [
            'one ref over the published cap',
            Array.from({ length: 101 }, (_, index) => ({ kind: 'root', id: `f${index}` })),
        ],
    ])('refuses %s with InvalidRequestError, sending NOTHING', async (_label, refs) => {
        const fetchMock = stubFetch(200, ANSWER);
        const client = new FoodServiceClient({ baseUrl: BASE, fetch: fetchMock });

        const error = await client
            .resolveRefs(refs as { kind: 'root'; id: string }[])
            .catch((caught: unknown) => caught);

        expect(isInvalidRequestError(error)).toBe(true);
        expect((fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
    });

    it('honours the caller’s deadline signal', async () => {
        const fetchMock = vi.fn(
            (_url: string, init?: RequestInit) =>
                new Promise<Response>((_resolve, reject) => {
                    const abort = (): void => {
                        reject(new DOMException('aborted', 'AbortError'));
                    };

                    // The caller aborts before the token resolves, so the signal can arrive ALREADY aborted.
                    if (init?.signal?.aborted === true) {
                        abort();

                        return;
                    }

                    init?.signal?.addEventListener('abort', abort);
                }),
        ) as unknown as typeof fetch;
        const client = new FoodServiceClient({ baseUrl: BASE, fetch: fetchMock, timeoutMs: 60_000 });
        const deadline = new AbortController();

        const pending = client.resolveRefs(REFS, { signal: deadline.signal }).catch((caught: unknown) => caught);
        deadline.abort();

        expect(isFetchUnavailableError(await pending)).toBe(true);
    });
});

/**
 * The split food search (plan 002 R40, S3): `searchCatalog` reads the SHARED catalog route the edge caches on its URL,
 * `searchAuthored` reads the caller's own authored foods. The client parses the term with the service's own
 * `searchTermQuerySchema` and builds the URL from the PARSED value, so two cooks typing one search differently send
 * one URL (property 3), and a term the service refuses never leaves the client.
 */
describe('FoodServiceClient.searchCatalog / searchAuthored (plan 002 S3)', () => {
    const CATALOG_HIT = { id: 'food_1', name: 'chicken breast', score: 0.8 };
    const AUTHORED_HIT = { id: 'food_9', name: 'my chicken breast', score: 0.7 };

    it.each([
        ['searchCatalog', '/api/v1/foods/catalog/search'],
        ['searchAuthored', '/api/v1/foods/authored/search'],
    ] as const)('%s GETs %s with the canonical term and the bearer', async (method, path) => {
        const fetchMock = stubFetch(200, { results: [] });
        const client = new FoodServiceClient({ baseUrl: BASE, token: 'tok', fetch: fetchMock });

        await client[method]('  Chicken   BREAST\t');

        const [url, init] = apiCalls(fetchMock)[0]! as [string, Record<string, never>];
        expect(url).toBe(`${BASE}${path}?query=chicken%20breast`);
        expect(init.method).toBe('GET');
        expect(init.headers['authorization']).toBe('Bearer tok');
    });

    it('sends ONE url for one search however it was typed, so the edge shares one entry', async () => {
        const fetchMock = stubFetch(200, { results: [] });
        const client = new FoodServiceClient({ baseUrl: BASE, fetch: fetchMock });

        for (const typed of ['beef brisket', 'Beef Brisket', ' beef\u00a0 BRISKET ']) {
            await client.searchCatalog(typed);
        }

        expect(new Set(apiCalls(fetchMock).map(([url]) => url))).toStrictEqual(
            new Set([`${BASE}/api/v1/foods/catalog/search?query=beef%20brisket`]),
        );
    });

    // `'İ'.repeat(101)` is within the raw bound, but lowercases to 202 code units, which the service would refuse.
    it.each(['', '   ', 'x'.repeat(201), 'İ'.repeat(101)])(
        'refuses %j before any request, as the service would',
        async (term) => {
            const fetchMock = stubFetch(200, { results: [] });
            const client = new FoodServiceClient({ baseUrl: BASE, fetch: fetchMock });

            for (const call of [client.searchCatalog(term), client.searchAuthored(term)]) {
                await expect(call).rejects.toSatisfy(isInvalidRequestError);
            }

            expect(apiCalls(fetchMock)).toHaveLength(0);
        },
    );

    /**
     * Half of a surrogate pair (a cut or a bad paste can leave one) has no URL encoding, so `encodeURIComponent` throws a
     * bare `URIError` on it. Every search that puts typed text in its URL refuses such a term with this client's own
     * typed error instead, and sends nothing.
     */
    it.each([
        ['a lone high surrogate', 'egg \uD83E'],
        ['a lone low surrogate', '\uDD5A egg'],
    ])('refuses %s before any request, with its typed error', async (_case, term) => {
        const fetchMock = stubFetch(200, { results: [] });
        const client = new FoodServiceClient({ baseUrl: BASE, fetch: fetchMock });

        for (const call of [
            client.searchCatalog(term),
            client.searchAuthored(term),
            client.searchProgressive(term).next(),
            client.search(term),
        ]) {
            await expect(call).rejects.toSatisfy(isInvalidRequestError);
        }

        expect(apiCalls(fetchMock)).toHaveLength(0);
    });

    it('sends a term holding a whole surrogate pair', async () => {
        const fetchMock = stubFetch(200, { results: [] });
        const client = new FoodServiceClient({ baseUrl: BASE, fetch: fetchMock });

        await client.searchCatalog('🥚 egg');

        expect(apiCalls(fetchMock)[0]?.[0]).toBe(`${BASE}/api/v1/foods/catalog/search?query=%F0%9F%A5%9A%20egg`);
    });

    it('returns the catalog hits, and drops a visibility a catalog body must never carry', async () => {
        const client = new FoodServiceClient({
            baseUrl: BASE,
            fetch: stubFetch(200, { results: [{ ...CATALOG_HIT, visibility: 'private' }] }),
        });

        await expect(client.searchCatalog('chicken breast')).resolves.toStrictEqual({ results: [CATALOG_HIT] });
    });

    /**
     * An authored hit is `{ id, name, score }` and nothing more: the ROUTE says whose the food is (plan 002 S3 property
     * 7), so the body no longer repeats it as a `visibility` field. The previous version of this test expected that
     * field, and its sibling expected a body without it to be refused; the contract dropped the field on purpose.
     */
    it('returns the authored hits as id, name and score', async () => {
        const client = new FoodServiceClient({ baseUrl: BASE, fetch: stubFetch(200, { results: [AUTHORED_HIT] }) });

        await expect(client.searchAuthored('chicken breast')).resolves.toStrictEqual({ results: [AUTHORED_HIT] });
    });

    it('drops a visibility an authored body still carries, so no caller can read whose a food is from a field', async () => {
        const client = new FoodServiceClient({
            baseUrl: BASE,
            fetch: stubFetch(200, { results: [{ ...AUTHORED_HIT, visibility: 'private' }] }),
        });

        await expect(client.searchAuthored('chicken breast')).resolves.toStrictEqual({ results: [AUTHORED_HIT] });
    });

    // Property 5b: the search limit is its own refusal. It is a per-caller 429, so a caller knowing only the wider type
    // still reads it right, but it is NOT the source-call limit, whose sentence ("your lookups") would be wrong.
    it.each(['searchCatalog', 'searchAuthored'] as const)(
        '%s throws SearchRateLimitedError on 429 SEARCH_RATE_LIMITED, with the header window first',
        async (method) => {
            const client = new FoodServiceClient({
                baseUrl: BASE,
                fetch: stubFetch(
                    429,
                    { code: 'SEARCH_RATE_LIMITED', message: 'limit', details: { retryAfterSeconds: 40 } },
                    { 'retry-after': '41' },
                ),
            });

            const error = await client[method]('egg').catch((thrown: unknown) => thrown);

            expect(error).toBeInstanceOf(SearchRateLimitedError);
            expect(isSearchRateLimitedError(error)).toBe(true);
            expect(error).toHaveProperty('retryAfterSeconds', 41);
            expect(isRateLimitedError(error)).toBe(true);
            expect(isRequesterLimitReachedError(error)).toBe(false);
        },
    );

    it('reads the search window from the body when a proxy stripped the header', async () => {
        const client = new FoodServiceClient({
            baseUrl: BASE,
            fetch: stubFetch(429, {
                code: 'SEARCH_RATE_LIMITED',
                message: 'limit',
                details: { retryAfterSeconds: 40 },
            }),
        });

        await expect(client.searchCatalog('egg')).rejects.toHaveProperty('retryAfterSeconds', 40);
    });

    it('keeps the source-call limit its own error on the remote pick, so the two never blur', async () => {
        const client = new FoodServiceClient({
            baseUrl: BASE,
            fetch: stubFetch(429, {
                code: 'REQUESTER_LIMIT_REACHED',
                message: 'limit',
                details: { retryAfterSeconds: 9 },
            }),
        });

        const error = await client.adoptRemoteFood('sealed.ref').catch((thrown: unknown) => thrown);

        expect(isRequesterLimitReachedError(error)).toBe(true);
        expect(isSearchRateLimitedError(error)).toBe(false);
    });

    it("maps the authored route's IDENTITY_SYNC_PENDING to UnauthorizedError, keeping the retry message", async () => {
        const client = new FoodServiceClient({
            baseUrl: BASE,
            fetch: stubFetch(401, { code: 'IDENTITY_SYNC_PENDING', message: 'retry with a refreshed token' }),
        });

        const error = await client.searchAuthored('egg').catch((thrown: unknown) => thrown);

        expect(error).toBeInstanceOf(UnauthorizedError);
        expect((error as UnauthorizedError).message).toBe('retry with a refreshed token');
    });
});

/**
 * Back pressure on the split search (plan 002 S5): once food refuses a route with `429 SEARCH_RATE_LIMITED`, this client
 * sends nothing on that route until the window it named has passed, and answers each call with the same refusal and the
 * seconds still to wait. A cook typing through a refusal would otherwise spend a request per keystroke on a route that
 * has already said no. Only `Date` is faked, so the client's own timers stay real.
 */
describe('FoodServiceClient — the split search waits out its Retry-After', () => {
    const T0 = Date.UTC(2026, 9, 2, 12, 0, 0);

    /** A 429 SEARCH_RATE_LIMITED naming `seconds`, in the header and the body. */
    const limited = (seconds: string, bodySeconds = 40): Response =>
        new Response(
            JSON.stringify({
                code: 'SEARCH_RATE_LIMITED',
                message: 'limit',
                details: { retryAfterSeconds: bodySeconds },
            }),
            { status: 429, headers: { 'retry-after': seconds } },
        );

    /** A `fetch` double answering each API call with the next response in `answers`, then with an empty 200. */
    function answering(...answers: Response[]): typeof fetch {
        const queue = [...answers];

        return vi.fn(async (url: string) =>
            url.endsWith('/health') || queue.length === 0
                ? new Response(JSON.stringify({ results: [] }), { status: 200 })
                : queue.shift()!,
        ) as unknown as typeof fetch;
    }

    /** Move the faked clock to `T0 + ms`. */
    const at = (ms: number): void => {
        vi.setSystemTime(T0 + ms);
    };

    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        at(0);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('sends nothing on the refused route until the window passes, and says how long is left', async () => {
        const fetchMock = answering(limited('30'));
        const client = new FoodServiceClient({ baseUrl: BASE, fetch: fetchMock });

        await expect(client.searchCatalog('egg')).rejects.toSatisfy(isSearchRateLimitedError);
        at(10_000);
        const refused = await client.searchCatalog('eggs').catch((thrown: unknown) => thrown);

        expect(refused).toBeInstanceOf(SearchRateLimitedError);
        expect(refused).toHaveProperty('retryAfterSeconds', 20);
        expect(apiCalls(fetchMock)).toHaveLength(1);
    });

    it('rounds the seconds left up, so it never says 0 while still refusing', async () => {
        const client = new FoodServiceClient({ baseUrl: BASE, fetch: answering(limited('30')) });

        await client.searchCatalog('egg').catch(() => undefined);
        at(29_500);

        await expect(client.searchCatalog('egg')).rejects.toHaveProperty('retryAfterSeconds', 1);
    });

    it('asks again once the window has passed', async () => {
        const fetchMock = answering(limited('30'));
        const client = new FoodServiceClient({ baseUrl: BASE, fetch: fetchMock });

        await client.searchCatalog('egg').catch(() => undefined);
        at(30_000);

        await expect(client.searchCatalog('egg')).resolves.toStrictEqual({ results: [] });
        expect(apiCalls(fetchMock)).toHaveLength(2);
    });

    it('holds each route on its own: a refused catalog search does not stop the authored one', async () => {
        const fetchMock = answering(limited('30'));
        const client = new FoodServiceClient({ baseUrl: BASE, fetch: fetchMock });

        await client.searchCatalog('egg').catch(() => undefined);
        at(1_000);

        await expect(client.searchAuthored('egg')).resolves.toStrictEqual({ results: [] });
        expect(apiCalls(fetchMock)).toHaveLength(2);
    });

    it('holds the authored route after its own refusal', async () => {
        const fetchMock = answering(limited('30'));
        const client = new FoodServiceClient({ baseUrl: BASE, fetch: fetchMock });

        await client.searchAuthored('egg').catch(() => undefined);
        at(1_000);

        await expect(client.searchAuthored('egg')).rejects.toHaveProperty('retryAfterSeconds', 29);
        expect(apiCalls(fetchMock)).toHaveLength(1);
    });

    it('keeps the later end when two refusals arrive for one route', async () => {
        const client = new FoodServiceClient({ baseUrl: BASE, fetch: answering(limited('40'), limited('10')) });

        // Both are in flight before either answers, which is the only way a second refusal can arrive.
        await Promise.allSettled([client.searchCatalog('egg'), client.searchCatalog('eggs')]);
        at(20_000);

        await expect(client.searchCatalog('egg')).rejects.toHaveProperty('retryAfterSeconds', 20);
    });

    // A header that is neither a number of seconds nor an HTTP date states nothing, so the body's window holds. This test
    // used to expect a fixed 60 seconds here, which was the defect: the header read as `NaN` and hid the body's window.
    it('waits the body’s window when the header states no window it can read', async () => {
        const fetchMock = answering(limited('soon', 40));
        const client = new FoodServiceClient({ baseUrl: BASE, fetch: fetchMock });

        await client.searchCatalog('egg').catch(() => undefined);
        at(39_000);
        await expect(client.searchCatalog('egg')).rejects.toHaveProperty('retryAfterSeconds', 1);
        at(40_000);

        await expect(client.searchCatalog('egg')).resolves.toStrictEqual({ results: [] });
    });

    it('waits until an HTTP-date Retry-After', async () => {
        const fetchMock = answering(limited(new Date(T0 + 25_000).toUTCString(), 40));
        const client = new FoodServiceClient({ baseUrl: BASE, fetch: fetchMock });

        await client.searchCatalog('egg').catch(() => undefined);
        at(24_000);
        await expect(client.searchCatalog('egg')).rejects.toHaveProperty('retryAfterSeconds', 1);
        at(25_000);

        await expect(client.searchCatalog('egg')).resolves.toStrictEqual({ results: [] });
    });

    // A date already past says the window is over, so the next search is sent at once rather than held.
    it('holds nothing after a refusal whose Retry-After date has passed', async () => {
        const fetchMock = answering(limited(new Date(T0 - 5_000).toUTCString(), 40));
        const client = new FoodServiceClient({ baseUrl: BASE, fetch: fetchMock });

        await expect(client.searchCatalog('egg')).rejects.toHaveProperty('retryAfterSeconds', 0);

        await expect(client.searchCatalog('egg')).resolves.toStrictEqual({ results: [] });
        expect(apiCalls(fetchMock)).toHaveLength(2);
    });

    // Only food's own search limit names a window this client knows how to read; another layer's 429 is not that limit.
    it('holds nothing after a 429 that is not the search limit', async () => {
        const fetchMock = answering(
            new Response(JSON.stringify({ message: 'slow down' }), { status: 429, headers: { 'retry-after': '30' } }),
        );
        const client = new FoodServiceClient({ baseUrl: BASE, fetch: fetchMock });

        await expect(client.searchCatalog('egg')).rejects.toSatisfy(
            (error: unknown) => isRateLimitedError(error) && !isSearchRateLimitedError(error),
        );
        at(1_000);

        await expect(client.searchCatalog('egg')).resolves.toStrictEqual({ results: [] });
        expect(apiCalls(fetchMock)).toHaveLength(2);
    });

    // The apps build one client per signed-in cook, so a refusal for one cook never holds another's searches.
    it('holds only the client that was refused', async () => {
        const fetchMock = answering(limited('30'));

        await new FoodServiceClient({ baseUrl: BASE, fetch: fetchMock }).searchCatalog('egg').catch(() => undefined);

        await expect(
            new FoodServiceClient({ baseUrl: BASE, fetch: fetchMock }).searchCatalog('egg'),
        ).resolves.toStrictEqual({ results: [] });
    });
});

/**
 * `Retry-After` is read as RFC 9110 states it (§10.2.3): a number of seconds or an HTTP date, the date relative to the
 * clock at receipt. A header this client cannot read states nothing, so the body's window is used instead; a date
 * already past is no wait at all. The parser is `@kitchensink/retry-after`, which food-service's own block rule reads
 * the source's header with, so the two ends of the wire read the field one way.
 */
describe('FoodServiceClient — reading Retry-After', () => {
    const T0 = Date.UTC(2026, 9, 2, 12, 0, 0);

    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(T0);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    /** The busy refusal food sends, with the body's window and the given header. */
    const busy = (header: string): typeof fetch =>
        stubFetch(
            503,
            { code: 'FETCH_UNAVAILABLE', message: 'busy', details: { retryAfterSeconds: 42 } },
            {
                'retry-after': header,
            },
        );

    it.each([
        ['an HTTP date', new Date(T0 + 90_000).toUTCString(), 90],
        ['a number of seconds', '17', 17],
        ['a header that is neither form, by the body’s window', 'soon', 42],
        ['a delay too large to be real, by the body’s window', '9'.repeat(400), 42],
        ['a date already past as no wait', new Date(T0 - 5_000).toUTCString(), 0],
    ])('reads %s', async (_case, header, seconds) => {
        const client = new FoodServiceClient({ baseUrl: BASE, fetch: busy(header) });

        await expect(client.addByName('x')).rejects.toHaveProperty('retryAfterSeconds', seconds);
    });

    it('states no window for a header it cannot read on a 429 that carries no published code', async () => {
        const client = new FoodServiceClient({
            baseUrl: BASE,
            fetch: stubFetch(429, { message: 'slow down' }, { 'retry-after': 'soon' }),
        });

        await expect(client.adoptRemoteFood('sealed.ref')).rejects.toHaveProperty('retryAfterSeconds', undefined);
    });
});

/**
 * The two narrowed `429` errors carry the window they were given. Each re-declares `retryAfterSeconds` as a number, and
 * a class-fields transform (Metro's Babel, in the mobile bundle) re-initialises a re-declared field after `super()`, so
 * the window survives only because the constructor assigns it again.
 */
describe('the narrowed 429 errors keep their window', () => {
    it.each([
        ['RequesterLimitReachedError', (seconds: number) => new RequesterLimitReachedError(seconds)],
        ['SearchRateLimitedError', (seconds: number) => new SearchRateLimitedError(seconds)],
    ] as const)('%s carries the seconds it was constructed with', (_name, make) => {
        const error = make(37);

        expect(error.retryAfterSeconds).toBe(37);
        expect(Object.getOwnPropertyDescriptor(error, 'retryAfterSeconds')?.value).toBe(37);
    });
});
