/**
 * `FoodServiceClient` (T-057) — the typed client for our own source-agnostic `/api/v1/foods/*` API. It is
 * the single integration point downstream services (001 recipes, 006 meal-planning, 007 grocery, 009
 * nutrition) and internal jobs use, so they never hand-roll URLs, token attachment, or status mapping.
 *
 * - **Token attach (user OR M2M, FR-047).** A static bearer token or a `getToken` callback (re-read per
 *   request, so a rotated session/M2M token is always current) is sent as `Authorization: Bearer …`.
 * - **Typed results / errors.** Each method returns a typed result for its success/`202` outcomes and
 *   throws a typed error for `401`/`403`/`400`/`404`/`409`/`503` (see `./errors.js`). There is no
 *   per-user `429`; a candidate-not-in-set `409` is a {@link CandidateMismatchError} (DSN-14).
 * - **Source-agnostic.** Every food is addressed by its internal `id`; no `fdcId` appears in any shape.
 *
 * @implements FR-047
 */
import type { z } from 'zod';
// The RUNTIME zod from the contract the food service OWNS and publishes — the same definitions the service
// validates its own responses' shapes against, so this client parses rather than believes (§15, rule 4).
import {
    addResponseSchema,
    batchResponseSchema,
    candidatesResponseSchema,
    foodResponseSchema,
    pendingFoodStatusSchema,
    pendingResponseSchema,
    resolveResponseSchema,
    searchResponseSchema,
    statusResponseSchema,
} from '@kitchensink/schema-food';

import { reportContractSkewOnce } from './contractSkew.js';
import {
    BadRequestError,
    CandidateMismatchError,
    ConflictError,
    FetchUnavailableError,
    ForbiddenError,
    FoodServiceClientError,
    NotFoundError,
    UnauthorizedError,
    UnexpectedResponseError,
} from './errors.js';
import type {
    AddResult,
    BatchResult,
    CandidatesResult,
    FoodStatus,
    GetFoodResult,
    ResolveResult,
    SearchResult,
    StatusResult,
} from './types.js';

/** A bearer token supplied either as a literal or a (sync/async) per-request callback. */
export type TokenSource = string | (() => string | Promise<string>);

/**
 * Per-request timeout (ms). A downstream caller (e.g. the 001 recipe service's ingredient path)
 * awaits this client synchronously; without a bound, a hung food service would hang the caller
 * unbounded. 8s comfortably covers a healthy `202`/`200`/`503` round-trip while capping the worst case.
 */
const DEFAULT_TIMEOUT_MS = 8_000;

/** Construction options. */
export interface FoodServiceClientOptions {
    /** The food service base origin, e.g. `https://food.commise.app` (no trailing `/v1`). */
    readonly baseUrl: string;
    /** A user session or M2M bearer token (literal or per-request callback). */
    readonly token?: TokenSource;
    /** Injectable `fetch` (defaults to the global `fetch`) — enables test doubles. */
    readonly fetch?: typeof fetch;
    /** Per-request timeout in milliseconds; defaults to {@link DEFAULT_TIMEOUT_MS} (8000). */
    readonly timeoutMs?: number;
    /**
     * Where a contract-skew WARNING goes (drift layer 3, CODING_STANDARDS §15.2.5). Defaults to
     * `console.warn`.
     *
     * This package has no logging seam of its own and this is not the place to invent one: a skew warning is
     * the ONLY thing this client ever emits out-of-band, so it gets one narrowly-named sink rather than a
     * logger abstraction nothing else would use. Supply it to route the warning into a real logger (or to
     * assert on it in a test).
     */
    readonly onContractSkew?: (message: string) => void;
}

/** A normalized response: status, parsed JSON body (or `undefined`), and a parsed `Retry-After`. */
interface RawResponse {
    readonly status: number;
    readonly body: unknown;
    readonly retryAfterSeconds: number | undefined;
}

export class FoodServiceClient {
    private readonly baseUrl: string;
    private readonly token: TokenSource | undefined;
    private readonly fetchImpl: typeof fetch;
    private readonly timeoutMs: number;
    private readonly onContractSkew: (message: string) => void;

