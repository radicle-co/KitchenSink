/**
 * Typed HTTP client for the USDA FoodData Central REST API.
 *
 * Wraps the upstream `GET /v1/food/{fdcId}`, `POST /v1/foods`, and `GET /v1/foods/search`
 * endpoints with a 10-second request timeout and maps upstream status codes onto the typed
 * error hierarchy in {@link ./errors}. This is the external-API client only — no database and
 * no HTTP server; `@kitchensink/food-service` depends on it.
 *
 * @implements FR-023
 */
import type { z } from 'zod';

import {
    InvalidBatchSizeError,
    isUsdaClientError,
    UsdaNotFoundError,
    UsdaRateLimitError,
    UsdaSchemaError,
    UsdaServerError,
    UsdaTimeoutError,
} from './errors.js';
import {
    RawUsdaFoodArraySchema,
    RawUsdaFoodSchema,
    RawUsdaSearchResultSchema,
    type RawUsdaFood,
    type RawUsdaNutrient,
} from './schemas.js';
import type { UsdaDataType, UsdaFoodDetail, UsdaNutrient, UsdaSearchHit, UsdaSearchResult } from './types.js';

/** Default USDA FoodData Central API base URL. */
const DEFAULT_BASE_URL = 'https://api.nal.usda.gov/fdc/v1';

/** Per-request timeout (ms). */
const DEFAULT_TIMEOUT_MS = 10_000;

/** Upstream maximum number of ids accepted by `POST /v1/foods` in a single call. */
const MAX_BATCH_SIZE = 20;

/**
 * Search page size. USDA defaults to 50, but the worker only ever batch-fetches the top {@link
 * MAX_BATCH_SIZE}; USDA returns hits in relevance order, so a smaller page yields the same top-N with a
 * much smaller payload. Set EXACTLY to the batch cap so the fan-out issues one search + ONE batch (=2 USDA
 * requests/food, not 3) — every extra hit would force a second batch POST that adds USDA load for no gain.
 */
const SEARCH_PAGE_SIZE = 20;

/** Configuration for {@link UsdaApiClient}. */
export interface UsdaApiClientOptions {
    /** USDA FoodData Central API key (required). */
    readonly apiKey: string;
    /** API base URL; defaults to {@link DEFAULT_BASE_URL}. */
    readonly baseUrl?: string;
    /** Injectable `fetch` implementation (defaults to the global `fetch`); enables test doubles. */
    readonly fetchFn?: typeof fetch;
    /** Per-request timeout in milliseconds; defaults to {@link DEFAULT_TIMEOUT_MS}. */
    readonly timeoutMs?: number;
}

/** Typed client for the USDA FoodData Central REST API. */
export class UsdaApiClient {
    private readonly apiKey: string;
    private readonly baseUrl: string;
    private readonly fetchFn: typeof fetch;
    private readonly timeoutMs: number;

    /**
     * @param options - API key, optional base URL, injectable `fetch`, and timeout.
     */
    public constructor(options: UsdaApiClientOptions) {
        this.apiKey = options.apiKey;
        this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
        this.fetchFn = options.fetchFn ?? fetch;
        this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    }

    /**
     * Fetch a single food by its FDC id.
     *
     * @param fdcId - USDA FoodData Central id.
     * @returns The typed food detail.
     * @throws {UsdaNotFoundError} when USDA responds `404`.
     * @throws {UsdaRateLimitError} when USDA responds `429`.
     * @throws {UsdaServerError} when USDA responds `5xx`.
     * @throws {UsdaTimeoutError} when the request exceeds the configured timeout.
     */
    public async getFood(fdcId: number): Promise<UsdaFoodDetail> {
        const url = `${this.baseUrl}/food/${fdcId}?api_key=${encodeURIComponent(this.apiKey)}`;
        const body = this.parse(RawUsdaFoodSchema, await this.request(url, { method: 'GET' }, fdcId));

        return this.toFoodDetail(body);
    }

