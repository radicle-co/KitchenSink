/**
 * `FoodServiceClient` (T-057) — the typed client for our own source-agnostic `/v1/foods/*` API. It is
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
    FoodView,
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

    /** @param options - Base URL, optional token (user or M2M), optional `fetch` double, and timeout. */
    public constructor(options: FoodServiceClientOptions) {
        this.baseUrl = options.baseUrl.replace(/\/+$/, '');
        this.token = options.token;
        this.fetchImpl = options.fetch ?? fetch;
        this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    }

    /**
     * `POST /v1/foods` — add a food by name (`202`).
     *
     * @param name - The display name to resolve.
     * @returns The created/deduped food id + status.
     * @throws {BadRequestError} on an empty name; {@link UnauthorizedError}/{@link ForbiddenError} on
     *   auth failure; {@link FetchUnavailableError} when shed by backpressure.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async addByName(name: string): Promise<AddResult> {
        const res = await this.send('POST', '/v1/foods', { name });

        if (res.status === 202) {
            return res.body as AddResult;
        }

        throw this.toError(res, '');
    }

    /**
     * `POST /v1/foods/batch` — add up to 100 names; per-item partial result.
     *
     * @param names - The names to add (≤100; over → `400`).
     * @returns Per-item results (inline hits + pending misses).
     * @throws {BadRequestError} when the batch is oversized/malformed; auth + backpressure errors as above.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async batch(names: readonly string[]): Promise<BatchResult> {
        const res = await this.send('POST', '/v1/foods/batch', { names });

        if (res.status >= 200 && res.status < 300) {
            return res.body as BatchResult;
        }

        throw this.toError(res, '');
    }

    /**
     * `GET /v1/foods/{id}` — read the golden record, or a non-terminal pending state.
     *
     * @param id - The internal food id.
     * @returns `RESOLVED` with the golden record, else a `PENDING`/`UNRESOLVED` result.
     * @throws {NotFoundError} for `NOT_FOUND`/`FAILED`/no row; {@link BadRequestError} on a malformed id.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async getById(id: string): Promise<GetFoodResult> {
        const res = await this.send('GET', `/v1/foods/${encodeURIComponent(id)}`);

        if (res.status === 200) {
            return { status: 'RESOLVED', food: res.body as FoodView };
        }

        if (res.status === 202) {
            const body = res.body as { id: string; status: 'PENDING' | 'UNRESOLVED'; estimatedWaitSeconds?: number };

            return { status: body.status, id: body.id, estimatedWaitSeconds: body.estimatedWaitSeconds };
        }

        throw this.toError(res, id);
    }

    /**
     * `GET /v1/foods/{id}/status` — lifecycle poll (never enqueues).
     *
     * @param id - The internal food id.
     * @returns The status (plus the golden record when `RESOLVED`).
     * @throws {NotFoundError} when no row exists; {@link BadRequestError} on a malformed id.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async getStatus(id: string): Promise<StatusResult> {
        const res = await this.send('GET', `/v1/foods/${encodeURIComponent(id)}/status`);

        if (res.status === 200) {
            return res.body as StatusResult;
        }

        throw this.toError(res, id);
    }

    /**
     * `GET /v1/foods/{id}/candidates` — the disambiguation candidate set for an `UNRESOLVED` food.
     *
     * @param id - The internal food id.
     * @returns The (non-expired) candidate set (empty for a non-`UNRESOLVED` food).
     * @throws {NotFoundError} when no row exists.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async getCandidates(id: string): Promise<CandidatesResult> {
        const res = await this.send('GET', `/v1/foods/${encodeURIComponent(id)}/candidates`);

        if (res.status === 200) {
            return res.body as CandidatesResult;
        }

        throw this.toError(res, id);
    }

    /**
     * `GET /v1/foods/search?query=` — local fuzzy/crosswalk search (never calls a source).
     *
     * @param query - The search query.
     * @returns Ranked results, or an empty set on no local match.
     * @throws {UnauthorizedError}/{@link ForbiddenError} on auth failure.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async search(query: string): Promise<SearchResult> {
        const res = await this.send('GET', `/v1/foods/search?query=${encodeURIComponent(query)}`);

        if (res.status === 200) {
            return res.body as SearchResult;
        }

        throw this.toError(res, '');
    }

    /**
     * `PATCH /v1/foods/{id}` — resolve an `UNRESOLVED` food from a candidate pick.
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
        const res = await this.send('PATCH', `/v1/foods/${encodeURIComponent(id)}`, { candidateIds });

        if (res.status === 200) {
            return res.body as ResolveResult;
        }

        throw this.toError(res, id);
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

        const retryAfter = response.headers.get('retry-after');

        return {
            status: response.status,
            body: text.length > 0 ? JSON.parse(text) : undefined,
            retryAfterSeconds: retryAfter !== null && retryAfter.length > 0 ? Number(retryAfter) : undefined,
        };
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