    /** @param options - Base URL, optional token (user or M2M), optional `fetch` double, and timeout. */
    public constructor(options: FoodServiceClientOptions) {
        this.baseUrl = options.baseUrl.replace(/\/+$/, '');
        this.token = options.token;
        this.fetchImpl = options.fetch ?? fetch;
        this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        this.onContractSkew =
            options.onContractSkew ??
            ((message: string): void => {
                console.warn(message);
            });
        // NOTHING skew-related happens here. Constructing a client must not touch the network: this class is
        // instantiated PER REQUEST — and per keystroke for the typeahead — by the recipe service's
        // `FoodServiceClients` factory, so a probe in the constructor would be a `/health` request per
        // keystroke. See `./contractSkew.ts` for where the check fires instead, and why.
    }

    /**
     * `POST /api/v1/foods` — add a food by name (`202`).
     *
     * @param name - The display name to resolve.
     * @returns The created/deduped food id + status.
     * @throws {BadRequestError} on an empty name; {@link UnauthorizedError}/{@link ForbiddenError} on
     *   auth failure; {@link FetchUnavailableError} when shed by backpressure.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async addByName(name: string): Promise<AddResult> {
        const res = await this.send('POST', '/api/v1/foods', { name });

        return this.expect<AddResult>(res, 202, addResponseSchema);
    }

    /**
     * `POST /api/v1/foods/batch` — add up to 100 names; per-item partial result.
     *
     * @param names - The names to add (≤100; over → `400`).
     * @returns Per-item results (inline hits + pending misses).
     * @throws {BadRequestError} when the batch is oversized/malformed; auth + backpressure errors as above.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async batch(names: readonly string[]): Promise<BatchResult> {
        const res = await this.send('POST', '/api/v1/foods/batch', { names });

        // 201, not 200 — and that is worth pinning rather than tolerating. `POST /api/v1/foods/batch` carries no
        // `@HttpCode` and does not set a status on the response, so it gets Nest's POST default of 201 (asserted
        // by `tests/foods-api.integration.test.ts`). The old check here was `res.status >= 200 && res.status < 300`,
        // which accepted ANY 2xx and so hid which one the service actually sends — a range that would also have
        // returned a `204`'s empty body as a `BatchResult` of `undefined`. Naming the exact status means a
        // service-side change to it now fails loudly here instead of silently.
        return this.expect<BatchResult>(res, 201, batchResponseSchema);
    }

    /**
     * `GET /api/v1/foods/{id}` — read the golden record, or a non-terminal pending state.
     *
     * @param id - The internal food id.
     * @returns `RESOLVED` with the golden record, else a `PENDING`/`UNRESOLVED` result.
     * @throws {NotFoundError} for `NOT_FOUND`/`FAILED`/no row; {@link BadRequestError} on a malformed id.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async getById(id: string): Promise<GetFoodResult> {
        const res = await this.send('GET', `/api/v1/foods/${encodeURIComponent(id)}`);

        if (res.status === 200) {
            return { status: 'RESOLVED', food: foodResponseSchema.parse(res.body) };
        }

        if (res.status === 202) {
            // The `202` body's shape is the service's `PendingResponse`, NOT a shape this client gets to
            // restate: an inline `{ id; status; estimatedWaitSeconds? }` here was a hand-written wire type on
            // the far side of a boundary that could not typecheck against the server (CODING_STANDARDS §15).
            //
            // Now PARSED rather than cast, which also retires the `body.status as 'PENDING' | 'UNRESOLVED'`
            // narrowing below it. That cast was the sharpest edge in this file: `PendingResponse.status` is the
            // FULL five-value lifecycle enum, so the cast asserted a two-value narrowing that nothing checked.
            // A service answering `202` with `RESOLVED`/`NOT_FOUND`/`FAILED` — a bug, but a reachable one —
            // produced a `GetFoodResult` whose `status` was outside its own declared union, and every
            // downstream exhaustive `switch` on it would silently fall through.
            //
            // ⚠️ FINDING, worked around here rather than silently: `pendingResponseSchema.status` is the FULL
            // five-value `foodStatusSchema`, even though only `PENDING`/`UNRESOLVED` can legitimately answer a
            // 202 — and `pendingFoodStatusSchema` (exactly those two) exists in the same authored file but is
            // not used by it, while `getFoodResultSchema`'s pending arm DOES use it. So the service's own
            // contract disagrees with itself about what a 202 carries. Tightening the published response is a
            // service-side contract change and out of scope here, so the invariant is enforced at THIS
            // boundary: the envelope is parsed, then the status is parsed against the two-value enum, which is
            // what this method's own return type promises.
            const body = pendingResponseSchema.parse(res.body);

            return {
                status: pendingFoodStatusSchema.parse(body.status),
                id: body.id,
                estimatedWaitSeconds: body.estimatedWaitSeconds,
            };
        }

        throw this.toError(res, id);
    }

    /**
     * `GET /api/v1/foods/{id}/status` — lifecycle poll (never enqueues).
     *
     * @param id - The internal food id.
     * @returns The status (plus the golden record when `RESOLVED`).
     * @throws {NotFoundError} when no row exists; {@link BadRequestError} on a malformed id.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async getStatus(id: string): Promise<StatusResult> {
        const res = await this.send('GET', `/api/v1/foods/${encodeURIComponent(id)}/status`);

        return this.expect<StatusResult>(res, 200, statusResponseSchema, id);
    }

    /**
     * `GET /api/v1/foods/{id}/candidates` — the disambiguation candidate set for an `UNRESOLVED` food.
     *
     * @param id - The internal food id.
     * @returns The (non-expired) candidate set (empty for a non-`UNRESOLVED` food).
     * @throws {NotFoundError} when no row exists.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async getCandidates(id: string): Promise<CandidatesResult> {
        const res = await this.send('GET', `/api/v1/foods/${encodeURIComponent(id)}/candidates`);

        return this.expect<CandidatesResult>(res, 200, candidatesResponseSchema, id);
    }

    /**
     * `GET /api/v1/foods/search?query=` — local fuzzy/crosswalk search (never calls a source).
     *
     * @param query - The search query.
     * @returns Ranked results, or an empty set on no local match.
     * @throws {UnauthorizedError}/{@link ForbiddenError} on auth failure.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async search(query: string): Promise<SearchResult> {
        const res = await this.send('GET', `/api/v1/foods/search?query=${encodeURIComponent(query)}`);

        return this.expect<SearchResult>(res, 200, searchResponseSchema);
    }

    /**
     * `PATCH /api/v1/foods/{id}` — resolve an `UNRESOLVED` food from a candidate pick.
     *
     * @param id - The internal food id.
     * @param candidateIds - The picked candidate row ids (validated to the food's own set).
     * @returns The id + `RESOLVED` status.
     * @throws {CandidateMismatchError} when a pick is not in the food's set; {@link ConflictError} when
     *   the food is not awaiting disambiguation; {@link FetchUnavailableError} on resolve capacity
     *   exhaustion; {@link NotFoundError} when no row exists.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async resolve(id: string, candidateIds: readonly string[]): Promise<ResolveResult> {
        const res = await this.send('PATCH', `/api/v1/foods/${encodeURIComponent(id)}`, { candidateIds });

        return this.expect<ResolveResult>(res, 200, resolveResponseSchema, id);
    }

    /**
     * Issue an authenticated request and normalize the response (status + parsed body + `Retry-After`).
     *
     * @param method - HTTP method.
     * @param path - Path beginning with `/`.
     * @param body - Optional JSON body.
     * @returns The normalized response.
     * @throws {FetchUnavailableError} when the request exceeds {@link timeoutMs} (client abort) or the
     *   transport fails outright — both mean the food service did not respond usably.
     * @sideEffect Performs a network request via the injected `fetch`.
     */
    private async send(method: string, path: string, body?: unknown): Promise<RawResponse> {
        const headers: Record<string, string> = { accept: 'application/json' };
        const token = await this.resolveToken();

        if (token) {
            headers['authorization'] = `Bearer ${token}`;
        }

        let payload: string | undefined;

        if (body !== undefined) {
            headers['content-type'] = 'application/json';
            payload = JSON.stringify(body);
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => {
            controller.abort();
        }, this.timeoutMs);

        let response: Response;
        let text: string;

        try {
            response = await this.fetchImpl(`${this.baseUrl}${path}`, {
                method,
                headers,
                body: payload,
                signal: controller.signal,
            });

            // Read the body INSIDE the armed deadline. A load-degraded food service can stall the
            // response body AFTER headers arrive; clearing the timer before this (or reading in the
            // caller) would leave a body-read hang that is never aborted → the call never resolves.
            text = await response.text();
        } catch (error) {
            // Any failure of the network operation — a client abort (the timeout fired) or a raw
            // transport error (ECONNRESET / ENOTFOUND / undici "fetch failed") — means the food
            // service did not respond usably: the timeout class of failure. Carry the cause so a
            // permanent misconfig (e.g. bad host) is diagnosable.
            throw new FetchUnavailableError(undefined, 'Food service request failed or timed out', error);
        } finally {
            clearTimeout(timeout);
        }

        // DRIFT LAYER 3 (Skew), consumer half — CODING_STANDARDS §15.2.5. Fired HERE, after a response has been
        // received, and deliberately NOT awaited: it must add no latency, change no response, and never throw.
        // "After a response" so the one-shot is not spent on an origin we never reached; once per ORIGIN per
        // process (not per client instance) because instances are minted per keystroke. See `./contractSkew.ts`.
        reportContractSkewOnce({ baseUrl: this.baseUrl, fetch: this.fetchImpl, warn: this.onContractSkew });

        const retryAfter = response.headers.get('retry-after');

        return {
            status: response.status,
            body: text.length > 0 ? JSON.parse(text) : undefined,
            retryAfterSeconds: retryAfter !== null && retryAfter.length > 0 ? Number(retryAfter) : undefined,
        };
    }

