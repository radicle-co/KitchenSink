/**
 * Unit tests for {@link UsdaApiClient}.
 *
 * Traceability:
 * - FR-023 (USDA API integration) — typed wrapper over the FoodData Central REST API
 * - T-003 acceptance:
 *   - error mapping: 404 → UsdaNotFoundError, 429 → UsdaRateLimitError, 5xx → UsdaServerError
 *   - getFoodsBatch rejects arrays > 20 ids with InvalidBatchSizeError
 *
 * The HTTP layer is mocked via an injected `fetch` (`vi.fn()`); no network calls are made.
 */
import { describe, expect, it, vi } from 'vitest';

import { UsdaApiClient } from '../UsdaApiClient.js';
import {
    isInvalidBatchSizeError,
    isUsdaNotFoundError,
    isUsdaRateLimitError,
    isUsdaSchemaError,
    isUsdaServerError,
    isUsdaTimeoutError,
    UsdaTimeoutError,
} from '../errors.js';

type FetchMock = ReturnType<typeof vi.fn>;

interface MockResponseInit {
    readonly status: number;
    readonly body?: unknown;
}

/** Build a minimal `Response`-shaped object the client can consume. */
function mockResponse({ status, body }: MockResponseInit): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body ?? {},
    } as unknown as Response;
}

/** Construct a client whose HTTP layer is the supplied mock. */
function makeClient(fetchImpl: FetchMock): UsdaApiClient {
    return new UsdaApiClient({
        apiKey: 'test-key',
        baseUrl: 'https://api.nal.usda.gov/fdc/v1',
        fetchFn: fetchImpl as unknown as typeof fetch,
    });
}

const FOOD_DETAIL = {
    fdcId: 171688,
    description: 'Apple, raw, granny smith',
    dataType: 'Foundation',
    foodNutrients: [{ nutrient: { id: 1008, name: 'Energy', unitName: 'KCAL' }, amount: 58 }],
};

