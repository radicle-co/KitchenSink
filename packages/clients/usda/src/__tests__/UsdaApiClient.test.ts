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
import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import { USDA_SEARCH_PARAMETERS } from '../searchParameters.js';
import { UsdaApiClient } from '../UsdaApiClient.js';
import type { UsdaApiClientOptions } from '../UsdaApiClient.js';
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
    /** Response headers; omitted entirely when absent, so the no-headers double stays exercised. */
    readonly headers?: Record<string, string>;
}

/** Build a minimal `Response`-shaped object the client can consume. */
function mockResponse({ status, body, headers }: MockResponseInit): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body ?? {},
        ...(headers !== undefined ? { headers: new Headers(headers) } : {}),
    } as unknown as Response;
}

/**
 * The JSON body a request was sent with.
 *
 * @param init - The `fetch` init the client passed.
 * @returns The parsed body.
 * @throws {Error} when the request carried no string body.
 */
function sentBody(init: RequestInit | undefined): unknown {
    if (typeof init?.body !== 'string') {
        throw new Error('The client sent no JSON body.');
    }

    return JSON.parse(init.body);
}

/** Construct a client whose HTTP layer is the supplied mock. */
function makeClient(fetchImpl: FetchMock, overrides?: Partial<UsdaApiClientOptions>): UsdaApiClient {
    return new UsdaApiClient({
        apiKey: 'test-key',
        baseUrl: 'https://api.nal.usda.gov/fdc/v1',
        fetchFn: fetchImpl as unknown as typeof fetch,
        ...overrides,
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

        // Rewritten for the POST search (ADR-0055 point 1): the page size travels in the JSON body as a number.
        it('requests exactly one batch-sized page (pageSize = the 20-key batch cap)', async () => {
            const fetchFn = vi.fn().mockResolvedValue(mockResponse({ status: 200, body: { totalHits: 0, foods: [] } }));
            const client = makeClient(fetchFn);

            await client.searchFoods('apple');

            expect(sentBody(fetchFn.mock.calls[0]?.[1])).toMatchObject({ pageSize: 20 });
        });

        // Rewritten for the POST search (ADR-0055 point 1 records why the GET form was dropped): the shared statement
        // is the JSON body of one POST, its data types an array, and the key stays the only query parameter.
        it('asks USDA for the shared search statement as the JSON body of one POST, keeping the key in the URL', async () => {
            const fetchFn = vi.fn().mockResolvedValue(mockResponse({ status: 200, body: { totalHits: 0, foods: [] } }));
            const client = makeClient(fetchFn, { apiKey: 'key with/reserved&chars' });

            await client.searchFoods('crème fraîche');

            expect(fetchFn).toHaveBeenCalledTimes(1);

            const url = new URL(String(fetchFn.mock.calls[0]?.[0]));
            const init: RequestInit | undefined = fetchFn.mock.calls[0]?.[1];

            expect(init?.method).toBe('POST');
            expect(`${url.origin}${url.pathname}`).toBe('https://api.nal.usda.gov/fdc/v1/foods/search');
            expect([...url.searchParams]).toStrictEqual([['api_key', 'key with/reserved&chars']]);
            expect(new Headers(init?.headers).get('content-type')).toBe('application/json');
            expect(sentBody(init)).toStrictEqual({
                query: 'crème fraîche',
                pageSize: USDA_SEARCH_PARAMETERS.pageSize,
                dataType: [...USDA_SEARCH_PARAMETERS.dataTypes],
            });
        });

        it('takes the query alone, so a caller has no way to search differently', () => {
            expectTypeOf<Parameters<UsdaApiClient['searchFoods']>>().toEqualTypeOf<[query: string]>();
        });

        // The search's `dataType` feeds exhaustive switches downstream (the adapter's lineage key), so a value USDA adds
        // later must arrive as no data type at all, never as a member of the union it is not.
        it('drops a data type it does not know, rather than passing it off as a known one', async () => {
            const fetchFn = vi.fn().mockResolvedValue(
                mockResponse({
                    status: 200,
                    body: {
                        totalHits: 2,
                        foods: [
                            { fdcId: 1, description: 'A', dataType: 'Foundation' },
                            { fdcId: 2, description: 'B', dataType: 'Agricultural Acquisition' },
                        ],
                    },
                }),
            );

            const { foods } = await makeClient(fetchFn).searchFoods('a');

            expect(foods.map((food) => food.dataType)).toEqual(['Foundation', undefined]);
            expect(foods[1] !== undefined && 'dataType' in foods[1]).toBe(false);
        });

        // USDA's OpenAPI spec types `ndbNumber` as a string, but the live API sends an integer. These two hits are
        // recorded from GET /foods/search?query=broccoli%20raw on 2026-10-01, trimmed to the fields read here.
        it('reads each hit’s NDB number as a decimal string, from the integer the live API sends', async () => {
            const fetchFn = vi.fn().mockResolvedValue(
                mockResponse({
                    status: 200,
                    body: {
                        totalHits: 2,
                        foods: [
                            { fdcId: 747447, description: 'Broccoli, raw', dataType: 'Foundation', ndbNumber: 11090 },
                            { fdcId: 170379, description: 'Broccoli, raw', dataType: 'SR Legacy', ndbNumber: 11090 },
                        ],
                    },
                }),
            );

            const { foods } = await makeClient(fetchFn).searchFoods('broccoli raw');

            expect(foods.map((food) => food.ndbNumber)).toEqual(['11090', '11090']);
        });

        it.each<[string, unknown, string | undefined]>([
            ['a digit string, as the spec types it', '11090', '11090'],
            ['a digit string with leading zeros', '011090', '11090'],
            ['an absent field', undefined, undefined],
            ['zero', 0, undefined],
            ['a negative number', -11090, undefined],
            ['a fraction', 110.9, undefined],
            ['an integer past the safe range', 2 ** 60, undefined],
            ['a string that is not digits', '11090a', undefined],
            ['an empty string', '', undefined],
            ['null', null, undefined],
            ['an object', { value: 11090 }, undefined],
        ])('reads %s as its NDB number, and never fails the search over it', async (_label, ndbNumber, expected) => {
            const hit = { fdcId: 747447, description: 'Broccoli, raw', dataType: 'Foundation', ndbNumber };
            const fetchFn = vi
                .fn()
                .mockResolvedValue(mockResponse({ status: 200, body: { totalHits: 1, foods: [hit] } }));

            const { foods } = await makeClient(fetchFn).searchFoods('broccoli');

            expect(foods).toHaveLength(1);
            expect(foods[0]?.ndbNumber).toBe(expected);
            expect(foods[0] !== undefined && 'ndbNumber' in foods[0]).toBe(expected !== undefined);
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

    // ADR-0053 §4: the injected fetch may refuse a request BEFORE it reaches USDA (the food service's rate-limited
    // transport, when a source is at its ceiling). That refusal is the caller's own typed error, not "USDA did not
    // respond", so it must reach the caller unchanged rather than be re-read as a timeout.
    describe('caller errors from the injected fetch', () => {
        /** Stands in for the food service's `SourceBusyError`, which this package cannot import. */
        class CallerBusyError extends Error {
            public constructor() {
                super('busy');
                this.name = 'CallerBusyError';
                Object.setPrototypeOf(this, CallerBusyError.prototype);
            }
        }

        const isCallerBusy = (error: unknown): boolean => error instanceof CallerBusyError;

        it.each([
            ['getFood', (client: UsdaApiClient) => client.getFood(171688)],
            ['getFoodsBatch', (client: UsdaApiClient) => client.getFoodsBatch([171688])],
            ['searchFoods', (client: UsdaApiClient) => client.searchFoods('apple')],
        ])('%s rethrows an error the caller claims as the same instance', async (_, call) => {
            const refusal = new CallerBusyError();
            const client = makeClient(vi.fn().mockRejectedValue(refusal), { isCallerError: isCallerBusy });

            await expect(call(client)).rejects.toBe(refusal);
        });

        it('still reads an error the caller does not claim as a timeout, carrying it', async () => {
            const cause = new TypeError('fetch failed');
            const client = makeClient(vi.fn().mockRejectedValue(cause), { isCallerError: isCallerBusy });

            const err = await client.getFood(171688).catch((error: unknown) => error);

            expect(isUsdaTimeoutError(err)).toBe(true);
            expect((err as UsdaTimeoutError).cause).toBe(cause);
        });

        it('claims nothing by default, so an unconfigured client keeps reading every foreign error as a timeout', async () => {
            const client = makeClient(vi.fn().mockRejectedValue(new CallerBusyError()));

            await expect(client.getFood(171688)).rejects.toSatisfy(isUsdaTimeoutError);
        });

        it("never lets a caller's claim mask USDA's own answer", async () => {
            const client = makeClient(vi.fn().mockResolvedValue(mockResponse({ status: 429 })), {
                isCallerError: () => true,
            });

            await expect(client.getFood(171688)).rejects.toSatisfy(isUsdaRateLimitError);
        });
    });
});

/**
 * ADR-0053 §3: the food service builds this client over its rate-limited transport, and a client built over nothing
 * would call USDA unmetered. `fetchFn` is therefore required, with no default, so that client does not compile.
 */
describe('UsdaApiClientOptions', () => {
    it('requires the fetch every request goes through', () => {
        expectTypeOf<{ apiKey: string }>().not.toExtend<UsdaApiClientOptions>();
        expectTypeOf<{ apiKey: string; fetchFn: typeof fetch }>().toExtend<UsdaApiClientOptions>();
    });
});