    /**
     * On the expected success `status`, **parse** the body with `schema` and return the validated value;
     * otherwise throw the typed error for the status.
     *
     * PARSE, DON'T VALIDATE, at the wire boundary. Every success path in this client used to end in
     * `return res.body as T` — eight of them — which asserts a shape instead of establishing one. The
     * consequence was not theoretical: the `as` made the client's beliefs about the server unfalsifiable at
     * runtime, so a response that had drifted from the contract surfaced as a mystery `undefined` deep inside a
     * caller (the recipe service's ingredient path, a web component) rather than as a loud failure at the edge
     * that names the field. The `@kitchensink/schema-food` zod parsed here is the SAME definition the food
     * service authors and validates its own requests with, so there is one representation of the contract and
     * this side can no longer disagree with it silently.
     *
     * The `as T` bridges the schema's inferred output to the (deprecated-alias) result type, and is safe
     * precisely BECAUSE `schema.parse` has already validated the runtime shape — the opposite situation to the
     * casts it replaces.
     *
     * @param res - The normalized response.
     * @param status - The status that means success for this call.
     * @param schema - The published schema for that success body.
     * @returns The validated body.
     * @throws the typed error (via {@link toError}) on any other status, or a `ZodError` when the body does not
     *   match the published contract.
     */
    private expect<T>(res: RawResponse, status: number, schema: z.ZodType, id = ''): T {
        if (res.status === status) {
            return schema.parse(res.body) as T;
        }

        throw this.toError(res, id);
    }

