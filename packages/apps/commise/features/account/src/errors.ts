/**
 * Typed error hierarchy for {@link ProfileServiceClient} (DA10-c). Each maps an identity-service HTTP
 * status (`GET`/`PATCH`/`DELETE /v1/users/me`) to a discriminable error so a downstream caller (web/mobile
 * UI) handles outcomes by type, not by inspecting status codes. Every error extends `Error`, calls
 * `Object.setPrototypeOf` (so `instanceof` survives transpilation), and ships an `is*` guard
 * (CODING_STANDARDS). Mirrors the shape — and, per the repo's own precedent
 * (`@kitchensink/recipe-service-client`'s `errors.ts` and `@kitchensink/food-service-client`'s `errors.ts`
 * both export the SAME plain `BadRequestError`/`UnauthorizedError`/… names, scoped by module) — the naming
 * of `@kitchensink/recipe-service-client/errors.js`.
 *
 * Status → error map: `400` → {@link BadRequestError}, `401` → {@link UnauthorizedError}, `403` →
 * {@link ForbiddenError}, `404` → {@link NotFoundError}, anything else → {@link UnexpectedResponseError}.
 * `409`/`410` are deliberately NOT modeled here — unlike the recipe service's optimistic-concurrency and
 * GDPR-erasure flows, none of `GET`/`PATCH`/`DELETE /v1/users/me` can produce them.
 */

/** Base class for all profile-service client errors. Carries the originating HTTP status + domain code. */
export class ProfileServiceClientError extends Error {
    /** The HTTP status that produced this error (`undefined` for transport/parse failures). */
    public readonly status: number | undefined;
    /** The identity-service error code from the response body (`{ code }`), when present. */
    public readonly code: string | undefined;

    public constructor(message: string, status?: number, code?: string) {
        super(message);
        this.name = 'ProfileServiceClientError';
        this.status = status;
        this.code = code;
        Object.setPrototypeOf(this, ProfileServiceClientError.prototype);
    }
}

/** Type guard for {@link ProfileServiceClientError}. */
export function isProfileServiceClientError(error: unknown): error is ProfileServiceClientError {
    return error instanceof ProfileServiceClientError;
}

/** `400` — malformed request (e.g. `PatchUserMeBodyDto` validation failure). */
export class BadRequestError extends ProfileServiceClientError {
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
export class UnauthorizedError extends ProfileServiceClientError {
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

/** `403` — authenticated but forbidden from the action. */
export class ForbiddenError extends ProfileServiceClientError {
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

/** `404` — no such user/profile. */
export class NotFoundError extends ProfileServiceClientError {
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

/** Any unmapped/unexpected response status (a contract drift the caller should surface, not swallow). */
export class UnexpectedResponseError extends ProfileServiceClientError {
    public constructor(status?: number, message = `Unexpected identity-service response (${status ?? 'unknown'})`) {
        super(message, status);
        this.name = 'UnexpectedResponseError';
        Object.setPrototypeOf(this, UnexpectedResponseError.prototype);
    }
}

/** Type guard for {@link UnexpectedResponseError}. */
export function isUnexpectedResponseError(error: unknown): error is UnexpectedResponseError {
    return error instanceof UnexpectedResponseError;
}
