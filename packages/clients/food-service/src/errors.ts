/**
 * Typed error hierarchy for `@kitchensink/food-service-client` (T-057). Each maps a food-service HTTP
 * status to a discriminable error so a downstream caller (001 recipes, 006 meal-planning, …) handles
 * outcomes by type, not by inspecting status codes. Every error extends `Error`, calls
 * `Object.setPrototypeOf` (so `instanceof` survives transpilation), and ships an `is*` guard
 * (CODING_STANDARDS).
 *
 * Capacity pressure surfaces ONLY as {@link FetchUnavailableError}, as its {@link SourceBusyError} when the `503` came in
 * a response. A `429` is a per-caller limit: on resolve and the remote pick it is
 * {@link RequesterLimitReachedError}, on the searches {@link SearchRateLimitedError}, and {@link RateLimitedError}
 * when it carries no code this build knows. A candidate pick not in the food's set
 * surfaces as {@link CandidateMismatchError} (`409`, DSN-14), never `400` (which is reserved for a malformed
 * request body).
 *
 * @implements FR-047
 */
import type { TerminalFoodStatus } from '@kitchensink/schema-food';

/** Base class for all food-service client errors. Carries the originating HTTP status. */
export class FoodServiceClientError extends Error {
    /** The HTTP status that produced this error (`undefined` for transport/parse failures). */
    public readonly status: number | undefined;

    public constructor(message: string, status?: number) {
        super(message);
        this.name = 'FoodServiceClientError';
        this.status = status;
        Object.setPrototypeOf(this, FoodServiceClientError.prototype);
    }
}

/** Type guard for {@link FoodServiceClientError}. */
export function isFoodServiceClientError(error: unknown): error is FoodServiceClientError {
    return error instanceof FoodServiceClientError;
}

/** `401` — no/invalid/expired token, or wrong authorized party (the caller is unauthenticated). */
export class UnauthorizedError extends FoodServiceClientError {
    public constructor(message = 'Unauthorized') {
        super(message, 401);
        this.name = 'UnauthorizedError';
        Object.setPrototypeOf(this, UnauthorizedError.prototype);
    }
}

/** Type guard for {@link UnauthorizedError}. */
export function isUnauthorizedError(error: unknown): error is UnauthorizedError {
    return error instanceof UnauthorizedError;
}

/** `403` — authenticated but lacking the required operational scope (e.g. `food:admin`). */
export class ForbiddenError extends FoodServiceClientError {
    public constructor(message = 'Forbidden') {
        super(message, 403);
        this.name = 'ForbiddenError';
        Object.setPrototypeOf(this, ForbiddenError.prototype);
    }
}

/** Type guard for {@link ForbiddenError}. */
export function isForbiddenError(error: unknown): error is ForbiddenError {
    return error instanceof ForbiddenError;
}

/** `400` — malformed request (empty name, oversized batch, malformed body). */
export class BadRequestError extends FoodServiceClientError {
    public constructor(message = 'Bad request') {
        super(message, 400);
        this.name = 'BadRequestError';
        Object.setPrototypeOf(this, BadRequestError.prototype);
    }
}

/** Type guard for {@link BadRequestError}. */
export function isBadRequestError(error: unknown): error is BadRequestError {
    return error instanceof BadRequestError;
}

/** `404` — no such food, or a `NOT_FOUND`/`FAILED` terminal food (its status is still retrievable). */
export class NotFoundError extends FoodServiceClientError {
    /** Internal food id. */
    public readonly id: string;
    /**
     * The terminal food status when a row exists (`NOT_FOUND` | `FAILED`), else `undefined`.
     *
     * ⛔ `TerminalFoodStatus`, not the full lifecycle — a type that matches the guarantee it is built from.
     * The only construction site reads `body.details.status` of the `FOOD_NOT_FOUND` envelope arm, which
     * the published contract types as `terminalFoodStatusSchema`. Declaring it wider was a contract breach
     * in the direction that costs: it forced every consumer to defend against statuses this error can never
     * carry — a phantom branch for `WITHDRAWN` at recipe-service's translation seam among them.
     */
    public readonly foodStatus?: TerminalFoodStatus;

    public constructor(id: string, foodStatus?: TerminalFoodStatus) {
        super(`Food '${id}' not found`, 404);
        this.name = 'NotFoundError';
        this.id = id;
        this.foodStatus = foodStatus;
        Object.setPrototypeOf(this, NotFoundError.prototype);
    }
}

/** Type guard for {@link NotFoundError}. */
export function isNotFoundError(error: unknown): error is NotFoundError {
    return error instanceof NotFoundError;
}

/** `409` — a resolve pick is not in the food's own candidate set (DSN-14). */
export class CandidateMismatchError extends FoodServiceClientError {
    /** Internal food id. */
    public readonly id: string;

    public constructor(id: string) {
        super(`A picked candidate is not in food '${id}' candidate set`, 409);
        this.name = 'CandidateMismatchError';
        this.id = id;
        Object.setPrototypeOf(this, CandidateMismatchError.prototype);
    }
}

