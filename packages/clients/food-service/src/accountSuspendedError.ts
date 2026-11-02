import { ForbiddenError } from './errors.js';

/**
 * `403 ACCOUNT_SUSPENDED` (ADR-0081) — the token is genuine but its account is suspended.
 *
 * A {@link ForbiddenError} (it is a 403, so a handler that treats forbidden calls alike still works), with a type of its
 * own because the remedy is different: a missing scope can be granted and a sign-in can be retried, but a suspension is
 * lifted only by staff. A caller must not retry it.
 */
export class AccountSuspendedError extends ForbiddenError {
    public constructor(message = 'Account is suspended') {
        super(message);
        this.name = 'AccountSuspendedError';
        Object.setPrototypeOf(this, AccountSuspendedError.prototype);
    }
}

/** Type guard for {@link AccountSuspendedError}. */
export function isAccountSuspendedError(error: unknown): error is AccountSuspendedError {
    return error instanceof AccountSuspendedError;
}
