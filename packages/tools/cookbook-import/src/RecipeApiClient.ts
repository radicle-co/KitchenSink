/**
 * The recipe API transport this tool speaks through — one `fetch`, wrapped once with retry.
 *
 * DESIGN PATTERN: **Adapter over the published contract**. Every request body and every response is parsed
 * with zod imported from `@kitchensink/schema-recipe`; this file DECLARES NO WIRE SHAPE of its own
 * (GR-015 §15-b.2 / GR-017 §17-b.1). If the service's contract moves, this stops compiling — which is the
 * whole point of the schema package existing.
 *
 * ## ⛔ It talks to the RECIPE service ONLY — never to the food service
 *
 * That is not an omission, it is the measurement. The exercise is "how well does the SYSTEM match real
 * recipe language against the food catalog", so the food lookup must be done by the product's own
 * ingredient-resolution path (recipe-service calls food-service, forwarding the caller's bearer). An
 * importer that searched the food catalog itself and submitted a pre-chosen `foodId` would be measuring
 * this file's matching code, and would silently flatter the result by dropping whatever it failed to match.
 *
 * ## Retry — the policy depends on the METHOD, because a POST here has no idempotency key
 *
 * `p-retry` rather than a hand-rolled loop (the library-first gate). What may be retried is decided by
 * whether re-issuing the request can duplicate its effect:
 *
 * - A `429` or `503` is the server saying it did NOT process the request (the throttler, or the food
 *   service shedding load with `Retry-After`), so both are retried on EVERY method.
 * - A `502`/`504` from the ALB, a transport failure, and a `2xx` whose body fails the published schema are
 *   all failures that can FOLLOW a commit: the upstream answered (or timed out) after writing, the socket
 *   died while the response was being read, or the row exists and the contract moved. A GET retries them
 *   because a read is idempotent. ⛔ A POST does NOT: `POST /api/v1/recipes` assigns its id server-side and
 *   accepts no idempotency key (see `importLedger.ts`), so a re-issued create is a second public recipe —
 *   and the ledger, which records the id the CLIENT was handed, never learns about the first. The durable
 *   fix is a server-enforced idempotency key; until the service has one, the transport refuses to guess.
 * - A `4xx` that is the server's considered answer (`400`, `403`, `404`) is final on every method: retrying
 *   a rejected body just repeats it.
 *
 * ⚠️ `Retry-After` is honoured when present. The recipe service's throttler emits `429` and the food
 * service emits `503 FETCH_UNAVAILABLE` with `Retry-After` under backpressure; ignoring it is how a
 * client turns a queue into a stampede.
 *
 * @sideEffect Every method performs network I/O.
 */
import pRetry, { AbortError } from 'p-retry';
import type { z } from 'zod';
import {
    createRecipeRequestSchema,
    ingredientSchema,
    ingredientSuggestionsResponseSchema,
    recipeDetailSchema,
} from '@kitchensink/schema-recipe';

import { isRecipeApiError, RecipeApiError } from './RecipeApiError.js';

/** A catalog ingredient row as the recipe service publishes it. */
export type Ingredient = z.infer<typeof ingredientSchema>;
/** The blended `local | catalog` suggestion response. */
export type IngredientSuggestions = z.infer<typeof ingredientSuggestionsResponseSchema>;
/** A create-recipe body, exactly as the published contract defines it. */
export type CreateRecipeBody = z.input<typeof createRecipeRequestSchema>;
/** A created recipe, as the detail projection publishes it. */
export type RecipeDetail = z.infer<typeof recipeDetailSchema>;

/** Statuses where the server states it did NOT process the request. Retryable on every method. */
const NOT_PROCESSED = new Set([429, 503]);

/** Gateway statuses that can arrive AFTER the upstream committed. Retryable only where a repeat is harmless. */
const MAYBE_PROCESSED = new Set([502, 504]);

/** Methods whose repetition cannot duplicate an effect. Everything else is treated as a write. */
const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** How many attempts a retryable failure gets before the call is reported as failed. */
const MAX_ATTEMPTS = 5;

/** Options for {@link RecipeApiClient}. */
export interface RecipeApiClientOptions {
    /** Origin of the recipe service, e.g. `http://localhost:3000`. Trailing slashes are trimmed. */
    readonly baseUrl: string;
    /** The curator's Clerk bearer. It carries the `recipes:import:public` grant in signed metadata. */
    readonly token: string;
}

