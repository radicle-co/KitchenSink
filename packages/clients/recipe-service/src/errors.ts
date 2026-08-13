/**
 * Typed error hierarchy for `@kitchensink/recipe-service-client` (T-004 / T-095). Each maps a recipe
 * service HTTP status to a discriminable error so a downstream caller (web/mobile UI, other services)
 * handles outcomes by type, not by inspecting status codes. Every error extends `Error`, calls
 * `Object.setPrototypeOf` (so `instanceof` survives transpilation), and ships an `is*` guard
 * (CODING_STANDARDS). Mirrors the shape of `@kitchensink/food-service-client`'s error module.
 *
 * Status → error map (per `contracts/api.openapi.yaml`):
 *   `400` → {@link BadRequestError}, `401` → {@link UnauthorizedError}, `403` → {@link ForbiddenError},
 *   `404` → {@link NotFoundError}, `409` → {@link VersionConflictError} (optimistic-concurrency) OR
 *   {@link PullDriftError} (pull-from-source drift — the two `409`s are disambiguated by the response
 *   body's `code`), `410` → {@link GoneError} (account already erased), anything else →
 *   {@link UnexpectedResponseError}.
 *
 * The optional `code` is the PUBLISHED `ApiError.code` — `recipeErrorCodeSchema` in
 * `@kitchensink/schema-recipe`, authored by the service. It is typed as a plain `string` on purpose, not as
 * that enum: a deployed service may emit a code ahead of a released mobile binary, and narrowing here would turn
 * a forward-compatible deploy into a client-side type error. The typed narrowing happens once, in
 * `client.ts`'s `errorForCode`, whose `switch` IS exhaustive over the published set.
 */
import type { VersionConflictSide } from '@kitchensink/recipe-core';

import type { PullDiff } from './types.js';

/** Base class for all recipe-service client errors. Carries the originating HTTP status + domain code. */
export class RecipeServiceClientError extends Error {
    /** The HTTP status that produced this error (`undefined` for transport/parse failures). */
    public readonly status: number | undefined;
    /** The recipe-domain error code from the response body (`ErrorResponse.code`), when present. */
    public readonly code: string | undefined;

    public constructor(message: string, status?: number, code?: string) {
        super(message);
        this.name = 'RecipeServiceClientError';
        this.status = status;
        this.code = code;
        Object.setPrototypeOf(this, RecipeServiceClientError.prototype);
    }
}

/** Type guard for {@link RecipeServiceClientError}. */
export function isRecipeServiceClientError(error: unknown): error is RecipeServiceClientError {
    return error instanceof RecipeServiceClientError;
}

/** `400` — malformed request (validation failure, or a non-cloned collection has no source to pull). */
export class BadRequestError extends RecipeServiceClientError {
    public constructor(message = 'Bad request', code?: string) {
        super(message, 400, code);
        this.name = 'BadRequestError';
        Object.setPrototypeOf(this, BadRequestError.prototype);
    }
}

/** Type guard for {@link BadRequestError}. */
export function isBadRequestError(error: unknown): error is BadRequestError {
    return error instanceof BadRequestError;
}

/** `401` — no/invalid/expired token, or wrong authorized party (the caller is unauthenticated). */
export class UnauthorizedError extends RecipeServiceClientError {
    public constructor(message = 'Unauthorized', code?: string) {
        super(message, 401, code);
        this.name = 'UnauthorizedError';
        Object.setPrototypeOf(this, UnauthorizedError.prototype);
    }
}

/** Type guard for {@link UnauthorizedError}. */
export function isUnauthorizedError(error: unknown): error is UnauthorizedError {
    return error instanceof UnauthorizedError;
}

/** `403` — authenticated but not the owner of the recipe/collection being acted on (`NOT_OWNER`). */
export class ForbiddenError extends RecipeServiceClientError {
    public constructor(message = 'Forbidden', code?: string) {
        super(message, 403, code);
        this.name = 'ForbiddenError';
        Object.setPrototypeOf(this, ForbiddenError.prototype);
    }
}