    /** Resolve the configured token (literal or callback), or `undefined` for an unauthenticated call. */
    private async resolveToken(): Promise<string | undefined> {
        if (this.token === undefined) {
            return undefined;
        }

        return typeof this.token === 'function' ? this.token() : this.token;
    }

    /** Map a non-success response to the typed error for its status (FR-051 precedence + DSN-14). */
    private toError(res: RawResponse, id: string): FoodServiceClientError {
        const body = (res.body ?? {}) as { error?: string; message?: string; status?: FoodStatus };

        switch (res.status) {
            case 400:
                return new BadRequestError(body.error ?? body.message);
            case 401:
                return new UnauthorizedError(body.error ?? body.message);
            case 403:
                return new ForbiddenError(body.error ?? body.message);
            case 404:
                return new NotFoundError(id, body.status);
            case 409:
                // A candidate-not-in-set 409 is a CandidateMismatchError (DSN-14); any other 409 is a
                // lifecycle conflict (e.g. not awaiting disambiguation).
                return /candidate/i.test(body.error ?? '')
                    ? new CandidateMismatchError(id)
                    : new ConflictError(body.error ?? body.message);
            case 503:
                return new FetchUnavailableError(res.retryAfterSeconds, body.error ?? body.message);
            default:
                return new UnexpectedResponseError(res.status);
        }
    }
}
