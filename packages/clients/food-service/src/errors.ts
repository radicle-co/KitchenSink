/**
 * Typed error hierarchy for `@kitchensink/food-service-client` (T-057). Each maps a food-service HTTP
 * status to a discriminable error so a downstream caller (001 recipes, 006 meal-planning, …) handles
 * outcomes by type, not by inspecting status codes. Every error extends `Error`, calls
 * `Object.setPrototypeOf` (so `instanceof` survives transpilation), and ships an `is*` guard
 * (CODING_STANDARDS).
 *
 * There is deliberately NO `429`/rate-limit error: the food service never rejects an authenticated
 * caller with a per-user quota (FR-043). Capacity pressure surfaces ONLY as {@link FetchUnavailableError}
 * (`503`). A candidate pick not in the food's set surfaces as {@link CandidateMismatchError} (`409`,
 * DSN-14), never `400` (which is reserved for a malformed request body).
 *
 * @implements FR-047
 */
import type { FoodStatus } from './types.js';

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
    /** The terminal food status when a row exists (`NOT_FOUND` | `FAILED`), else `undefined`. */
    public readonly foodStatus?: FoodStatus;

    public constructor(id: string, foodStatus?: FoodStatus) {
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
 * `503` — the food service is not usably available. This covers both an explicit server-side
 * `503` (backpressure / flood-shed / resolve capacity exhaustion; NEVER a per-user `429`) AND a
 * client-side timeout/abort or raw transport failure (the service did not respond within the
 * configured deadline, or the connection failed). Both mean the same thing to a caller: "back off
 * and retry" — so they share one typed error rather than a parallel transport hierarchy. When it
 * originates from a transport failure the underlying error is preserved in {@link cause} and
 * `retryAfterSeconds` is `undefined` (there is no `Retry-After` without a response).
 */
export class FetchUnavailableError extends FoodServiceClientError {
    /** Seconds the caller should wait before retrying (from `Retry-After`, when present). */
    public readonly retryAfterSeconds: number | undefined;
    /** The underlying transport error (abort / timeout / ECONNRESET / DNS), when there is one. */
    public override readonly cause: unknown;

    public constructor(retryAfterSeconds?: number, message = 'Fetch temporarily unavailable', cause?: unknown) {
        super(message, 503);
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