/** Type guard for {@link CandidateMismatchError}. */
export function isCandidateMismatchError(error: unknown): error is CandidateMismatchError {
    return error instanceof CandidateMismatchError;
}

/** `409` — a resolve was attempted on a food that is not awaiting disambiguation. */
export class ConflictError extends FoodServiceClientError {
    public constructor(message = 'Conflict') {
        super(message, 409);
        this.name = 'ConflictError';
        Object.setPrototypeOf(this, ConflictError.prototype);
    }
}

/** Type guard for {@link ConflictError}. */
export function isConflictError(error: unknown): error is ConflictError {
    return error instanceof ConflictError;
}

/**
 * `409 REMOTE_FOOD_GONE` — a remote hit can no longer be picked (ADR-0055 point 10): the catalog retired its item with
 * no forward, the source no longer has it, or its reference cannot be opened. The cook is told the hit is no longer
 * valid and the list searches again (`rowEditorOpenDecisions.md` P8).
 *
 * ⛔ NOT a {@link ConflictError}, though both are `409`s: that one is the editor's conflict state, and a caller that
 * branched on it would show this refusal as a recipe conflict.
 */
export class RemoteFoodGoneError extends FoodServiceClientError {
    public constructor(message = 'This remote food can no longer be picked') {
        super(message, 409);
        this.name = 'RemoteFoodGoneError';
        Object.setPrototypeOf(this, RemoteFoodGoneError.prototype);
    }
}

/** Type guard for {@link RemoteFoodGoneError}. */
export function isRemoteFoodGoneError(error: unknown): error is RemoteFoodGoneError {
    return error instanceof RemoteFoodGoneError;
}

/**
 * The food service is not usably available. This covers both an explicit server-side `503` (the source window is busy,
 * a resolve's admission or re-fetch failed, or the caller's source budget could not be read; NEVER a per-caller `429`)
 * AND a client-side timeout/abort or raw transport failure (the service did not respond within the configured deadline,
 * or the connection failed). Both mean the same thing to a reader: "back off and retry", so they share one typed error
 * rather than a parallel transport hierarchy.
 *
 * Only a `503` that came in a response is a {@link SourceBusyError}, and only it carries a `status`. A transport failure
 * has no status, keeps the underlying error in {@link cause}, and has no `retryAfterSeconds`. The difference matters to
 * a WRITE: a refusal was not processed, but a dropped socket may follow a committed write, so a caller that retries on a
 * status never replays it.
 */
export class FetchUnavailableError extends FoodServiceClientError {
    /** Seconds the caller should wait before retrying (from `Retry-After`, when present). */
    public readonly retryAfterSeconds: number | undefined;
    /** The underlying transport error (abort / timeout / ECONNRESET / DNS), when there is one. */
    public override readonly cause: unknown;

    public constructor(retryAfterSeconds?: number, message = 'Fetch temporarily unavailable', cause?: unknown) {
        super(message);
        this.name = 'FetchUnavailableError';
        this.retryAfterSeconds = retryAfterSeconds;
        this.cause = cause;
        Object.setPrototypeOf(this, FetchUnavailableError.prototype);
    }
}

/** Type guard for {@link FetchUnavailableError}. */
export function isFetchUnavailableError(error: unknown): error is FetchUnavailableError {
    return error instanceof FetchUnavailableError;
}

/**
 * A `503` that came in a RESPONSE: food answered that it is busy (plan 002 S5). A caller that knows only
 * {@link FetchUnavailableError} reads it as before. A caller that must tell "food answered busy" from "nothing answered"
 * (the remote pick's busy state, P8) reads this narrower type. A transport failure stays a plain
 * {@link FetchUnavailableError} with its `cause`.
 */
export class SourceBusyError extends FetchUnavailableError {
    /**
     * Always `503`: the response's status. Re-declared to narrow the type, and so assigned again below, as
     * {@link RequesterLimitReachedError}'s window is.
     */
    public override readonly status: number;

    public constructor(retryAfterSeconds?: number, message?: string) {
        super(retryAfterSeconds, message);
        this.name = 'SourceBusyError';
        this.status = 503;
        Object.setPrototypeOf(this, SourceBusyError.prototype);
    }
}

/** Type guard for {@link SourceBusyError}. */
export function isSourceBusyError(error: unknown): error is SourceBusyError {
    return error instanceof SourceBusyError;
}

/**
 * `429` — THIS caller passed its own per-minute cap on a capped route (plan 002 R42). Refused before any source call,
 * so it spent no quota.
 *
 * ⛔ Deliberately NOT a {@link FetchUnavailableError}. That one means the SERVICE is out of capacity for everyone
 * (`503`, and the contract says it is never a per-user `429`); this one means one caller is over its own cap while
 * the service serves everyone else. Both carry a `Retry-After`, but they are different facts with different fixes —
 * a runaway loop in one caller is not food being down — and the `503` type already carries two meanings (a shed and
 * a transport failure, told apart by `cause`). There is no `cause` here: a `429` always comes from a response.
 */
export class RateLimitedError extends FoodServiceClientError {
    /** Seconds until this caller's cap resets (from `Retry-After`, when present). */
    public readonly retryAfterSeconds: number | undefined;

