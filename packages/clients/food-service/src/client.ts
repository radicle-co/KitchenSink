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
    addFoodRequestSchema,
    addResponseSchema,
    apiErrorSchema,
    batchAddFoodRequestSchema,
    batchResponseSchema,
    candidatesResponseSchema,
    foodErrorSchema,
    foodResponseSchema,
    pendingResponseSchema,
    resolveFoodRequestSchema,
    resolveResponseSchema,
    searchFoodQuerySchema,
    canonicalNutritionQuery,
    foodNutritionBatchResponseSchema,
    liveSearchResponseSchema,
    searchResponseSchema,
    statusResponseSchema,
} from '@kitchensink/schema-food';
import type { FoodError, LiveSearchResponse } from '@kitchensink/schema-food';

import { reportContractSkewOnce } from './contractSkew.js';
import {
    BadRequestError,
    CandidateMismatchError,
    ConflictError,
    FetchUnavailableError,
    ForbiddenError,
    FoodServiceClientError,
    InvalidRequestError,
    NotFoundError,
    SourceUnavailableError,
    UnauthorizedError,
    UnexpectedResponseError,
} from './errors.js';
import type {
    AddResult,
    BatchResult,
    CandidatesResult,
    GetFoodResult,
    ResolveResult,
    SearchResult,
    StatusResult,
    FoodNutritionBatchResult,
} from './types.js';

/**
 * The base URL with any trailing slashes removed. Deliberately NOT `/\/+$/`: that regex backtracks
 * quadratically over a long run of slashes (measured at 1.6s for 100k), which is `js/polynomial-redos`. A base
 * URL comes from configuration rather than a request, so this is defence in depth, not a live exposure. Pure.
 */
function withoutTrailingSlashes(url: string): string {
    let end = url.length;

    while (end > 0 && url.charAt(end - 1) === '/') {
        end -= 1;
    }

    return url.slice(0, end);
}

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

