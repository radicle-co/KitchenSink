/**
 * `FoodServiceClient` (T-057) — the typed client for our own source-agnostic `/api/v1/foods/*` API. It is
 * the single integration point downstream services (001 recipes, 006 meal-planning, 007 grocery, 009
 * nutrition) and internal jobs use, so they never hand-roll URLs, token attachment, or status mapping.
 *
 * - **Token attach (user OR M2M, FR-047).** A static bearer token or a `getToken` callback (re-read per
 *   request, so a rotated session/M2M token is always current) is sent as `Authorization: Bearer …`. A request food
 *   refuses with a `401` is replayed by the rule `@kitchensink/retry-after/bearer-replay` states for every client.
 * - **Typed results / errors.** Each method returns a typed result for its success/`202` outcomes and
 *   throws a typed error for `401`/`403`/`400`/`404`/`409`/`429`/`503` (see `./errors.js`). A `429` is the
 *   caller's own limit: a {@link RequesterLimitReachedError} on resolve and the remote pick, a
 *   {@link SearchRateLimitedError} on the searches. Capacity pressure is
 *   always a `503`. A candidate-not-in-set `409` is a {@link CandidateMismatchError} (DSN-14).
 * - **Source-agnostic.** Every food is addressed by its internal `id`; no `fdcId` appears in any shape.
 *
 * @implements FR-047
 */