/** Type guard for {@link ForbiddenError}. */
export function isForbiddenError(error: unknown): error is ForbiddenError {
    return error instanceof ForbiddenError;
}

/** `404` — no such recipe/collection/version/photo, or a tombstoned recipe on a production read path. */
export class NotFoundError extends RecipeServiceClientError {
    public constructor(message = 'Resource not found', code?: string) {
        super(message, 404, code);
        this.name = 'NotFoundError';
        Object.setPrototypeOf(this, NotFoundError.prototype);
    }
}

/** Type guard for {@link NotFoundError}. */
export function isNotFoundError(error: unknown): error is NotFoundError {
    return error instanceof NotFoundError;
}

/**
 * `409` — optimistic-concurrency conflict on a recipe update or version restore (`VERSION_CONFLICT`).
 * Carries the server's `currentVersion` and the client's `conflictingVersion` (from the response
 * `details`) so a caller can reconcile without re-reading the recipe.
 */
export class VersionConflictError extends RecipeServiceClientError {
    /** The recipe's actual current version on the server. */
    public readonly currentVersion: number | undefined;
    /** The stale `expectedVersion` the caller sent. */
    public readonly conflictingVersion: number | undefined;
    /**
     * The current winning version's snapshot + metadata (W8-a.5) — present when the server sent the
     * enriched body (the owner-gated update path), so the conflict UI can 3-way merge without re-fetching.
     */
    public readonly server: VersionConflictSide | undefined;
    /**
     * The version the caller edited from (W8-a.5) — present when still retained in the DB window; absent
     * when evicted (the caller can fall back to its own local base, or fetch via the versions endpoint).
     */
    public readonly base: VersionConflictSide | undefined;

    public constructor(
        currentVersion?: number,
        conflictingVersion?: number,
        message = 'Recipe version conflict',
        sides?: { server?: VersionConflictSide; base?: VersionConflictSide },
    ) {
        super(message, 409, 'VERSION_CONFLICT');
        this.name = 'VersionConflictError';
        this.currentVersion = currentVersion;
        this.conflictingVersion = conflictingVersion;
        this.server = sides?.server;
        this.base = sides?.base;
        Object.setPrototypeOf(this, VersionConflictError.prototype);
    }
}

/** Type guard for {@link VersionConflictError}. */
export function isVersionConflictError(error: unknown): error is VersionConflictError {
    return error instanceof VersionConflictError;
}

/**
 * `409` — a pull-from-source commit drifted since the client's preview (`PULL_DRIFT`, W5 Task 5): the
 * source OR the caller's own clone membership changed since `previewPullFromSource`, so the previewed diff
 * no longer matches. Carries the FRESH `diff` (from the response `details`) so the caller can re-present
 * the updated changes rather than silently applying a set the user never confirmed.
 */
export class PullDriftError extends RecipeServiceClientError {
    /** The freshly recomputed diff (added/removed/unchanged) as of the rejected commit attempt. */
    public readonly diff: PullDiff;

    public constructor(diff: PullDiff, message = 'The source changed since you previewed this pull.') {
        super(message, 409, 'PULL_DRIFT');
        this.name = 'PullDriftError';
        this.diff = diff;
        Object.setPrototypeOf(this, PullDriftError.prototype);
    }
}

/** Type guard for {@link PullDriftError}. */
export function isPullDriftError(error: unknown): error is PullDriftError {
    return error instanceof PullDriftError;
}

/** `410` — the account has already been erased (a prior GDPR erasure job completed; `ALREADY_ERASED`). */
export class GoneError extends RecipeServiceClientError {
    public constructor(message = 'Account has already been erased', code?: string) {
        super(message, 410, code);
        this.name = 'GoneError';
        Object.setPrototypeOf(this, GoneError.prototype);
    }
}