/**
 * A normalized response: status, parsed JSON body (or `undefined`), and a parsed `Retry-After`.
 *
 * @notWireShape This client's own transport envelope — the food service never sends this object. It is the
 *   `{ status, body, retryAfterSeconds }` triple `send()` produces so `expect()` and `toError()` can dispatch
 *   on a status without re-reading a `Response`, so there is nothing in `@kitchensink/schema-food` to import
 *   or derive it from. (The wire BODIES it carries at `.body` are parsed against the published contract.)
 */
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
        this.baseUrl = withoutTrailingSlashes(options.baseUrl);
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
        const res = await this.send('POST', '/api/v1/foods', this.request('addByName', addFoodRequestSchema, { name }));

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
        const res = await this.send(
            'POST',
            '/api/v1/foods/batch',
            this.request('batch', batchAddFoodRequestSchema, { names }),
        );

        // 201, not 200 — and that is worth pinning rather than tolerating. `POST /api/v1/foods/batch` carries no
        // `@HttpCode` and does not set a status on the response, so it gets Nest's POST default of 201 (asserted
        // by `tests/foodsApi.integration.test.ts`). The old check here was `res.status >= 200 && res.status < 300`,
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
            // ONE parse, and no re-narrowing. `pendingResponseSchema.status` published the FULL five-value
            // lifecycle until 2026-08-12, even though only `PENDING`/`UNRESOLVED` can answer a `202` — so this
            // method had to re-apply the two-value enum HERE just to keep its own declared return union honest,
            // a stopgap for a contract that disagreed with itself. The published schema is now the two-value
            // enum, so parsing it is sufficient and the stopgap is gone.
            return pendingResponseSchema.parse(res.body);
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
     * @param withNutrition - Opt-in per-100g macro enrichment (plan U4b). Leave unset on a typeahead path —
     *   the flag adds a nutrient-view scan the keystroke budget must not carry.
     * @returns Ranked results, or an empty set on no local match.
     * @throws {UnauthorizedError}/{@link ForbiddenError} on auth failure.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async search(query: string, withNutrition = false): Promise<SearchResult> {
        // The QUERY is validated too, against the same `searchFoodQuerySchema` the service parses it with, so a
        // term this client cannot legally send never costs a round trip. `?? ''` is not a defensive shrug: the
        // published field is `.optional()` and its own doc says an absent query "is treated as empty, which
        // yields an empty result set", so the empty string IS the contract's meaning for absent — and this
        // method's signature requires a `string` anyway, making the branch unreachable in practice.
        const { query: validated } = this.request('search', searchFoodQuerySchema, {
            query,
            ...(withNutrition ? { withNutrition: 'true' as const } : {}),
        });
        const res = await this.send(
            'GET',
            `/api/v1/foods/search?query=${encodeURIComponent(validated ?? '')}${withNutrition ? '&withNutrition=true' : ''}`,
        );

        return this.expect<SearchResult>(res, 200, searchResponseSchema);
    }

    /**
     * `GET /api/v1/foods/search/live?query=` — the ON-DEMAND source search (plan U29).
     *
     * ⛔ **Never call this from a typeahead.** Unlike {@link search} it leaves the food service's database
     * and spends one call against a SHARED per-IP source quota, out of FR-019's reserved interactive lane.
     * It exists for a deliberate, occasional action a cook chooses — a button they press — because at 50
     * concurrent users a per-settled-query autocomplete would want roughly three times the whole hourly key.
     * It is also the SLOW path: a multi-second wait is expected and is not covered by SC-007's 500ms budget,
     * which governs the local search.
     *
     * Three outcomes are deliberately distinguishable, and a caller must keep them apart:
     *  - an EMPTY `results` — the source has nothing for this query (stop looking);
     *  - {@link FetchUnavailableError} — our lane is exhausted or the source throttled us (retry);
     *  - {@link SourceUnavailableError} — the source did not answer (retry, but no known window).
     *
     * @param query - The search text. Must meet the shared search minimum; shorter is refused by the
     *   service with a `400` rather than emptied, so a caller should gate on `meetsSearchMinimum` first.
     * @returns The source's hits, each carrying our internal `id` when it is already in our catalog.
     * @throws {BadRequestError} when the query is below the service's search minimum.
     * @throws {FetchUnavailableError} `503` — our interactive lane is exhausted, or the source said `429`.
     * @throws {SourceUnavailableError} `502` — the source did not answer.
     * @throws {UnauthorizedError}/{@link ForbiddenError} on auth failure.
     * @sideEffect Performs an authenticated HTTP request that causes an upstream source call.
     */
    public async searchLive(query: string): Promise<LiveSearchResponse> {
        // Validated against the same `searchFoodQuerySchema` the service parses with, so a structurally
        // illegal term never costs a round trip on the one path that spends external quota.
        const { query: validated } = this.request('searchLive', searchFoodQuerySchema, { query });
        const res = await this.send('GET', `/api/v1/foods/search/live?query=${encodeURIComponent(validated ?? '')}`);

        return this.expect<LiveSearchResponse>(res, 200, liveSearchResponseSchema);
    }

    /**
     * `GET /api/v1/foods/nutrition?ids=…` — batch per-100g nutrition + normalized portions (plan U8).
     *
     * The id list is CANONICALIZED by the service's own rule (sorted, de-duplicated) before the URL is
     * built, because the URL is the cache key at the edge (ADR-0020): two callers asking for the same foods
     * must produce byte-identical URLs or the CDN never hits. Building the query here rather than letting
     * each caller concatenate is what makes that true for every caller at once.
     *
     * @param ids - The food ids to look up. Order and duplicates are irrelevant — both are normalized away.
     * @returns One entry per known id plus the ids that matched nothing.
     * @throws {BadRequestError} when the list is empty or exceeds the service's per-request cap.
     * @sideEffect Performs an authenticated HTTP request.
     */
    /**
     * `GET /api/v1/foods/authored-nutrition?ids=…` (plan U18) — the AUTHENTICATED, per-caller half of the
     * nutrition read: the caller's OWN authored foods. Same response shape as {@link getNutrition}; an id
     * the caller does not own lands in `unknownIds`. Never edge-cached (per-caller by construction).
     *
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async getAuthoredNutrition(ids: readonly string[]): Promise<FoodNutritionBatchResult> {
        const res = await this.send('GET', `/api/v1/foods/authored-nutrition?${canonicalNutritionQuery(ids)}`);

        return this.expect<FoodNutritionBatchResult>(res, 200, foodNutritionBatchResponseSchema);
    }

    public async getNutrition(ids: readonly string[]): Promise<FoodNutritionBatchResult> {
        const res = await this.send('GET', `/api/v1/foods/nutrition?${canonicalNutritionQuery(ids)}`);

        return this.expect<FoodNutritionBatchResult>(res, 200, foodNutritionBatchResponseSchema);
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
        const res = await this.send(
            'PATCH',
            `/api/v1/foods/${encodeURIComponent(id)}`,
            this.request('resolve', resolveFoodRequestSchema, { candidateIds }),
        );

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

    /**
     * Parse an OUTBOUND body/query against the request schema the food service publishes, and return it.
     *
     * PARSE, DON'T VALIDATE — in the direction that was entirely missing. Every write here serialized whatever
     * it was handed, so this client's only statement about a request was a TypeScript annotation that erases at
     * runtime: `addByName('')` and `resolve(id, [])` are both illegal per the published schemas and both left as
     * requests, coming back as a {@link BadRequestError} whose only diagnosis was the server's message.
     * zod's key-stripping also NORMALIZES, so a stray property cannot reach the wire even where structural
     * typing admitted it.
     *
     * ⚠️ WHAT THIS DOES **NOT** CHECK, deliberately: server-side POLICY the contract does not carry. The batch
     * cap is `FOOD_MAX_BATCH_NAMES`, a runtime configuration value that `batchAddFoodRequestSchema` states it is
     * leaving out precisely so there is no second representation of it — so an oversized batch still goes out and
     * still comes back a {@link BadRequestError}. Re-declaring that bound here to "fail faster" would recreate
     * the duplication §15 exists to forbid, one layer down.
     *
     * @param operation - The method name, for the error message.
     * @param schema - The published request schema for this endpoint.
     * @param body - The caller's body (or query bag).
     * @returns The parsed, key-stripped value.
     * @throws {InvalidRequestError} when it does not satisfy the published contract — deliberately not a
     *   {@link BadRequestError}, which means "the server said 400" and is a different fault with a different fix.
     */
    private request<S extends z.ZodType>(operation: string, schema: S, body: unknown): z.output<S> {
        const parsed = schema.safeParse(body);

        if (!parsed.success) {
            throw new InvalidRequestError(operation, parsed.error);
        }

        return parsed.data as z.output<S>;
    }

    /** Resolve the configured token (literal or callback), or `undefined` for an unauthenticated call. */
    private async resolveToken(): Promise<string | undefined> {
        if (this.token === undefined) {
            return undefined;
        }

        return typeof this.token === 'function' ? this.token() : this.token;
    }

    /**
     * Map a non-success response to its typed error (FR-051 precedence + DSN-14).
     *
     * ── TWO LAYERS, AND BOTH ARE LOAD-BEARING ──
     *
     * 1. **`foodErrorSchema` — the published discriminated union — decides the error, keyed on `code`.** This is
     *    what replaced `/candidate/i.test(body.error)`. That regex was a control-flow branch taken on human-
     *    readable prose: it picked {@link CandidateMismatchError} over {@link ConflictError} — two `409`s the
     *    status cannot separate and whose correct handling differs — and it would have broken on the first copy
     *    edit to the server's message, or fired on any unrelated message containing the word "candidate". The
     *    switch below is EXHAUSTIVE over the published codes, so a code the service adds is a `typecheck`
     *    failure here rather than a silent fall-through at runtime.
     * 2. **`apiErrorSchema` then the STATUS, for anything the union does not recognise.** A body may legitimately
     *    be an envelope carrying a code this build has never been taught (a deployed service adds codes ahead of
     *    a released mobile binary), or not our envelope at all — the shared internet-facing ALB serves an HTML
     *    page for `502`/`503`/`504` during every deploy (ADR-0003). Both degrade to "map by status alone", which
     *    {@link errorForStatus} still does correctly.
     *
     * `safeParse` throughout, never `parse`: throwing here would replace a recoverable typed error with a
     * `ZodError` escaping the error-mapping path itself.
     *
     * @param res - The normalized non-success response.
     * @param id - The food id the call concerned (`''` where the call has none), used only where the body
     *   carries no `details.id` of its own.
     * @returns The typed error to throw.
     */
    private toError(res: RawResponse, id: string): FoodServiceClientError {
        const known = foodErrorSchema.safeParse(res.body);

        if (known.success) {
            return this.errorForCode(known.data, res);
        }

        const envelope = apiErrorSchema.safeParse(res.body);

        return this.errorForStatus(res, id, envelope.success ? envelope.data.message : undefined);
    }

    /**
     * The typed error for a body whose `code` this build knows, narrowed by the published union.
     *
     * Every `details` read here is one the union GUARANTEES for that code — `details.id` on the by-id failures,
     * `details.status` as a real `FoodStatus` — which is why there is no optional chaining and no re-narrowing.
     * The service's error envelope typed its lifecycle `status` as a bare `z.string()` until 2026-08-12, and this
     * client had to `safeParse` it against the enum at this boundary just to construct a {@link NotFoundError};
     * the published `details.status` is now the terminal-status enum, so that stopgap is gone.
     *
     * @param body - The narrowed error body.
     * @param res - The normalized response (for the status and the `Retry-After` header).
     * @returns The typed error to throw. Pure.
     */
    private errorForCode(body: FoodError, res: RawResponse): FoodServiceClientError {
        switch (body.code) {
            case 'VALIDATION_FAILED':
            case 'INVALID_ID':
            case 'BATCH_TOO_LARGE':
                return new BadRequestError(body.message);
            // Two distinct 401s, deliberately mapped to one client error but keeping the server's own message:
            // `IDENTITY_SYNC_PENDING` means "retry with a refreshed token", which is what the message says.
            case 'UNAUTHORIZED':
            case 'IDENTITY_SYNC_PENDING':
                return new UnauthorizedError(body.message);
            case 'FORBIDDEN':
                return new ForbiddenError(body.message);
            case 'FOOD_NOT_FOUND':
                return new NotFoundError(body.details.id, body.details.status);
            case 'CANDIDATE_MISMATCH':
                return new CandidateMismatchError(body.details.id);
            // Three 409s, one client error: the status cannot separate them and the correct handling is the
            // server's message, which names the route to use instead. A caller needing the distinction has
            // the `code` on the parsed body.
            case 'NOT_RESOLVABLE':
            case 'NOT_REQUEUEABLE':
            case 'NOT_EDITABLE': // U10: a pipeline food refusing edits — same 409 treatment; `code` carries the distinction.
            case 'DUPLICATE_AUTHORED_NAME': // U10: the per-author name collision; `details.existingId` names the row.
            case 'FOOD_REFERENCED': // U18: live recipes reference the food; `details` carries the count + own ids.
                return new ConflictError(body.message);
            case 'FETCH_UNAVAILABLE':
                // The header is the transport-level contract and wins; the body repeats it for a consumer that
                // only has the payload (and for the case a proxy stripped the header).
                return new FetchUnavailableError(res.retryAfterSeconds ?? body.details.retryAfterSeconds, body.message);
            // ⛔ A SEPARATE error from the one above, not a 502-shaped alias of it. That one is OUR budget
            // refusing, with a retry window; this one is the upstream source being down, with none. The
            // picker renders them as two different sentences, so conflating them here would mislead a cook.
            case 'SOURCE_UNAVAILABLE':
                return new SourceUnavailableError(body.message);
            // U18: the delete's reference check could not run — a 503 that is neither our budget
            // (FETCH_UNAVAILABLE) nor an upstream food source (SOURCE_UNAVAILABLE); surface it plainly.
            case 'REFERENCE_CHECK_UNAVAILABLE':
                return new UnexpectedResponseError(res.status, body.message);
            // A `202` or a `500` reaching the error path means the service answered with something this call
            // cannot represent. Surfacing it loudly is the honest outcome; swallowing it is how a contract break
            // becomes a mystery `undefined` three layers into a caller.
            case 'FOOD_PENDING':
            case 'INTERNAL_ERROR':
                return new UnexpectedResponseError(res.status, body.message);

            default: {
                // EXHAUSTIVENESS GATE (§15.1: drift must fail at `typecheck`, not in e2e). Adding a code to the
                // service's `foodErrorCodeSchema` breaks this line until this client decides what it means — and
                // an OLDER client, which cannot have this arm, still degrades correctly because `safeParse`
                // rejects the unknown code before it ever gets here.
                const unhandled: never = body;

                return new UnexpectedResponseError(res.status, `Unhandled food error code ${String(unhandled)}`);
            }
        }
    }

    /**
     * The typed error for a body this build cannot narrow — an unknown `code`, or not our envelope at all.
     *
     * ⚠️ A `409` here CANNOT be a {@link CandidateMismatchError}: without the `code` there is nothing to
     * distinguish it from a lifecycle conflict, and guessing from the message is the defect this design removed.
     * The conservative {@link ConflictError} is the correct answer, and a caller that needs the distinction is
     * talking to a service whose contract it cannot read — which is what the skew warning reports.
     *
     * @param res - The normalized response.
     * @param id - The food id the call concerned.
     * @param message - The envelope's message, when the body was at least an envelope.
     * @returns The typed error to throw. Pure.
     */
    private errorForStatus(res: RawResponse, id: string, message: string | undefined): FoodServiceClientError {
        switch (res.status) {
            case 400:
                return new BadRequestError(message);
            case 401:
                return new UnauthorizedError(message);
            case 403:
                return new ForbiddenError(message);
            case 404:
                return new NotFoundError(id);
            case 409:
                return new ConflictError(message);
            case 503:
                return new FetchUnavailableError(res.retryAfterSeconds, message);
            default:
                return new UnexpectedResponseError(res.status);
        }
    }
}