    public constructor(retryAfterSeconds?: number, message = 'Too many requests') {
        super(message, 429);
        this.name = 'RateLimitedError';
        this.retryAfterSeconds = retryAfterSeconds;
        Object.setPrototypeOf(this, RateLimitedError.prototype);
    }
}

/** Type guard for {@link RateLimitedError}. */
export function isRateLimitedError(error: unknown): error is RateLimitedError {
    return error instanceof RateLimitedError;
}

/**
 * `429 REQUESTER_LIMIT_REACHED` — this caller reached its own limit on resolve and the remote pick: the per-minute cap
 * or the hourly source budget (row editor item 10). A cook reads it as "your limit, back at {time}", never as the source
 * being busy ({@link FetchUnavailableError}).
 *
 * It is a {@link RateLimitedError}, so a caller that knows only the wider type still reads a per-caller refusal. Only
 * the published code produces it: a `429` without the code stays a plain {@link RateLimitedError}, so another kind of
 * `429` cannot pass as this one.
 */
export class RequesterLimitReachedError extends RateLimitedError {
    /**
     * Whole seconds until the limit admits this caller again: the `Retry-After` header, else the body's window.
     *
     * Re-declared to narrow the type, and so assigned again below: a class-fields transform re-initialises it after
     * `super()`. Not a `declare` field, which Metro's Babel refuses.
     */
    public override readonly retryAfterSeconds: number;

    public constructor(retryAfterSeconds: number, message = 'This caller reached its own limit for source calls') {
        super(retryAfterSeconds, message);
        this.name = 'RequesterLimitReachedError';
        this.retryAfterSeconds = retryAfterSeconds;
        Object.setPrototypeOf(this, RequesterLimitReachedError.prototype);
    }
}

/** Type guard for {@link RequesterLimitReachedError}. */
export function isRequesterLimitReachedError(error: unknown): error is RequesterLimitReachedError {
    return error instanceof RequesterLimitReachedError;
}

/**
 * `429 SEARCH_RATE_LIMITED` — this caller reached its per-minute limit on the split food search (plan 002 S3, R42).
 *
 * A {@link RateLimitedError}, so a caller knowing only the wider type still reads a per-caller refusal. NOT a
 * {@link RequesterLimitReachedError}: that one is the cook's source lookups, and the search makes none.
 */
export class SearchRateLimitedError extends RateLimitedError {
    /** Whole seconds until the limit admits this caller again, re-declared and re-assigned as above. */
    public override readonly retryAfterSeconds: number;

    public constructor(retryAfterSeconds: number, message = 'This caller reached its per-minute limit on food search') {
        super(retryAfterSeconds, message);
        this.name = 'SearchRateLimitedError';
        this.retryAfterSeconds = retryAfterSeconds;
        Object.setPrototypeOf(this, SearchRateLimitedError.prototype);
    }
}

/** Type guard for {@link SearchRateLimitedError}. */
export function isSearchRateLimitedError(error: unknown): error is SearchRateLimitedError {
    return error instanceof SearchRateLimitedError;
}

/**
 * The body the CALLER built does not satisfy the request schema the food service publishes, so the request was
 * never sent (ADR-0014, outbound half).
 *
 * ⚠️ It is deliberately NOT a {@link BadRequestError}, because three failures that all look like "a 400" need
 * to stay distinguishable — the right response to each differs and a caller cannot act on a conflated one:
 *
 *  1. **This error** — the caller's own bug. The body is illegal per `@kitchensink/schema-food`; no request
 *     went out and a retry with the same body cannot work.
 *  2. {@link BadRequestError} — the SERVER answered `400`. The body was legal per the contract this client
 *     compiles against and the service rejected it anyway: either a rule the contract does not express, or
 *     genuine skew worth alerting on.
 *  3. A bare `ZodError` from the response parse — the SERVER's body drifted from the contract.
 *
 * Mirrors `@kitchensink/recipe-service-client`'s `InvalidRequestError`, so the two clients read alike.
 */
export class InvalidRequestError extends FoodServiceClientError {
    /** The `ZodError` from parsing the outbound body against the published request schema. */
    public override readonly cause: unknown;

    public constructor(operation: string, cause: unknown) {
        super(`Request body for ${operation} does not satisfy the published food-service contract`);
        this.name = 'InvalidRequestError';
        this.cause = cause;
        Object.setPrototypeOf(this, InvalidRequestError.prototype);
    }
}

/** Type guard for {@link InvalidRequestError}. */
export function isInvalidRequestError(error: unknown): error is InvalidRequestError {
    return error instanceof InvalidRequestError;
}

/** Any unmapped/unexpected response status (a contract drift the caller should surface, not swallow). */
export class UnexpectedResponseError extends FoodServiceClientError {
    public constructor(status: number, message = `Unexpected food-service response (${status})`) {
        super(message, status);
        this.name = 'UnexpectedResponseError';
        Object.setPrototypeOf(this, UnexpectedResponseError.prototype);
    }
}

/** Type guard for {@link UnexpectedResponseError}. */
export function isUnexpectedResponseError(error: unknown): error is UnexpectedResponseError {
    return error instanceof UnexpectedResponseError;
}