describe('UsdaApiClient', () => {
    describe('getFood', () => {
        it('returns a typed food detail on 200', async () => {
            const fetchFn = vi.fn().mockResolvedValue(mockResponse({ status: 200, body: FOOD_DETAIL }));
            const client = makeClient(fetchFn);

            const food = await client.getFood(171688);

            expect(food.fdcId).toBe(171688);
            expect(food.description).toBe('Apple, raw, granny smith');
            expect(fetchFn).toHaveBeenCalledTimes(1);
        });

        it('throws UsdaSchemaError on a 200 with a malformed body (missing fdcId)', async () => {
            const fetchFn = vi.fn().mockResolvedValue(
                mockResponse({
                    status: 200,
                    // fdcId omitted, description present — a malformed upstream body.
                    body: { description: 'Apple, raw, granny smith', foodNutrients: [] },
                }),
            );
            const client = makeClient(fetchFn);

            await expect(client.getFood(171688)).rejects.toSatisfy(isUsdaSchemaError);
            // A schema failure on a 2xx body is NOT a server (5xx) error.
            await expect(client.getFood(171688)).rejects.not.toSatisfy(isUsdaServerError);
        });

        it('throws UsdaSchemaError on a 200 with a wrong-typed description', async () => {
            const fetchFn = vi.fn().mockResolvedValue(
                mockResponse({
                    status: 200,
                    body: { fdcId: 171688, description: 12345, foodNutrients: [] },
                }),
            );
            const client = makeClient(fetchFn);

            await expect(client.getFood(171688)).rejects.toSatisfy(isUsdaSchemaError);
        });

        it('parses a 200 body with extra unknown USDA fields (tolerance)', async () => {
            const fetchFn = vi.fn().mockResolvedValue(
                mockResponse({
                    status: 200,
                    body: {
                        ...FOOD_DETAIL,
                        // Fields we do not model must not fail validation.
                        ndbNumber: 9003,
                        foodCategory: { id: 9, description: 'Fruits and Fruit Juices' },
                        scientificName: 'Malus domestica',
                    },
                }),
            );
            const client = makeClient(fetchFn);

            const food = await client.getFood(171688);

            expect(food.fdcId).toBe(171688);
            expect(food.description).toBe('Apple, raw, granny smith');
        });

        it('throws UsdaNotFoundError on 404', async () => {
            const fetchFn = vi.fn().mockResolvedValue(mockResponse({ status: 404 }));
            const client = makeClient(fetchFn);

            await expect(client.getFood(999999)).rejects.toSatisfy(isUsdaNotFoundError);
        });

        it('throws UsdaRateLimitError on 429', async () => {
            const fetchFn = vi.fn().mockResolvedValue(mockResponse({ status: 429 }));
            const client = makeClient(fetchFn);

            await expect(client.getFood(171688)).rejects.toSatisfy(isUsdaRateLimitError);
        });

        it('throws UsdaServerError on 5xx', async () => {
            const fetchFn = vi.fn().mockResolvedValue(mockResponse({ status: 503 }));
            const client = makeClient(fetchFn);

            await expect(client.getFood(171688)).rejects.toSatisfy(isUsdaServerError);
        });
    });

    describe('getFoodsBatch', () => {
        it('rejects arrays larger than 20 ids with InvalidBatchSizeError (no HTTP call)', async () => {
            const fetchFn = vi.fn();
            const client = makeClient(fetchFn);
            const ids = Array.from({ length: 21 }, (_, i) => i + 1);

            await expect(client.getFoodsBatch(ids)).rejects.toSatisfy(isInvalidBatchSizeError);
            expect(fetchFn).not.toHaveBeenCalled();
        });

        it('accepts exactly 20 ids and returns typed details', async () => {
            const fetchFn = vi
                .fn()
                .mockResolvedValue(mockResponse({ status: 200, body: [FOOD_DETAIL, { ...FOOD_DETAIL, fdcId: 2 }] }));
            const client = makeClient(fetchFn);
            const ids = Array.from({ length: 20 }, (_, i) => i + 1);

            const foods = await client.getFoodsBatch(ids);

            expect(foods).toHaveLength(2);
            expect(foods[0]?.fdcId).toBe(171688);
            expect(fetchFn).toHaveBeenCalledTimes(1);
        });

        it('maps a 5xx batch response to UsdaServerError', async () => {
            const fetchFn = vi.fn().mockResolvedValue(mockResponse({ status: 500 }));
            const client = makeClient(fetchFn);

            await expect(client.getFoodsBatch([1, 2, 3])).rejects.toSatisfy(isUsdaServerError);
        });
    });

    describe('searchFoods', () => {
        it('returns a typed search result on 200', async () => {
            const fetchFn = vi.fn().mockResolvedValue(
                mockResponse({
                    status: 200,
                    body: { totalHits: 1, foods: [{ fdcId: 171688, description: 'Apple', dataType: 'Foundation' }] },
                }),
            );
            const client = makeClient(fetchFn);

            const result = await client.searchFoods('apple');

            expect(result.totalHits).toBe(1);
            expect(result.foods[0]?.fdcId).toBe(171688);
        });

        it('throws UsdaRateLimitError on 429', async () => {
            const fetchFn = vi.fn().mockResolvedValue(mockResponse({ status: 429 }));
            const client = makeClient(fetchFn);

            await expect(client.searchFoods('apple')).rejects.toSatisfy(isUsdaRateLimitError);
        });

        it('requests exactly one batch-sized page (pageSize = the 20-key batch cap)', async () => {
            const fetchFn = vi.fn().mockResolvedValue(mockResponse({ status: 200, body: { totalHits: 0, foods: [] } }));
            const client = makeClient(fetchFn);

            await client.searchFoods('apple');

            expect(fetchFn.mock.calls[0]?.[0]).toContain('pageSize=20');
        });
    });

    // Transport failures and client aborts are the same class ("USDA did not respond usably") and must all
    // surface as UsdaTimeoutError so the worker treats them as backpressure, never a per-food failure.
    describe('transport / timeout mapping', () => {
        it('maps a raw transport failure (ECONNRESET) to UsdaTimeoutError, carrying the cause', async () => {
            const cause = Object.assign(new Error('fetch failed'), { name: 'TypeError', code: 'ECONNRESET' });
            const fetchFn = vi.fn().mockRejectedValue(cause);
            const client = makeClient(fetchFn);

            const err = await client.getFood(171688).catch((error: unknown) => error);

            expect(isUsdaTimeoutError(err)).toBe(true);
            expect((err as UsdaTimeoutError).cause).toBe(cause);
        });

        it('maps a fetch AbortError (client timeout on headers) to UsdaTimeoutError', async () => {
            const abort = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
            const fetchFn = vi.fn().mockRejectedValue(abort);
            const client = makeClient(fetchFn);

            await expect(client.getFood(171688)).rejects.toSatisfy(isUsdaTimeoutError);
        });

        it('maps a stalled response body (abort DURING .json()) to UsdaTimeoutError — the deadline covers the body read', async () => {
            const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
            const response = {
                ok: true,
                status: 200,
                json: async () => {
                    throw abort;
                },
            } as unknown as Response;
            const fetchFn = vi.fn().mockResolvedValue(response);
            const client = makeClient(fetchFn);

            await expect(client.getFood(171688)).rejects.toSatisfy(isUsdaTimeoutError);
        });
    });
});
