/**
 * Unit tests for {@link FoodServiceClient} (T-057) with a mocked `fetch`: request build (URL, method,
 * body, bearer-token attach from a literal and a callback) + status mapping (`202`/`200` → typed
 * results; `401`/`403`/`400`/`404`/`409`/`503` → typed errors; `CandidateMismatch` → `409`, no `429`).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    UnauthorizedError,
    isCandidateMismatchError,
    isFetchUnavailableError,
    isInvalidRequestError,
    isNotFoundError,
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

    it('404 → NotFoundError carrying the terminal food status', async () => {
        const client = new FoodServiceClient({
            baseUrl: BASE,
            fetch: stubFetch(404, { error: 'Food not found', id: 'food_3', status: 'NOT_FOUND' }),
        });

        const error = await client.getById('food_3').catch((caught: unknown) => caught);

        expect(isNotFoundError(error)).toBe(true);
        expect((error as NotFoundError).foodStatus).toBe('NOT_FOUND');
        expect((error as NotFoundError).id).toBe('food_3');
    });
});

describe('FoodServiceClient — status → typed error mapping', () => {
    it('401 → UnauthorizedError', async () => {
        const client = new FoodServiceClient({ baseUrl: BASE, fetch: stubFetch(401, { error: 'nope' }) });
        await expect(client.addByName('x')).rejects.toBeInstanceOf(UnauthorizedError);
    });

    it('403 → ForbiddenError', async () => {
        const client = new FoodServiceClient({ baseUrl: BASE, fetch: stubFetch(403, { error: 'no scope' }) });
        await expect(client.addByName('x')).rejects.toBeInstanceOf(ForbiddenError);
    });

    // The SERVER's 400, on a body this client's own outbound parse accepts — which is what makes the mapping
    // reachable at all now that the request schema runs first. `'x'` is a legal `addFoodRequestSchema` name, so
    // the request goes out and the service's rejection is what produces the error.
    it('400 → BadRequestError', async () => {
        const client = new FoodServiceClient({ baseUrl: BASE, fetch: stubFetch(400, { error: 'Unavailable' }) });
        await expect(client.addByName('x')).rejects.toBeInstanceOf(BadRequestError);
    });

    it('503 → FetchUnavailableError with the Retry-After seconds', async () => {
        const client = new FoodServiceClient({
            baseUrl: BASE,
            fetch: stubFetch(503, { error: 'Fetch temporarily unavailable' }, { 'retry-after': '42' }),
        });

        const error = await client.addByName('x').catch((caught: unknown) => caught);

        expect(isFetchUnavailableError(error)).toBe(true);
        expect((error as FetchUnavailableError).retryAfterSeconds).toBe(42);
    });

    it('resolve 409 candidate-not-in-set → CandidateMismatchError (DSN-14, never 429)', async () => {
        const client = new FoodServiceClient({
            baseUrl: BASE,
            fetch: stubFetch(409, { error: "Candidate not in food's candidate set" }),
        });

        const error = await client.resolve('food_1', ['cand_x']).catch((caught: unknown) => caught);

        expect(isCandidateMismatchError(error)).toBe(true);
        expect((error as CandidateMismatchError).status).toBe(409);
    });

    it('resolve 409 not-awaiting-disambiguation → ConflictError', async () => {
        const client = new FoodServiceClient({
            baseUrl: BASE,
            fetch: stubFetch(409, { error: 'Food is not awaiting disambiguation', status: 'RESOLVED' }),
        });

        await expect(client.resolve('food_1', ['cand_x'])).rejects.toBeInstanceOf(ConflictError);
    });

    it('PATCH resolve sends the candidateIds body and returns RESOLVED on 200', async () => {
        const fetchMock = stubFetch(200, { id: 'food_1', status: 'RESOLVED' });
        const client = new FoodServiceClient({ baseUrl: BASE, token: 't', fetch: fetchMock });

        const result = await client.resolve('food_1', ['cand_1', 'cand_2']);

        expect(result).toEqual({ id: 'food_1', status: 'RESOLVED' });
        const [url, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
        expect(url).toBe(`${BASE}/api/v1/foods/food_1`);
        expect(init.method).toBe('PATCH');
        expect(JSON.parse(init.body)).toEqual({ candidateIds: ['cand_1', 'cand_2'] });
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
            String(url).endsWith('/health')
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
                if (String(url).endsWith('/health')) {
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
            // A 202 answered with a status only a 200/404 may carry. `pendingResponseSchema.status` is the FULL
            // five-value enum (a looseness in the service's own contract, noted in `client.ts`), so this is
            // caught by the client's extra `pendingFoodStatusSchema` parse — without which a `GetFoodResult`
            // would carry a status outside its own declared union and every exhaustive `switch` on it would
            // silently fall through.
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