import { retryAfterSeconds as readRetryAfterField } from '@kitchensink/retry-after';
import {
    withBearerReplay,
    type BearerVerdict,
    type IdentitySyncBackoffOptions,
    type TokenSource,
} from '@kitchensink/retry-after/bearer-replay';
import { anySignal } from 'any-signal';
import type { z } from 'zod';
// The RUNTIME zod from the contract the food service OWNS and publishes — the same definitions the service
// validates its own responses' shapes against, so this client parses rather than believes (§15, rule 4).
import {
    addFoodRequestSchema,
    addResponseSchema,
    adoptRemoteFoodRequestSchema,
    adoptRemoteFoodResponseSchema,
    apiErrorSchema,
    authoredFoodSearchResponseSchema,
    authoredFoodTestPurgeResponseSchema,
    batchAddFoodRequestSchema,
    batchResponseSchema,
    candidatesResponseSchema,
    catalogSearchResponseSchema,
    corroboratedResponseSchema,
    createAuthoredFoodRequestSchema,
    dataSourcesResponseSchema,
    foodErrorSchema,
    foodResponseSchema,
    pendingResponseSchema,
    resolveFoodRefsRequestSchema,
    resolveFoodRefsResponseSchema,
    resolveFoodRequestSchema,
    resolveResponseSchema,
    searchFoodQuerySchema,
    searchTermQuerySchema,
    canonicalNutritionQuery,
    foodNutritionBatchResponseSchema,
    searchResponseSchema,
    statusResponseSchema,
} from '@kitchensink/schema-food';
import type {
    AddResponse,
    AdoptRemoteFoodResponse,
    AuthoredFoodSearchResponse,
    AuthoredFoodTestPurgeResponse,
    BatchResponse,
    CandidatesResponse,
    CatalogSearchResponse,
    DataSourcesResponse,
    FoodError,
    FoodRef,
    GetFoodResult,
    ResolveFoodRefsResponse,
    ResolveResponse,
    SearchResponse,
    StatusResponse,
} from '@kitchensink/schema-food';

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
    RateLimitedError,
    RemoteFoodGoneError,
    RequesterLimitReachedError,
    SearchRateLimitedError,
    SourceBusyError,
    UnauthorizedError,
    UnexpectedResponseError,
    isFetchUnavailableError,
} from './errors.js';
import { jsonOf } from './jsonOf.js';
import { progressiveFramesOf, type ProgressiveFrame } from './progressiveFrames.js';
import type {
    CorroboratedResult,
    CreateAuthoredFoodInput,
    CreateAuthoredFoodResult,
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

/**
 * Per-request timeout (ms). A downstream caller (e.g. the 001 recipe service's ingredient path)
 * awaits this client synchronously; without a bound, a hung food service would hang the caller
 * unbounded. 8s comfortably covers a healthy `202`/`200`/`503` round-trip while capping the worst case.
 */
const DEFAULT_TIMEOUT_MS = 8_000;

/**
 * The search routes food limits per caller per minute (plan 002 S3, R42; ADR-0055): the catalog and authored searches
 * and the progressive search. Food limits each on its own, so this client waits each out on its own.
 */
type SearchRoute = 'catalog' | 'authored' | 'progressive';

/** The media type the progressive search answers in (ADR-0055 point 9). */
const NDJSON_ACCEPT = 'application/x-ndjson';

/**
 * A request on the wire, its headers arrived: the response, the composed signal, and the timer still armed over it.
 *
 * @notWireShape This client's own handle on an open request, never a body food sends or receives.
 */
interface OpenedRequest {
    readonly response: Response;
    /** This request's timeout and the caller's deadline, composed. */
    readonly signal: AbortSignal;
    /** Disarms this request's own timeout, leaving only the caller's deadline. */
    readonly disarmTimeout: () => void;
    /** Removes the composed signal's listeners from the caller's signal, which can outlive this request. */
    readonly release: () => void;
}

/**
 * The seconds a response's `Retry-After` field asks for, as `@kitchensink/retry-after` reads it, bounded for a caller
 * that waits: a field it cannot read, or a delay too large to be a number, states nothing (so the body's window is
 * used); a date already past is no wait. Pure.
 *
 * @param field - The header's value, or `null` when the response did not carry it.
 * @param now - When the response was received, epoch milliseconds.
 * @returns Whole seconds, at least zero, or `undefined` when the field states nothing.
 */
function retryAfterOf(field: string | null, now: number): number | undefined {
    const stated = readRetryAfterField(field, now);

    return stated === undefined || !Number.isFinite(stated) ? undefined : Math.max(stated, 0);
}

/**
 * Per-call options for the read methods a caller composes into a multi-request operation.
 *
 * `signal` is the caller's DEADLINE, not a per-request timeout: the recipe service's nutrition gateway issues up to
 * `waves × chunks + 1` requests for one read, and a per-request bound alone makes that read's worst case the SUM
 * of the bounds. The signal is composed with this client's own `timeoutMs` at the transport, so an expired
 * deadline aborts the in-flight socket instead of leaving it pending behind a timer that merely stopped waiting.
 */
export interface RequestOptions {
    /** Aborts the request when it fires. An already-aborted signal refuses to start the request. */
    readonly signal?: AbortSignal;
}

/** Construction options, the back-off of a refused bearer's replay among them. */
export interface FoodServiceClientOptions extends IdentitySyncBackoffOptions {
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

/**
 * One attempt to open a request: its headers arrived, or food refused its bearer, the refusal already read.
 *
 * @notWireShape This client's own handle on an attempt, never a body food sends or receives.
 */
type OpenAttempt =
    | { readonly kind: 'opened'; readonly opened: OpenedRequest }
    | { readonly kind: 'refused'; readonly refusal: RawResponse };

/**
 * What a response means for its bearer, read from the published error union. Pure.
 *
 * @param res - The normalized response.
 * @returns `refused` for a `401`, `identitySyncPending` for a `401` with that code, else `answered`.
 */
function bearerVerdictOf(res: RawResponse): BearerVerdict {
    if (res.status !== 401) {
        return 'answered';
    }

    const known = foodErrorSchema.safeParse(res.body);

    return known.success && known.data.code === 'IDENTITY_SYNC_PENDING' ? 'identitySyncPending' : 'refused';
}

export class FoodServiceClient {
    private readonly baseUrl: string;
    private readonly token: TokenSource | undefined;
    private readonly backoff: IdentitySyncBackoffOptions;
    private readonly fetchImpl: typeof fetch;
    private readonly timeoutMs: number;
    private readonly onContractSkew: (message: string) => void;
    /**
     * When each search route may be asked again, in epoch milliseconds ({@link sendSearch}). Per instance: the apps
     * build one client per signed-in cook (ADR-0054), so one cook's refusal never holds another's searches.
     */
    private readonly searchHeldUntil = new Map<SearchRoute, number>();

    /** @param options - Base URL, optional token (user or M2M), optional `fetch` double, and timeout. */
    public constructor(options: FoodServiceClientOptions) {
        this.baseUrl = withoutTrailingSlashes(options.baseUrl);
        this.token = options.token;
        this.backoff = {
            maxIdentitySyncRetries: options.maxIdentitySyncRetries,
            identitySyncBackoffMs: options.identitySyncBackoffMs,
            sleep: options.sleep,
        };
        // Bound: a browser's `fetch` throws "Illegal invocation" when called as this object's method. Node's does not,
        // which is why only a browser test could see it (plan 002 S5 put this client in the browser).
        this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
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
    public async addByName(name: string): Promise<AddResponse> {
        const res = await this.send('POST', '/api/v1/foods', this.request('addByName', addFoodRequestSchema, { name }));

        return this.expect(res, 202, addResponseSchema);
    }

    /**
     * `POST /api/v1/foods/batch` — add up to 100 names; per-item partial result.
     *
     * @param names - The names to add (≤100; over → `400`).
     * @returns Per-item results (inline hits + pending misses).
     * @throws {BadRequestError} when the batch is oversized/malformed; auth + backpressure errors as above.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async batch(names: readonly string[]): Promise<BatchResponse> {
        const res = await this.send(
            'POST',
            '/api/v1/foods/batch',
            this.request('batch', batchAddFoodRequestSchema, { names }),
        );

        // 201, not 200 — and that is worth pinning rather than tolerating. `POST /api/v1/foods/batch` carries no
        // `@HttpCode` and does not set a status on the response, so it gets Nest's POST default of 201 (asserted
        // by `tests/foodsApi.integration.test.ts`). The old check here was `res.status >= 200 && res.status < 300`,
        // which accepted ANY 2xx and so hid which one the service actually sends — a range that would also have
        // returned a `204`'s empty body as a `BatchResponse` of `undefined`. Naming the exact status means a
        // service-side change to it now fails loudly here instead of silently.
        return this.expect(res, 201, batchResponseSchema);
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
     * `POST /api/v1/foods/authored` — create one of the CALLER's own foods (plan U10/U16; macros-only per
     * Q3a). Born `RESOLVED`, visibility `private` — retrievable by its author alone until promotion.
     *
     * The per-author name collision is a RESULT, not a throw: the U16 picker's reuse affordance needs the
     * colliding row's id, and a bare `ConflictError` cannot carry it. Every other failure maps through
     * the shared ladder.
     *
     * @param input - Name + per-100g macros (description/portions optional).
     * @returns `created` with the full authored record, or `duplicate` naming the existing food.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async createAuthoredFood(input: CreateAuthoredFoodInput): Promise<CreateAuthoredFoodResult> {
        const res = await this.send(
            'POST',
            '/api/v1/foods/authored',
            this.request('createAuthoredFood', createAuthoredFoodRequestSchema, input),
        );

        if (res.status === 201) {
            return { kind: 'created', food: foodResponseSchema.parse(res.body) };
        }

        const raw = res.body as { code?: string; details?: { existingId?: string } } | undefined;

        if (res.status === 409 && raw?.code === 'DUPLICATE_AUTHORED_NAME' && raw.details?.existingId !== undefined) {
            return { kind: 'duplicate', existingId: raw.details.existingId };
        }

        throw this.toError(res, '');
    }

    /**
     * `POST /api/v1/foods/{id}/corroborated` (plan U19, R10) — the recipe side's corroboration-promotion
     * trigger. A PENDING food completes and leaves the sync queue; every other status no-ops and answers
     * the current status.
     *
     * @param id - The food id.
     * @returns The food's (possibly unchanged) status.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async corroborateFood(id: string): Promise<CorroboratedResult> {
        const res = await this.send('POST', `/api/v1/foods/${encodeURIComponent(id)}/corroborated`);

        return this.expect(res, 200, corroboratedResponseSchema, id);
    }

    /**
     * `POST /api/v1/foods/authored/test-purge` — a TEST PRINCIPAL deletes its own private authored foods (ADR-0040,
     * food half); synchronous and repeatable (`200` with the counts).
     *
     * ⛔ A FIXTURE DOOR, NOT A PRODUCT SURFACE. No body — the principal is the token, and it purges only itself. Every
     * caller whose verified token lacks the test-principal claim receives the `404` an unrouted path answers, so the
     * method is inert for a real user. Its only caller is the pool reset in `@kitchensink/e2e-seed`.
     *
     * @returns How many private authored foods were deleted, and how many promoted ones were kept.
     * @throws {NotFoundError} (`404`) when the caller is not a test principal, or the stage does not route the door.
     * @sideEffect Performs an authenticated HTTP request that hard-deletes the caller's private authored foods.
     */
    public async purgeOwnAuthoredFoods(): Promise<AuthoredFoodTestPurgeResponse> {
        const res = await this.send('POST', '/api/v1/foods/authored/test-purge');

        return this.expect(res, 200, authoredFoodTestPurgeResponseSchema);
    }

    /**
     * `GET /api/v1/foods/{id}/status` — lifecycle poll (never enqueues).
     *
     * @param id - The internal food id.
     * @returns The status (plus the golden record when `RESOLVED`).
     * @throws {NotFoundError} when no row exists; {@link BadRequestError} on a malformed id.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async getStatus(id: string): Promise<StatusResponse> {
        const res = await this.send('GET', `/api/v1/foods/${encodeURIComponent(id)}/status`);

        return this.expect(res, 200, statusResponseSchema, id);
    }

    /**
     * `GET /api/v1/foods/{id}/candidates` — the disambiguation candidate set for an `UNRESOLVED` food.
     *
     * @param id - The internal food id.
     * @returns The (non-expired) candidate set (empty for a non-`UNRESOLVED` food).
     * @throws {NotFoundError} when no row exists.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async getCandidates(id: string): Promise<CandidatesResponse> {
        const res = await this.send('GET', `/api/v1/foods/${encodeURIComponent(id)}/candidates`);

        return this.expect(res, 200, candidatesResponseSchema, id);
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
    public async search(query: string, withNutrition = false): Promise<SearchResponse> {
        // The QUERY is validated too, against the same `searchFoodQuerySchema` the service parses it with, so a
        // term this client cannot legally send never costs a round trip.
        const { query: validated } = this.request('search', searchFoodQuerySchema, {
            query,
            ...(withNutrition ? { withNutrition: 'true' as const } : {}),
        });
        const res = await this.send(
            'GET',
            `/api/v1/foods/search?query=${this.encodeTerm('search', validated)}${withNutrition ? '&withNutrition=true' : ''}`,
        );

        return this.expect(res, 200, searchResponseSchema);
    }

    /**
     * `GET /api/v1/foods/catalog/search?query=` — the SHARED catalog search (plan 002 R40, S3): catalog roots only,
     * the same answer for every caller, so the production edge caches it on its URL (ADR-0020).
     *
     * The term is parsed with the service's own `searchTermQuerySchema`, and the URL is built from the PARSED value:
     * that is what makes one search one URL however it was typed, and so one shared cache entry. A term below the
     * search minimum is answered with an empty `200` by the service, not refused.
     *
     * ⚠️ It never carries the cook's own foods. {@link searchAuthored} reads those, and the apps show the two as two
     * groups (`docs/design/rowEditorOpenDecisions.md`, S5 list contract L1); a food absent here is not thereby private.
     *
     * @param query - The search text, as typed.
     * @param options - `signal`: aborts the request, for a search its caller superseded (see {@link RequestOptions}).
     * @returns Ranked catalog roots, each with the one variant the query names, if any.
     * @throws {InvalidRequestError} when the term is empty, too long, or holds half of a surrogate pair (no request is
     *   sent).
     * @throws {SearchRateLimitedError} `429` — this caller reached its per-minute limit on the search, or is still
     *   inside the window that refusal named (no request is sent).
     * @throws {SourceBusyError} `503` — food answered busy.
     * @throws {FetchUnavailableError} when this request's timeout or the caller's signal aborts it.
     * @throws {UnauthorizedError} on auth failure.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async searchCatalog(query: string, options: RequestOptions = {}): Promise<CatalogSearchResponse> {
        const res = await this.sendSearch(
            'catalog',
            `/api/v1/foods/catalog/search?${this.searchTerm('searchCatalog', query)}`,
            options.signal,
        );

        return this.expect(res, 200, catalogSearchResponseSchema);
    }

    /**
     * `GET /api/v1/foods/authored/search?query=` — the caller's OWN authored foods matching the term (plan 002 R40,
     * S3). The route says whose they are, so a caller groups them by the route, never by a field. Never cached. A
     * service principal owns no foods and gets an empty list.
     *
     * @param query - The search text, as typed.
     * @param options - `signal`: aborts the request, for a search its caller superseded (see {@link RequestOptions}).
     * @returns The caller's own matching foods.
     * @throws {InvalidRequestError} when the term is empty, too long, or holds half of a surrogate pair (no request is
     *   sent).
     * @throws {SearchRateLimitedError} `429` — this caller reached its per-minute limit on the search, or is still
     *   inside the window that refusal named (no request is sent).
     * @throws {SourceBusyError} `503` — food answered busy.
     * @throws {FetchUnavailableError} when this request's timeout or the caller's signal aborts it.
     * @throws {UnauthorizedError} on auth failure, `IDENTITY_SYNC_PENDING` included (retry with a refreshed token).
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async searchAuthored(query: string, options: RequestOptions = {}): Promise<AuthoredFoodSearchResponse> {
        const res = await this.sendSearch(
            'authored',
            `/api/v1/foods/authored/search?${this.searchTerm('searchAuthored', query)}`,
            options.signal,
        );

        return this.expect(res, 200, authoredFoodSearchResponseSchema);
    }

    /**
     * `GET /api/v1/foods/search/progressive?query=` — the progressive food search (ADR-0055 points 5 and 9): our
     * database's two groups, then each remote source's frame as it answers, then `complete`. The frames are yielded as
     * they arrive (`./progressiveFrames.ts` reads them), and a body that ends without `complete` simply ends: the
     * answer it built is incomplete (`./progressiveAnswer.ts`).
     *
     * The body is read from `response.body.getReader()`: the browser's `fetch`, and Expo 57's global `fetch`, which is
     * `expo/fetch`, both stream it. A runtime that hands over no stream is read buffered, with the same parser.
     *
     * ⚠️ This request's own timeout bounds only the wait for its headers, and the caller's signal bounds the body. Food
     * closes each source's frame within 8 s (plan 002 S7), so a timeout over the body would cut a slow answer off before
     * its `complete`. The caller always has a deadline over the whole answer (`rowEditorOpenDecisions.md` P3).
     *
     * @param query - The search text, as typed.
     * @param options - `signal`: the caller's deadline over the whole answer; it aborts the body and ends the frames.
     * @returns The frames, in arrival order.
     * @throws {InvalidRequestError} when the term, or its canonical form, is not a legal search term (no request).
     * @throws {SearchRateLimitedError} `429` — this caller reached its per-minute limit, or is still inside the window
     *   that refusal named (no request is sent).
     * @throws {UnauthorizedError}/{@link BadRequestError}/{@link SourceBusyError} for a refusal before the first byte.
     * @throws {FetchUnavailableError} when the headers do not arrive in time, the transport fails, the body breaks, or
     *   the caller's signal aborts it.
     * @sideEffect Performs an authenticated HTTP request (two when a refused bearer is replayed) that can cause remote
     *   source calls.
     */
    public async *searchProgressive(query: string, options: RequestOptions = {}): AsyncGenerator<ProgressiveFrame> {
        const path = `/api/v1/foods/search/progressive?${this.searchTerm('searchProgressive', query)}`;

        this.refuseWhileHeld('progressive');

        const opened = await this.open(path, NDJSON_ACCEPT, options.signal);

        try {
            if (opened.response.status !== 200) {
                const res = this.rawResponseOf(opened.response, await this.textOf(opened.response));

                throw res.status === 429 ? this.holdOnRefusal('progressive', res) : this.toError(res, '');
            }

            opened.disarmTimeout();
            yield* progressiveFramesOf(this.chunksOf(opened.response, opened.signal), () => Date.now());
        } finally {
            opened.disarmTimeout();
            opened.release();
        }
    }

    /**
     * `POST /api/v1/foods/remote/adopt` — pick a remote hit by the reference food issued with it (ADR-0055 point 10):
     * the catalog root it now is. Idempotent on the item, so a repeat answers the same root and creates nothing.
     *
     * @param reference - The hit's sealed reference, sent back unread.
     * @returns The root's id.
     * @throws {InvalidRequestError} when the reference is not one food could have issued (no request is sent).
     * @throws {RemoteFoodGoneError} `409` — the item is retired, gone from its source, or the reference is unreadable.
     * @throws {SourceBusyError} `503` — the source is busy, or a background fetch holds the food; worth a later try.
     * @throws {RequesterLimitReachedError} `429` — this caller reached its own limit on source lookups.
     * @throws {FetchUnavailableError} when the request times out or cannot reach food.
     * @sideEffect Performs an authenticated HTTP request that can make one source call and create one root.
     */
    public async adoptRemoteFood(reference: string): Promise<AdoptRemoteFoodResponse> {
        const res = await this.send(
            'POST',
            '/api/v1/foods/remote/adopt',
            this.request('adoptRemoteFood', adoptRemoteFoodRequestSchema, { reference }),
        );

        return this.expect(res, 200, adoptRemoteFoodResponseSchema);
    }

    /**
     * `GET /api/v1/foods/authored-nutrition?ids=…` (plan U18) — the AUTHENTICATED, per-caller half of the
     * nutrition read: the caller's OWN authored foods. Same response shape as {@link getNutrition}; an id
     * the caller does not own lands in `unknownIds`. Never edge-cached (per-caller by construction).
     *
     * @param ids - The food ids to look up.
     * @param options - `signal`: the caller's deadline over a multi-request operation (see {@link RequestOptions}).
     * @throws {FetchUnavailableError} when this request's timeout or the caller's signal aborts it.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async getAuthoredNutrition(
        ids: readonly string[],
        options: RequestOptions = {},
    ): Promise<FoodNutritionBatchResult> {
        const res = await this.send(
            'GET',
            `/api/v1/foods/authored-nutrition?${canonicalNutritionQuery(ids)}`,
            undefined,
            options.signal,
        );

        return this.expect(res, 200, foodNutritionBatchResponseSchema);
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
     * @param options - `signal`: the caller's deadline over a multi-request operation (see {@link RequestOptions}).
     * @returns One entry per known id plus the ids that matched nothing.
     * @throws {BadRequestError} when the list is empty or exceeds the service's per-request cap.
     * @throws {FetchUnavailableError} when this request's timeout or the caller's signal aborts it.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async getNutrition(ids: readonly string[], options: RequestOptions = {}): Promise<FoodNutritionBatchResult> {
        const res = await this.send(
            'GET',
            `/api/v1/foods/nutrition?${canonicalNutritionQuery(ids)}`,
            undefined,
            options.signal,
        );

        return this.expect(res, 200, foodNutritionBatchResponseSchema);
    }

    /**
     * `POST /api/v1/foods/refs/resolve` — what the CALLER may know about each referenced food (curated U8, roots
     * slice): `found` with its name and status, or `absent`. One entry per distinct ref, in order of first
     * appearance.
     *
     * ⛔ EVERY non-200 THROWS. Absence is an answer INSIDE a `200` body, so this method never has a failure to
     * translate into one — and a caller (recipe-service's gateway) that treats any throw as "food unreachable"
     * can rely on that. In particular a `404` here cannot mean "no such food": it means this food deployment does
     * not serve the route (previews deploy in parallel, ADR-0036). It is therefore an
     * {@link UnexpectedResponseError}, never the {@link NotFoundError} whose meaning is "no such food" — a
     * caller mapping that error to "removed" would turn a deploy skew into a permanent fact about every line.
     *
     * @param refs - 1…`MAX_FOOD_REFS` refs; a list the published schema refuses is never sent.
     * @param options - `signal`: the caller's deadline over a multi-request operation (see {@link RequestOptions}).
     * @returns The parsed answer.
     * @throws {InvalidRequestError} when the list is empty, over the cap or malformed (no request is sent).
     * @throws {UnexpectedResponseError} on a `404` (the route is not served) and any unmapped status.
     * @throws {UnauthorizedError}/{@link BadRequestError}/{@link FetchUnavailableError} through the shared ladder.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async resolveRefs(refs: readonly FoodRef[], options: RequestOptions = {}): Promise<ResolveFoodRefsResponse> {
        const res = await this.send(
            'POST',
            '/api/v1/foods/refs/resolve',
            this.request('resolveRefs', resolveFoodRefsRequestSchema, { refs }),
            options.signal,
        );

        if (res.status === 404) {
            throw new UnexpectedResponseError(404, 'The food service does not serve POST /api/v1/foods/refs/resolve');
        }

        return this.expect(res, 200, resolveFoodRefsResponseSchema);
    }

    /**
     * `GET /api/v1/foods/sources` — the data sources a stored nutrition value cites, for the Data sources page (plan
     * R55), in the register's order. The same answer for every caller.
     *
     * ⛔ A `400` or `404` here cannot mean anything the caller could fix: the request carries no input. Both mean this
     * food deployment does not serve the route — one that predates it answers `GET /{id}` with `sources` as a
     * malformed id. So both are an {@link UnexpectedResponseError}, never a {@link BadRequestError} or the
     * {@link NotFoundError} whose meaning is "no such food".
     *
     * @param options - `signal`: aborts the request, for a read its caller cancelled (see {@link RequestOptions}).
     * @returns The parsed sources; empty when nothing is cited.
     * @throws {UnexpectedResponseError} on a `400` or `404` (the route is not served) and any unmapped status.
     * @throws {UnauthorizedError}/{@link FetchUnavailableError} through the shared ladder.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async listSources(options: RequestOptions = {}): Promise<DataSourcesResponse> {
        const res = await this.send('GET', '/api/v1/foods/sources', undefined, options.signal);

        if (res.status === 400 || res.status === 404) {
            throw new UnexpectedResponseError(res.status, 'The food service does not serve GET /api/v1/foods/sources');
        }

        return this.expect(res, 200, dataSourcesResponseSchema);
    }

    /**
     * `PATCH /api/v1/foods/{id}` — resolve an `UNRESOLVED` food from a candidate pick.
     *
     * @param id - The internal food id.
     * @param candidateIds - The picked candidate row ids (validated to the food's own set).
     * @returns The id + `RESOLVED` status.
     * @throws {CandidateMismatchError} when a pick is not in the food's set; {@link ConflictError} when
     *   the food is not awaiting disambiguation; {@link FetchUnavailableError} on resolve capacity
     *   exhaustion or a transport failure; {@link RequesterLimitReachedError} past the caller's own limit;
     *   {@link NotFoundError} when no row exists.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async resolve(id: string, candidateIds: readonly string[]): Promise<ResolveResponse> {
        const res = await this.send(
            'PATCH',
            `/api/v1/foods/${encodeURIComponent(id)}`,
            this.request('resolve', resolveFoodRequestSchema, { candidateIds }),
        );

        return this.expect(res, 200, resolveResponseSchema, id);
    }

    /**
     * Refuse a search on `route` while the window food's last refusal named still runs (plan 002 S5): such a call sends
     * nothing and throws the same refusal with the seconds still to wait, rounded up.
     *
     * @param route - Which search.
     * @throws {SearchRateLimitedError} while the route is held.
     * @sideEffect Reads the clock.
     */
    private refuseWhileHeld(route: SearchRoute): void {
        const heldUntil = this.searchHeldUntil.get(route);
        const now = Date.now();

        if (heldUntil !== undefined && now < heldUntil) {
            throw new SearchRateLimitedError(Math.ceil((heldUntil - now) / 1_000));
        }
    }

    /**
     * The typed error for a search's `429`, holding the route for the window a {@link SearchRateLimitedError} names.
     * Each route has its own limit (plan 002 R42), so each is held on its own; when two refusals land, the later end
     * holds.
     *
     * @param route - Which search.
     * @param res - The `429`.
     * @returns The error to throw.
     * @sideEffect Reads the clock and records the window on this client.
     */
    private holdOnRefusal(route: SearchRoute, res: RawResponse): FoodServiceClientError {
        const refusal = this.toError(res, '');

        if (refusal instanceof SearchRateLimitedError) {
            // Read again: another call on this route may have been refused while this one was out.
            this.searchHeldUntil.set(
                route,
                Math.max(Date.now() + refusal.retryAfterSeconds * 1_000, this.searchHeldUntil.get(route) ?? 0),
            );
        }

        return refusal;
    }

    /**
     * Send one buffered search, waiting out the route's search limit ({@link refuseWhileHeld}, {@link holdOnRefusal}).
     *
     * @param route - Which search.
     * @param path - The request path, its term already parsed.
     * @param deadline - The caller's signal, as {@link send} takes it.
     * @returns The response, for any status but `429`.
     * @throws {SearchRateLimitedError} while the route is held, and on the `429` that holds it.
     * @sideEffect Reads the clock, sends the request, and records a refusal's window on this client.
     */
    private async sendSearch(route: SearchRoute, path: string, deadline?: AbortSignal): Promise<RawResponse> {
        this.refuseWhileHeld(route);

        const res = await this.send('GET', path, undefined, deadline);

        if (res.status !== 429) {
            return res;
        }

        throw this.holdOnRefusal(route, res);
    }

    /**
     * Open an authenticated `GET` and wait for its headers. A refused bearer is replayed by the shared rule
     * (`@kitchensink/retry-after/bearer-replay`); nothing else is replayed. Auth refuses before food admits any source
     * call, so a replay spends none (plan 002 R65).
     *
     * @param path - Path beginning with `/`.
     * @param accept - The media type asked for.
     * @param deadline - The caller's deadline.
     * @returns The opened request, whatever its status but `401`.
     * @throws {UnauthorizedError} when food refused the bearer and no replay changed that, the deadline ending a
     *   replay's wait included.
     * @throws {FetchUnavailableError} when the headers do not arrive in time, the deadline aborts, or the transport fails.
     * @sideEffect Performs network requests via the injected `fetch`, arms a timer for each, calls the token callback
     *   and may wait out a back-off.
     */
    private async open(path: string, accept: string, deadline: AbortSignal | undefined): Promise<OpenedRequest> {
        const attempt = await withBearerReplay<OpenAttempt>({
            token: this.token,
            send: (bearer) => this.openAttempt(path, accept, deadline, bearer),
            verdictOf: (opening) => (opening.kind === 'opened' ? 'answered' : bearerVerdictOf(opening.refusal)),
            backoff: this.backoff,
            signal: deadline,
        });

        if (attempt.kind === 'refused') {
            throw this.toError(attempt.refusal, '');
        }

        return attempt.opened;
    }

    /**
     * One {@link openOnce}, a `401` read and released at once: nothing stays open across a mint, a wait or a replay.
     *
     * @param path - Path beginning with `/`.
     * @param accept - The media type asked for.
     * @param deadline - The caller's deadline.
     * @param bearer - The bearer to send, or `undefined` for none.
     * @returns The opened request, or the refusal.
     * @throws {FetchUnavailableError} as {@link open} documents.
     * @sideEffect Performs a network request via the injected `fetch`, arms a timer, and reads a refusal's body.
     */
    private async openAttempt(
        path: string,
        accept: string,
        deadline: AbortSignal | undefined,
        bearer: string | undefined,
    ): Promise<OpenAttempt> {
        const opened = await this.openOnce(path, accept, deadline, bearer);

        if (opened.response.status !== 401) {
            return { kind: 'opened', opened };
        }

        try {
            return {
                kind: 'refused',
                refusal: this.rawResponseOf(opened.response, await this.textOf(opened.response)),
            };
        } finally {
            opened.disarmTimeout();
            opened.release();
        }
    }

    /**
     * One authenticated `GET`, waiting for its headers under this request's timeout composed with the caller's
     * deadline: {@link open}'s attempt. The timer stays armed until the caller disarms it, so a body read before that
     * is bounded by it too.
     *
     * @param path - Path beginning with `/`.
     * @param accept - The media type asked for.
     * @param deadline - The caller's deadline.
     * @param token - The bearer to send, or `undefined` for none.
     * @returns The opened request.
     * @throws {FetchUnavailableError} as {@link open} documents.
     * @sideEffect Performs a network request via the injected `fetch`, and arms a timer.
     */
    private async openOnce(
        path: string,
        accept: string,
        deadline: AbortSignal | undefined,
        token: string | undefined,
    ): Promise<OpenedRequest> {
        const headers = this.headersFor(accept, token);
        const controller = new AbortController();
        const timeout = setTimeout(() => {
            controller.abort();
        }, this.timeoutMs);
        const signal = anySignal([controller.signal, deadline]);

        const disarmTimeout = (): void => {
            clearTimeout(timeout);
        };

        try {
            const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
                method: 'GET',
                headers,
                signal,
                redirect: 'error',
            });

            reportContractSkewOnce({ baseUrl: this.baseUrl, fetch: this.fetchImpl, warn: this.onContractSkew });

            return { response, signal, disarmTimeout, release: () => signal.clear() };
        } catch (error) {
            disarmTimeout();
            signal.clear();

            throw new FetchUnavailableError(undefined, 'Food service request failed or timed out', error);
        }
    }

    /**
     * A response's whole body as text, a failure to read it being the transport's.
     *
     * @param response - The response.
     * @returns The text.
     * @throws {FetchUnavailableError} when the body cannot be read.
     * @sideEffect Reads the response body.
     */
    private async textOf(response: Response): Promise<string> {
        try {
            return await response.text();
        } catch (error) {
            throw new FetchUnavailableError(undefined, 'Food service request failed or timed out', error);
        }
    }

    /**
     * A streamed body's chunks. A runtime that hands over no stream gives its buffered body as one chunk.
     *
     * The reader is cancelled when `signal` aborts, and once reading stops for any reason (the consumer stopped early,
     * the body broke), so the transport stops too. Cancelling swallows only its own refusal: a stream that already broke
     * refuses a cancel with the error the read reported.
     *
     * @param response - A `200` whose body is the progressive answer.
     * @param signal - The request's composed signal.
     * @returns The chunks.
     * @throws {FetchUnavailableError} when the body breaks or `signal` aborts it.
     * @sideEffect Reads, and finally cancels, the response body.
     */
    private async *chunksOf(response: Response, signal: AbortSignal): AsyncGenerator<Uint8Array> {
        if (response.body === null) {
            yield new TextEncoder().encode(await this.textOf(response));

            return;
        }

        const reader = response.body.getReader();

        const cancel = (): void => {
            reader.cancel().catch(() => undefined);
        };

        signal.addEventListener('abort', cancel, { once: true });

        try {
            for (;;) {
                const chunk = await reader.read();

                if (signal.aborted) {
                    throw new FetchUnavailableError(
                        undefined,
                        'Food service request failed or timed out',
                        signal.reason,
                    );
                }

                if (chunk.done) {
                    return;
                }

                yield chunk.value;
            }
        } catch (error) {
            throw isFetchUnavailableError(error)
                ? error
                : new FetchUnavailableError(undefined, 'Food service request failed or timed out', error);
        } finally {
            signal.removeEventListener('abort', cancel);
            await reader.cancel().catch(() => undefined);
        }
    }

    /**
     * Issue an authenticated request and normalize the response (status + parsed body + `Retry-After`). A refused
     * bearer is replayed by the shared rule (`@kitchensink/retry-after/bearer-replay`); the last answer is final, so a
     * deadline that ends while a refusal is waited out answers that refusal.
     *
     * @param method - HTTP method.
     * @param path - Path beginning with `/`.
     * @param body - Optional JSON body.
     * @param deadline - The caller's deadline, composed with this request's own timeout: whichever fires first
     *   aborts the socket.
     * @returns The normalized response.
     * @throws {FetchUnavailableError} when the request exceeds {@link timeoutMs} (client abort), the caller's
     *   deadline aborts it, or the transport fails outright — all mean the food service did not respond usably.
     * @sideEffect Performs network requests via the injected `fetch`, calls the token callback and may wait out a
     *   back-off.
     */
    private async send(method: string, path: string, body?: unknown, deadline?: AbortSignal): Promise<RawResponse> {
        return withBearerReplay({
            token: this.token,
            send: (bearer) => this.sendOnce(method, path, body, deadline, bearer),
            verdictOf: bearerVerdictOf,
            backoff: this.backoff,
            signal: deadline,
        });
    }

    /**
     * One authenticated request, normalized: {@link send}'s attempt.
     *
     * @param method - HTTP method.
     * @param path - Path beginning with `/`.
     * @param body - Optional JSON body.
     * @param deadline - The caller's deadline, composed with this attempt's own timeout.
     * @param token - The bearer to send, or `undefined` for none.
     * @returns The normalized response.
     * @throws {FetchUnavailableError} as {@link send} documents.
     * @sideEffect Performs a network request via the injected `fetch`.
     */
    private async sendOnce(
        method: string,
        path: string,
        body: unknown,
        deadline: AbortSignal | undefined,
        token: string | undefined,
    ): Promise<RawResponse> {
        const headers = this.headersFor('application/json', token);

        let payload: string | undefined;

        if (body !== undefined) {
            headers['content-type'] = 'application/json';
            payload = JSON.stringify(body);
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => {
            controller.abort();
        }, this.timeoutMs);
        // Whichever of this request's timeout and the caller's deadline fires first aborts the socket, and the body read
        // below with it. ⛔ Not `AbortSignal.any`: see `withDeadline` in `@kitchensink/recipe-service-client`'s
        // `queries.ts` for the browsers the web app targets that lack it.
        const signal = anySignal([controller.signal, deadline]);

        let response: Response;
        let text: string;

        try {
            response = await this.fetchImpl(`${this.baseUrl}${path}`, {
                method,
                headers,
                body: payload,
                signal,
                // The bearer goes only to `baseUrl`: a redirect fails as a transport error rather than carrying it on.
                redirect: 'error',
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
            // The caller's signal can outlive this request (a deadline over many), so its listener goes now.
            signal.clear();
        }

        // DRIFT LAYER 3 (Skew), consumer half — CODING_STANDARDS §15.2.5. Fired HERE, after a response has been
        // received, and deliberately NOT awaited: it must add no latency, change no response, and never throw.
        // "After a response" so the one-shot is not spent on an origin we never reached; once per ORIGIN per
        // process (not per client instance) because instances are minted per keystroke. See `./contractSkew.ts`.
        reportContractSkewOnce({ baseUrl: this.baseUrl, fetch: this.fetchImpl, warn: this.onContractSkew });

        return this.rawResponseOf(response, text);
    }

    /**
     * A request's headers: what it accepts, and the bearer when there is one.
     *
     * @param accept - The media type asked for.
     * @param token - The bearer, or `undefined` for none.
     * @returns The headers. Pure.
     */
    private headersFor(accept: string, token: string | undefined): Record<string, string> {
        const headers: Record<string, string> = { accept };

        if (token) {
            headers['authorization'] = `Bearer ${token}`;
        }

        return headers;
    }

    /**
     * A received response, normalized: its status, its JSON body (or `undefined` when empty) and its `Retry-After`.
     *
     * A success body must be JSON, so a malformed one throws here. An error body may be a proxy's page instead of
     * food's envelope (the ALB's and CloudFront's HTML gateway pages, the shared ALB's `404 text/plain`), so one that
     * is not JSON is `undefined`, and {@link toError} maps it by its status.
     *
     * @param response - The response.
     * @param text - Its whole body.
     * @returns The normalized response.
     * @throws {SyntaxError} when a success body is not JSON.
     * @sideEffect Reads the clock, for a `Retry-After` given as a date.
     */
    private rawResponseOf(response: Response, text: string): RawResponse {
        let body: unknown;

        if (text.length === 0) {
            body = undefined;
        } else if (response.ok) {
            body = JSON.parse(text);
        } else {
            body = jsonOf(text);
        }

        return {
            status: response.status,
            body,
            retryAfterSeconds: retryAfterOf(response.headers.get('retry-after'), Date.now()),
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
     * @param res - The normalized response.
     * @param status - The status that means success for this call.
     * @param schema - The published schema for that success body.
     * @returns The validated body.
     * @throws the typed error (via {@link toError}) on any other status, or a `ZodError` when the body does not
     *   match the published contract.
     */
    private expect<S extends z.ZodType>(res: RawResponse, status: number, schema: S, id = ''): z.output<S> {
        if (res.status === status) {
            return schema.parse(res.body);
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

        return parsed.data;
    }

    /**
     * The query string of a search route, built from the CANONICAL term the service's schema produces.
     *
     * The canonical form is parsed a second time because the service parses what it receives: the schema bounds the
     * RAW term, and `İ` lowercases to two code units, so a term within the bound can canonicalize past it.
     *
     * @param operation - The method name, for the error message.
     * @param query - The term as typed.
     * @returns `query=<canonical term>`, URL-encoded.
     * @throws {InvalidRequestError} when the term, or its canonical form, does not satisfy `searchTermQuerySchema`, or
     *   cannot be put in a URL ({@link encodeTerm}).
     */
    private searchTerm(operation: string, query: string): string {
        const canonical = this.request(operation, searchTermQuerySchema, { query });

        return `query=${this.encodeTerm(operation, this.request(operation, searchTermQuerySchema, canonical).query)}`;
    }

    /**
     * A search term, encoded for a URL.
     *
     * Half of a surrogate pair has no URL encoding, and `encodeURIComponent` throws a bare `URIError` on exactly that.
     * The refusal is this client's own typed one, so a caller meets a typed error and no request is sent.
     *
     * @param operation - The method name, for the error message.
     * @param term - The term, already parsed.
     * @returns The encoded term. Pure.
     * @throws {InvalidRequestError} when the term holds half of a surrogate pair.
     */
    private encodeTerm(operation: string, term: string): string {
        try {
            return encodeURIComponent(term);
        } catch (error) {
            throw new InvalidRequestError(operation, error);
        }
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
                return new ConflictError(body.message);
            // ADR-0055 point 10: its own class, because the cook is told something different from a conflict.
            case 'REMOTE_FOOD_GONE':
                return new RemoteFoodGoneError(body.message);
            case 'FETCH_UNAVAILABLE':
                // The header is the transport-level contract and wins; the body repeats it for a consumer that
                // only has the payload (and for the case a proxy stripped the header).
                return new SourceBusyError(res.retryAfterSeconds ?? body.details.retryAfterSeconds, body.message);
            // The caller's own limit, never the service being busy (row editor item 10). Header first, as above.
            case 'REQUESTER_LIMIT_REACHED':
                return new RequesterLimitReachedError(
                    res.retryAfterSeconds ?? body.details.retryAfterSeconds,
                    body.message,
                );
            // The searches' own per-minute limit (plan 002 S3): a per-caller 429, but not the source-call limit.
            case 'SEARCH_RATE_LIMITED':
                return new SearchRateLimitedError(
                    res.retryAfterSeconds ?? body.details.retryAfterSeconds,
                    body.message,
                );
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
            // A per-caller limit whose body did not carry the published code, so it is not read as the requester limit.
            case 429:
                return new RateLimitedError(res.retryAfterSeconds, message);
            case 503:
                return new SourceBusyError(res.retryAfterSeconds, message);
            default:
                return new UnexpectedResponseError(res.status);
        }
    }
}