    /**
     * Fetch up to {@link MAX_BATCH_SIZE} foods in a single `POST /v1/foods` call.
     *
     * @param fdcIds - FDC ids to fetch (max 20).
     * @returns The typed food details, in upstream order.
     * @throws {InvalidBatchSizeError} when `fdcIds` exceeds 20 entries.
     * @throws {UsdaRateLimitError} when USDA responds `429`.
     * @throws {UsdaServerError} when USDA responds `5xx`.
     * @throws {UsdaTimeoutError} when the request exceeds the configured timeout.
     */
    public async getFoodsBatch(fdcIds: number[]): Promise<UsdaFoodDetail[]> {
        if (fdcIds.length > MAX_BATCH_SIZE) {
            throw new InvalidBatchSizeError(fdcIds.length, MAX_BATCH_SIZE);
        }

        const url = `${this.baseUrl}/foods?api_key=${encodeURIComponent(this.apiKey)}`;
        const body = this.parse(
            RawUsdaFoodArraySchema,
            await this.request(url, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ fdcIds }),
            }),
        );

        return body.map((food) => this.toFoodDetail(food));
    }

    /**
     * Search local USDA foods by free-text query.
     *
     * @param query - Search term.
     * @returns The typed search result envelope.
     * @throws {UsdaRateLimitError} when USDA responds `429`.
     * @throws {UsdaServerError} when USDA responds `5xx`.
     * @throws {UsdaTimeoutError} when the request exceeds the configured timeout.
     */
    public async searchFoods(query: string): Promise<UsdaSearchResult> {
        const url = `${this.baseUrl}/foods/search?api_key=${encodeURIComponent(this.apiKey)}&query=${encodeURIComponent(query)}&pageSize=${SEARCH_PAGE_SIZE}`;
        const body = this.parse(RawUsdaSearchResultSchema, await this.request(url, { method: 'GET' }));

        const foods: UsdaSearchHit[] = body.foods.map((food) => ({
            fdcId: food.fdcId,
            description: food.description,
            ...(food.dataType !== undefined ? { dataType: food.dataType as UsdaDataType } : {}),
        }));

        return { foods, totalHits: body.totalHits };
    }

    /**
     * Execute an HTTP request with a timeout and map non-2xx status codes to typed errors.
     *
     * @param url - Fully-qualified request URL.
     * @param init - `fetch` init.
     * @param fdcId - Optional id used to enrich a `404` into a {@link UsdaNotFoundError}.
     * @returns The successful `Response`.
     * @sideEffect Performs a network request via the injected `fetch`.
     */
    private async request(url: string, init: RequestInit, fdcId?: number): Promise<unknown> {
        const controller = new AbortController();
        const timeout = setTimeout(() => {
            controller.abort();
        }, this.timeoutMs);

        try {
            const response = await this.fetchFn(url, { ...init, signal: controller.signal });

            if (!response.ok) {
                if (response.status === 404) {
                    throw new UsdaNotFoundError(fdcId ?? 0);
                }

                if (response.status === 429) {
                    throw new UsdaRateLimitError();
                }

                if (response.status >= 500) {
                    throw new UsdaServerError(response.status);
                }

                throw new UsdaServerError(response.status, `Unexpected USDA response status ${response.status}`);
            }

            // Read the body INSIDE the armed deadline. Under a load-degraded USDA the response body can
            // stall AFTER headers arrive; clearing the timeout before this (or reading in the caller) would
            // leave a body-read hang that is never aborted → the whole fetch call never resolves.
            return await response.json();
        } catch (error) {
            // Our own typed status errors (thrown just above) are re-thrown as-is. Everything else — a
            // client abort (headers OR body), a raw transport failure (ECONNRESET / ENOTFOUND / undici
            // "fetch failed"), or a non-JSON body under gateway overload — means "USDA did not respond
            // usably", the same class as a timeout. Carry the cause so a permanent misconfig is diagnosable.
            if (isUsdaClientError(error)) {
                throw error;
            }

            throw new UsdaTimeoutError('USDA request failed or timed out', error);
        } finally {
            clearTimeout(timeout);
        }
    }

    /**
     * Validate an untrusted USDA response body against a zod schema.
     *
     * The transport already succeeded (2xx); a parse failure means the upstream *shape* drifted,
     * which is a distinct failure mode from a non-2xx status — so it raises {@link UsdaSchemaError}
     * (carrying the zod issues), never {@link UsdaServerError}.
     *
     * @throws {UsdaSchemaError} when `body` does not match `schema`.
     */
    private parse<TSchema extends z.ZodTypeAny>(schema: TSchema, body: unknown): z.infer<TSchema> {
        const result = schema.safeParse(body);

        if (!result.success) {
            throw new UsdaSchemaError(result.error.issues);
        }

        return result.data;
    }

    /**
     * Normalise a validated upstream food object into the typed {@link UsdaFoodDetail}, preserving
     * the verbatim payload in `raw` for `foods.raw_json`. The input has already passed
     * {@link RawUsdaFoodSchema}, so `fdcId`/`description` are guaranteed present.
     */
    private toFoodDetail(food: RawUsdaFood): UsdaFoodDetail {
        const nutrients: UsdaNutrient[] = food.foodNutrients.map((entry: RawUsdaNutrient) => {
            const value = entry.value ?? entry.amount;

            return {
                nutrientId: entry.nutrientId ?? entry.nutrient?.id ?? 0,
                nutrientName: entry.nutrientName ?? entry.nutrient?.name ?? '',
                unitName: entry.unitName ?? entry.nutrient?.unitName ?? '',
                ...(value !== undefined ? { value } : {}),
            };
        });

        return {
            fdcId: food.fdcId,
            description: food.description,
            ...(food.dataType !== undefined ? { dataType: food.dataType as UsdaDataType } : {}),
            foodNutrients: nutrients,
            ...(food.brandOwner !== undefined ? { brandOwner: food.brandOwner } : {}),
            ...(food.brandName !== undefined ? { brandName: food.brandName } : {}),
            ...(food.gtinUpc !== undefined ? { gtinUpc: food.gtinUpc } : {}),
            ...(food.publicationDate !== undefined ? { publicationDate: food.publicationDate } : {}),
            raw: food as Record<string, unknown>,
        };
    }
}
