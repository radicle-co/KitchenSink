/**
 * The suspended-account rule (ADR-0081), written once and enforced by `verifyClerkToken` for every adopter.
 *
 * Identity marks a suspended account by writing `suspended: true` into the Clerk user's `public_metadata`; the
 * instance's session-token template already carries that object (it is where `scopes`, `roles` and `testPrincipal`
 * come from), so the mark rides in the signed token. A verified token that carries it is refused with
 * {@link ClerkAccountSuspendedError}, which adopters answer with `403`, except on the few routes in
 * {@link isSuspendedAllowedRoute}, which a suspended person must still reach to exercise their data rights.
 *
 * @pattern Specification — one rule object, consulted by the shared verifier; adopters only map its outcome to HTTP.
 */

/**
 * The wire `code` every adopter answers a suspended account with (`403`). The ONE spelling: adopters throw it from here,
 * and each service publishes it in its own error contract, with a test that its schema spells the same word.
 */
export const ACCOUNT_SUSPENDED_CODE = 'ACCOUNT_SUSPENDED';

/** The human-readable message that travels with {@link ACCOUNT_SUSPENDED_CODE}. */
export const ACCOUNT_SUSPENDED_MESSAGE = 'Account is suspended';

/** The `public_metadata` key the deletion worker writes (`true`) and clears (`null`). */
export const SUSPENDED_METADATA_KEY = 'suspended';

/**
 * Whether a `public_metadata.suspended` value marks the account suspended.
 *
 * Absent, `null` and `false` mean not suspended (without that nobody could use the app). Any OTHER value means
 * suspended: this mark takes access away, so a garbled value fails toward the safe side. That is the opposite of the
 * `testPrincipal` rule, which grants something and therefore reads only a strict `true`.
 *
 * @param value - The raw `public_metadata.suspended` value.
 * @returns `true` when the account is to be treated as suspended. Pure.
 */
export function isSuspendedMark(value: unknown): boolean {
    return value !== undefined && value !== null && value !== false;
}

/**
 * A validly signed token for a suspended account. Deliberately NOT a subclass of `ClerkVerificationError`: the
 * token is genuine, so adopters answer `403` (known, refused) where a bad token is `401`.
 */
export class ClerkAccountSuspendedError extends Error {
    public constructor(message = ACCOUNT_SUSPENDED_MESSAGE) {
        super(message);
        this.name = 'ClerkAccountSuspendedError';
        Object.setPrototypeOf(this, ClerkAccountSuspendedError.prototype);
    }
}

/**
 * Type guard for {@link ClerkAccountSuspendedError}.
 *
 * @param error - The thrown value.
 * @returns `true` when `error` is a {@link ClerkAccountSuspendedError}.
 */
export function isClerkAccountSuspendedError(error: unknown): error is ClerkAccountSuspendedError {
    return error instanceof ClerkAccountSuspendedError;
}

/** The request a token is presented on: enough to decide whether a suspended account may use it. */
export interface RequestTarget {
    /** The HTTP method, any case. */
    readonly method: string;
    /** The request path, with or without a query string or trailing slash. */
    readonly path: string;
}

/**
 * The routes a suspended account may still call, as `[method, anchored path pattern]`. Each is a data right the
 * person keeps whether or not they are suspended (GDPR Art. 15 access and Art. 17 erasure), and the one read the
 * erase screen needs before it can run (the recipe list that feeds the donate election).
 *
 * `(?:/api)?/v1` covers the canonical prefix and the live bare `/v1` alias (ADR-0011). Every other route, including
 * every food route, is refused.
 */
const SUSPENDED_ALLOWED_ROUTES: readonly (readonly [string, RegExp])[] = [
    ['POST', /^(?:\/api)?\/v1\/users\/me\/erasure$/u],
    ['POST', /^(?:\/api)?\/v1\/account\/erasure$/u],
    ['GET', /^(?:\/api)?\/v1\/account\/export$/u],
    ['GET', /^(?:\/api)?\/v1\/recipes$/u],
];

/**
 * Whether a suspended account may call this request.
 *
 * @param target - The method and path the token was presented on.
 * @returns `true` when the route is on the allow-list. Pure.
 */
export function isSuspendedAllowedRoute(target: RequestTarget): boolean {
    const method = target.method.toUpperCase();
    const path = (target.path.split('?')[0] ?? '').replace(/\/$/u, '');

    return SUSPENDED_ALLOWED_ROUTES.some(([allowedMethod, pattern]) => allowedMethod === method && pattern.test(path));
}
