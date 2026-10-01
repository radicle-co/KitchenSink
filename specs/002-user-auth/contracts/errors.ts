/**
 * ⛔ SUPERSEDED — HAND-WRITTEN, VERIFIED BY NOTHING. NOT THE CONTRACT AUTHORITY.
 *
 * Per GR-015 / `docs/CODING_STANDARDS.md` §15 / ADR-0014 the identity service AUTHORS its wire contract as
 * zod in the `*.schema.ts` files under `packages/services/identity/src/`, copied to `packages/schemas/identity`
 * (`@kitchensink/schema-identity`), from which the normative `openapi.yaml` is DERIVED. Where this file and
 * the service's zod disagree, THE SERVICE'S ZOD WINS.
 *
 * ⛔ Do not extend this file, and do not import it into `packages/`. Author the zod in the service.
 *
 * Retained as the historical record while documents under `specs/` still cite it.
 */
/**
 * @module contracts/errors
 * @description Custom error types for auth-related failures. All errors extend `Error`
 * and expose a type guard per Constitution Principle I (NFR-009).
 *
 * Source spec: specs/002-user-auth/spec.md NFR-009
 */

/**
 * Thrown when a user's auth session has expired and a new login is required.
 * This is a client-facing error — the consumer should redirect to the login screen.
 */
export class AuthSessionExpiredError extends Error {
    /** @inheritdoc */
    override readonly name = 'AuthSessionExpiredError' as const;

    /**
     * @param message - Human-readable reason for session expiry.
     */
    constructor(message = 'Auth session has expired. Please log in again.') {
        super(message);
    }
}

/**
 * Type guard for {@link AuthSessionExpiredError}.
 * @param error - The value to check.
 * @returns `true` if `error` is an `AuthSessionExpiredError`.
 */
export function isAuthSessionExpiredError(error: unknown): error is AuthSessionExpiredError {
    return error instanceof AuthSessionExpiredError;
}

// ---------------------------------------------------------------------------

/**
 * Thrown when a user record is not found in the Commise database.
 * Usually indicates a reconciliation failure — the IdP user exists but the DB record does not.
 */
export class UserNotFoundError extends Error {
    /** @inheritdoc */
    override readonly name = 'UserNotFoundError' as const;

    /**
     * @param userId - The canonical user ID or IdP user ID that was not found.
     */
    constructor(userId: string) {
        super(`User not found: ${userId}`);
    }
}

/**
 * Type guard for {@link UserNotFoundError}.
 * @param error - The value to check.
 * @returns `true` if `error` is a `UserNotFoundError`.
 */
export function isUserNotFoundError(error: unknown): error is UserNotFoundError {
    return error instanceof UserNotFoundError;
}

// ---------------------------------------------------------------------------

/**
 * Thrown when account deletion fails after the maximum number of retry attempts.
 * The IdP user may still exist and requires manual deletion.
 */
export class AccountDeletionFailedError extends Error {
    /** @inheritdoc */
    override readonly name = 'AccountDeletionFailedError' as const;

    /**
     * @param identityUserId - The IdP user ID that could not be deleted.
     * @param attempts - Number of deletion attempts made.
     */
    constructor(
        public readonly identityUserId: string,
        public readonly attempts: number,
    ) {
        super(`IdP user deletion failed after ${attempts} attempts: ${identityUserId}`);
    }
}

/**
 * Type guard for {@link AccountDeletionFailedError}.
 * @param error - The value to check.
 * @returns `true` if `error` is an `AccountDeletionFailedError`.
 */
export function isAccountDeletionFailedError(error: unknown): error is AccountDeletionFailedError {
    return error instanceof AccountDeletionFailedError;
}

// ---------------------------------------------------------------------------

/**
 * Thrown when a JWT token fails validation (signature invalid, expired, wrong audience, etc.).
 * The authorizer Lambda throws this to return a 401 Unauthorized to the client.
 */
export class TokenValidationError extends Error {
    /** @inheritdoc */
    override readonly name = 'TokenValidationError' as const;

    /**
     * @param message - The reason for validation failure (safe to log, not sent to client).
     */
    constructor(message: string) {
        super(message);
    }
}

/**
 * Type guard for {@link TokenValidationError}.
 * @param error - The value to check.
 * @returns `true` if `error` is a `TokenValidationError`.
 */
export function isTokenValidationError(error: unknown): error is TokenValidationError {
    return error instanceof TokenValidationError;
}

// ---------------------------------------------------------------------------

/**
 * Thrown when a user is suspended and attempts to access a protected endpoint.
 * The authorizer Lambda throws this to return a 403 Forbidden to the client.
 */
export class UserSuspendedError extends Error {
    /** @inheritdoc */
    override readonly name = 'UserSuspendedError' as const;

    /**
     * @param userId - The canonical user ID of the suspended user.
     */
    constructor(userId: string) {
        super(`User account is suspended: ${userId}`);
    }
}

/**
 * Type guard for {@link UserSuspendedError}.
 * @param error - The value to check.
 * @returns `true` if `error` is a `UserSuspendedError`.
 */
export function isUserSuspendedError(error: unknown): error is UserSuspendedError {
    return error instanceof UserSuspendedError;
}