/** A thin, retrying, contract-parsing client for the endpoints this import needs. */
export class RecipeApiClient {
    private readonly baseUrl: string;
    private readonly token: string;

    public constructor(options: RecipeApiClientOptions) {
        this.baseUrl = options.baseUrl.replace(/\/+$/, '');
        this.token = options.token;
    }

    /**
     * Issue one request, retrying only what is worth retrying, and return the parsed body.
     *
     * @param path - Path beginning with `/`.
     * @param schema - The published zod for the response.
     * @param init - Method and body.
     * @returns The parsed response.
     * @throws {RecipeApiError} On a non-2xx the service considered final, or after the retry budget.
     * @sideEffect Network I/O.
     */
    private async request<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
        const method = (init?.method ?? 'GET').toUpperCase();
        // A repeat of an idempotent request is harmless, so every transient failure is worth another try.
        // A repeat of anything else may duplicate a write, so only a failure the server states it did NOT
        // process is retried; every other failure is final on the first attempt.
        const retryMaybeProcessed = IDEMPOTENT_METHODS.has(method);

        const run = async (): Promise<T> => {
            let response: Response;

            try {
                response = await fetch(`${this.baseUrl}${path}`, {
                    ...init,
                    headers: {
                        authorization: `Bearer ${this.token}`,
                        ...(init?.body === undefined ? {} : { 'content-type': 'application/json' }),
                        ...init?.headers,
                    },
                });
            } catch (error) {
                // A transport failure can happen AFTER the request left: the socket died while the response
                // was in flight, and the write may already be committed.
                throw retryMaybeProcessed ? error : new AbortError(toApiError(error, path, method));
            }

            if (!response.ok) {
                const body = await response.text();
                const code = readErrorCode(body);
                const error = new RecipeApiError(
                    response.status,
                    code,
                    body,
                    `${method} ${path} -> ${response.status} ${code ?? ''}`.trim(),
                );
                const retryable =
                    NOT_PROCESSED.has(response.status) || (retryMaybeProcessed && MAYBE_PROCESSED.has(response.status));

                if (!retryable) {
                    // `AbortError` is p-retry's "this is final" signal: a 400/403 repeated five times is
                    // five identical rejections and four wasted round trips — and a 502 repeated after a
                    // POST is a second row.
                    throw new AbortError(error);
                }

                await waitForRetryAfter(response);
                throw error;
            }

            // A 2xx whose body fails the contract is final on EVERY method: the effect happened, and a
            // repeat cannot change what the service publishes. It is reported with the status the service
            // gave, not as a transport failure, because the transport worked — the contract moved.
            const text = await response.text();
            const parsed = schema.safeParse(readJson(text));

            if (!parsed.success) {
                throw new AbortError(
                    new RecipeApiError(
                        response.status,
                        undefined,
                        text,
                        `${method} ${path} -> ${response.status}, but the body does not match the published contract: ${parsed.error.message}`,
                    ),
                );
            }

            return parsed.data;
        };

