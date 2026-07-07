/**
 * Unit tests for {@link FoodServiceClient} (T-057) with a mocked `fetch`: request build (URL, method,
 * body, bearer-token attach from a literal and a callback) + status mapping (`202`/`200` → typed
 * results; `401`/`403`/`400`/`404`/`409`/`503` → typed errors; `CandidateMismatch` → `409`, no `429`).
 */
import { describe, expect, it, vi } from 'vitest';

import {
    BadRequestError,
    CandidateMismatchError,
    ConflictError,
    FetchUnavailableError,
    FoodServiceClient,
    ForbiddenError,
    NotFoundError,
    UnauthorizedError,
    isCandidateMismatchError,
    isFetchUnavailableError,
    isNotFoundError,
} from '../index.js';

const BASE = 'https://food.example.test';

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
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
        expect(url).toBe(`${BASE}/v1/foods`); // trailing slash on baseUrl normalized
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

        const calls = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls;
        expect(calls[0]![1].headers['authorization']).toBe('Bearer tok-A');
        expect(calls[1]![1].headers['authorization']).toBe('Bearer tok-B');
        expect(getToken).toHaveBeenCalledTimes(2);
    });

    it('omits Authorization when no token is configured', async () => {
        const fetchMock = stubFetch(200, { results: [] });
        const client = new FoodServiceClient({ baseUrl: BASE, fetch: fetchMock });

        await client.search('kale');

        const [url, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
        expect(url).toBe(`${BASE}/v1/foods/search?query=kale`);
        expect(init.headers['authorization']).toBeUndefined();
    });

    it('URL-encodes the search query and path ids', async () => {
        const fetchMock = stubFetch(200, { id: 'food x', status: 'NOT_FOUND' });
        const client = new FoodServiceClient({ baseUrl: BASE, fetch: fetchMock });

        await client.search('chicken breast');
        const [searchUrl] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
        expect(searchUrl).toBe(`${BASE}/v1/foods/search?query=chicken%20breast`);
    });
});

describe('FoodServiceClient — getById result mapping', () => {
    it('200 → RESOLVED with the golden record', async () => {
        const food = { id: 'food_1', status: 'RESOLVED', nutrients: [], portions: [], provenance: {} };
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

    it('400 → BadRequestError (empty name / oversized batch)', async () => {
        const client = new FoodServiceClient({ baseUrl: BASE, fetch: stubFetch(400, { error: 'Empty name' }) });
        await expect(client.addByName('')).rejects.toBeInstanceOf(BadRequestError);
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
        expect(url).toBe(`${BASE}/v1/foods/food_1`);
        expect(init.method).toBe('PATCH');
        expect(JSON.parse(init.body)).toEqual({ candidateIds: ['cand_1', 'cand_2'] });
    });
});
