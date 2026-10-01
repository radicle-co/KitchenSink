/**
 * The error taxonomy for the security-relevant blocked account states (`docs/CODING_STANDARDS.md` §1,
 * "Error taxonomy") — one class per `AuthBlockMessage` code, so a caller that must react to a block
 * *by throwing* discriminates on the same two cases `deriveAuthState` returns.
 *
 * They live beside `authState.ts` rather than inside it because that module's subject is the STATE
 * derivation, and beside `errors.ts` rather than inside it because that file is the
 * `ProfileServiceClient` HTTP hierarchy rooted at `ProfileServiceClientError` — these two extend `Error`
 * directly and are raised by the auth gate, not by an HTTP response.
 *
 * Both follow the repo's custom-error convention: extend `Error`, call `Object.setPrototypeOf` (so
 * `instanceof` survives transpilation), and ship a matching `is*` guard.
 */

export class AccountSuspendedError extends Error {
    readonly code = 'account_suspended' as const;

    constructor(message = 'Account suspended') {
        super(message);
        this.name = 'AccountSuspendedError';
        Object.setPrototypeOf(this, AccountSuspendedError.prototype);
    }
}

export class ImpersonationBlockedError extends Error {
    readonly code = 'impersonation_blocked' as const;

    constructor(message = 'Impersonation blocked') {
        super(message);
        this.name = 'ImpersonationBlockedError';
        Object.setPrototypeOf(this, ImpersonationBlockedError.prototype);
    }
}

/** Type guard for {@link AccountSuspendedError}. */
export function isAccountSuspendedError(error: unknown): error is AccountSuspendedError {
    return error instanceof AccountSuspendedError;
}

/** Type guard for {@link ImpersonationBlockedError}. */
export function isImpersonationBlockedError(error: unknown): error is ImpersonationBlockedError {
    return error instanceof ImpersonationBlockedError;
}