        try {
            return await pRetry(run, { retries: MAX_ATTEMPTS - 1, minTimeout: 500, factor: 2 });
        } catch (error) {
            throw isRecipeApiError(error) ? error : toApiError(error, path, method);
        }
    }

    /**
     * `GET /api/v1/ingredients/suggest` — the product's own blended lookup: the caller's catalog rows first,
     * then food-catalog hits the RECIPE service fetched on the caller's behalf.
     *
     * @param query - The ingredient name, exactly as the recipe's prose gave it.
     * @param limit - Maximum suggestions.
     * @returns The blended suggestions plus `catalogAvailability`.
     * @sideEffect Network I/O; causes recipe-service to call food-service.
     */
    public async suggestIngredients(query: string, limit = 10): Promise<IngredientSuggestions> {
        const search = new URLSearchParams({ q: query, limit: String(limit) });

        return this.request(`/api/v1/ingredients/suggest?${search.toString()}`, ingredientSuggestionsResponseSchema);
    }

    /**
     * `POST /api/v1/ingredients/by-food` — admit a food-catalog hit the user picked, as the app's picker
     * does. Returns a catalog row carrying the opaque `foodId`.
     *
     * @param foodId - The `foodId` the suggestion carried.
     * @returns The admitted catalog row.
     * @sideEffect Network I/O; writes a catalog row.
     */
    public async addIngredientByFood(foodId: string): Promise<Ingredient> {
        return this.request('/api/v1/ingredients/by-food', ingredientSchema, {
            method: 'POST',
            body: JSON.stringify({ foodId }),
        });
    }

    /**
     * `POST /api/v1/ingredients/by-name` — the app's PRIMARY action for a typed name that the suggestion
     * list did not contain ("Find nutrition for X"). Asynchronous: returns `PENDING`/`UNRESOLVED`.
     *
     * @param name - The name as typed.
     * @returns The food-backed row, at whatever status the pipeline started it in.
     * @sideEffect Network I/O; asks the food service to resolve a new name.
     */
    public async addIngredientByName(name: string): Promise<Ingredient> {
        return this.request('/api/v1/ingredients/by-name', ingredientSchema, {
            method: 'POST',
            body: JSON.stringify({ name }),
        });
    }

    /**
     * `POST /api/v1/ingredients` — the explicit freeform FALLBACK, the app's "create a custom one instead".
     * Local catalog only; no food-service call.
     *
     * @param name - The name as typed.
     * @returns The freeform row (`isUserEntered: true`).
     * @sideEffect Network I/O; writes a catalog row.
     */
    public async createFreeformIngredient(name: string): Promise<Ingredient> {
        return this.request('/api/v1/ingredients', ingredientSchema, {
            method: 'POST',
            body: JSON.stringify({ name }),
        });
    }

    /**
     * `GET /api/v1/ingredients/{id}/status` — re-poll a food-backed row, which is how a `PENDING` becomes
     * `RESOLVED`. Resolution is ASYNCHRONOUS; a `PENDING` is not a failure.
     *
     * @param ingredientId - The catalog row id.
     * @returns The row with its current status.
     * @sideEffect Network I/O.
     */
    public async getIngredientStatus(ingredientId: string): Promise<Ingredient> {
        return this.request(`/api/v1/ingredients/${ingredientId}/status`, ingredientSchema);
    }

    /**
     * `POST /api/v1/recipes` — create the recipe through the same endpoint the app uses.
     *
     * The body is validated against the PUBLISHED contract before it leaves, so a malformed candidate
     * fails here, naming its own field, instead of arriving as an opaque `400`.
     *
     * @param recipe - The create body.
     * @returns The created recipe.
     * @sideEffect Network I/O; writes a recipe.
     */
    public async createRecipe(recipe: CreateRecipeBody): Promise<RecipeDetail> {
        return this.request('/api/v1/recipes', recipeDetailSchema, {
            method: 'POST',
            body: JSON.stringify(createRecipeRequestSchema.parse(recipe)),
        });
    }
}

/**
 * Parse a body as JSON, or yield `undefined` for one that is not — which every published schema rejects.
 *
 * @param body - The raw response body.
 * @returns The parsed value, or `undefined`. Pure.
 */
function readJson(body: string): unknown {
    try {
        return JSON.parse(body) as unknown;
    } catch {
        // A proxy or the platform can answer with HTML; the caller decides what a non-JSON body means.
        return undefined;
    }
}

/**
 * Pull the service's machine-readable `code` out of an error envelope, tolerating a non-JSON body.
 *
 * @param body - The raw response body.
 * @returns The code, or `undefined`. Pure.
 */
function readErrorCode(body: string): string | undefined {
    const parsed = readJson(body);

    if (typeof parsed === 'object' && parsed !== null && 'code' in parsed) {
        const { code } = parsed as { code?: unknown };

        return typeof code === 'string' ? code : undefined;
    }

    return undefined;
}

/**
 * Sleep for the server's `Retry-After`, when it sent one.
 *
 * @param response - The throttled/shed response.
 * @sideEffect Waits.
 */
async function waitForRetryAfter(response: Response): Promise<void> {
    const header = response.headers.get('retry-after');
    const seconds = header === null ? Number.NaN : Number(header);

    if (Number.isFinite(seconds) && seconds > 0) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(seconds, 60) * 1000));
    }
}

/**
 * Wrap a transport-level failure so every caller sees one error type.
 *
 * @param error - The thrown value.
 * @param path - The path attempted.
 * @param method - The method attempted.
 * @returns The wrapped error. Pure.
 */
function toApiError(error: unknown, path: string, method: string | undefined): RecipeApiError {
    const message = error instanceof Error ? error.message : String(error);

    return new RecipeApiError(0, undefined, message, `${method ?? 'GET'} ${path} -> transport failure: ${message}`);
}