/** Type guard for {@link GoneError}. */
export function isGoneError(error: unknown): error is GoneError {
    return error instanceof GoneError;
}

/**
 * The service did not respond within the client's request timeout, so the call was aborted. Carries NO HTTP
 * status — nothing answered — which is exactly why it needs its own type: a hung connection is otherwise
 * indistinguishable from "still loading", and an unbounded wait leaves every consuming query pending for the
 * life of the page (the surface's loading branch never flips, and its empty/error branches are unreachable).
 * Mirrors `@kitchensink/food-service-client`'s `FetchUnavailableError`, so the two clients read alike.
 */
export class FetchUnavailableError extends RecipeServiceClientError {
    /**
     * The underlying abort/timeout error, when the transport supplied one. Narrows `Error.cause` (which the
     * ES2022 lib declares as optional `unknown`) to a value this constructor always sets, so a caller reading
     * `error.cause` for diagnostics does not have to widen it back.
     */
    public override readonly cause: unknown;

    public constructor(message = 'Recipe service did not respond in time', cause?: unknown) {
        super(message);
        this.name = 'FetchUnavailableError';
        this.cause = cause;
        Object.setPrototypeOf(this, FetchUnavailableError.prototype);
    }
}

/** Type guard for {@link FetchUnavailableError}. */
export function isFetchUnavailableError(error: unknown): error is FetchUnavailableError {
    return error instanceof FetchUnavailableError;
}

/**
 * The body the CALLER built does not satisfy the request schema the service publishes, so the request was
 * never sent (ADR-0014, outbound half).
 *
 * ⚠️ It exists to keep three failures that all "look like a 400" distinguishable, because the right response
 * to each is different and a caller cannot act on a conflated one:
 *
 *  1. **This error** — the caller's own bug. The body is illegal per `@kitchensink/schema-recipe`; no request
 *     went out, nothing was charged, nothing partially applied, and a retry with the same body cannot work.
 *  2. {@link BadRequestError} — the SERVER answered `400`. The body was legal per the contract this client
 *     compiles against and the service rejected it anyway, which is either a rule the contract does not
 *     express (a policy check) or genuine skew worth alerting on.
 *  3. A bare `ZodError` out of `RecipeServiceClient`'s response parse — the SERVER's body drifted.
 *
 * Collapsing 1 into 2 would have a caller retry-and-alert on its own malformed input; collapsing 1 into 3
 * would blame the service for the client's mistake. Carries the `ZodError` as `cause` so the offending
 * field path is available without re-parsing.
 */
export class InvalidRequestError extends RecipeServiceClientError {
    /** The `ZodError` from parsing the outbound body against the published request schema. */
    public override readonly cause: unknown;

    public constructor(operation: string, cause: unknown) {
        super(`Request body for ${operation} does not satisfy the published recipe-service contract`);
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
export class UnexpectedResponseError extends RecipeServiceClientError {
    /**
     * @param status - The HTTP status that produced this error.
     * @param message - Defaults to a status-only summary when the body carried none.
     * @param code - The published `code` when the body carried one. It NOW usually does: since the recipe
     *   service converged onto one error envelope, a status this client has no dedicated error class for still
     *   arrives with a machine-readable code (`MAX_PHOTOS_EXCEEDED`, `TOO_MANY_REQUESTS`, `NOT_READY`, …), and
     *   dropping it here would discard the only actionable part of the body.
     */
    public constructor(status: number, message = `Unexpected recipe-service response (${status})`, code?: string) {
        super(message, status, code);
        this.name = 'UnexpectedResponseError';
        Object.setPrototypeOf(this, UnexpectedResponseError.prototype);
    }
}

/** Type guard for {@link UnexpectedResponseError}. */
export function isUnexpectedResponseError(error: unknown): error is UnexpectedResponseError {
    return error instanceof UnexpectedResponseError;
}
