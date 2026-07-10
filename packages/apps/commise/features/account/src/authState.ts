/**
 * Cross-platform account-state derivation for the security-relevant blocked states
 * (account suspended, admin impersonation). Both the web and mobile apps derive their
 * gate from this single pure function so the two platforms cannot drift on WHICH sessions
 * are blocked or WHAT the user is told. Presentation stays platform-specific; the state
 * model and the user-facing copy live here.
 */

export type AuthState =
    | { status: 'loading' }
    | { status: 'unauthenticated' }
    | { status: 'authenticated'; userId: string }
    | { status: 'blocked'; reason: AuthBlockMessage }
    | { status: 'error'; error: Error };

export interface AuthBlockMessage {
    title: string;
    body: string;
    code: 'account_suspended' | 'impersonation_blocked';
}

export const SUSPENDED_BLOCK: AuthBlockMessage = {
    title: 'Account suspended',
    body: 'Your account has been suspended. Please contact support.',
    code: 'account_suspended',
};

export const IMPERSONATION_BLOCK: AuthBlockMessage = {
    title: 'Impersonation blocked',
    body: 'Impersonated sessions cannot access Commise.',
    code: 'impersonation_blocked',
};

export interface DeriveAuthStateInput {
    isLoaded: boolean;
    isSignedIn: boolean | null | undefined;
    userId: string | null | undefined;
    sessionClaims: Record<string, unknown> | null | undefined;
    userPublicMetadata: Record<string, unknown> | null | undefined;
}

/**
 * Reduce the identity provider's session facts to the app's account state.
 *
 * Ordering is deliberate and security-relevant: impersonation is checked BEFORE the
 * authenticated branch (an admin `act` claim blocks regardless of the impersonated user's
 * status), and suspension blocks any otherwise-valid session.
 */
export function deriveAuthState(input: DeriveAuthStateInput): AuthState {
    const { isLoaded, isSignedIn, userId, sessionClaims, userPublicMetadata } = input;

    if (!isLoaded) {
        return { status: 'loading' };
    }

    if (!isSignedIn || !userId) {
        return { status: 'unauthenticated' };
    }

    if (sessionClaims && 'act' in sessionClaims && sessionClaims['act']) {
        return { status: 'blocked', reason: IMPERSONATION_BLOCK };
    }

    const status = userPublicMetadata?.['status'];

    if (status === 'suspended') {
        return { status: 'blocked', reason: SUSPENDED_BLOCK };
    }

    return { status: 'authenticated', userId };
}

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

export function isAccountSuspendedError(error: unknown): error is AccountSuspendedError {
    return error instanceof AccountSuspendedError;
}

export function isImpersonationBlockedError(error: unknown): error is ImpersonationBlockedError {
    return error instanceof ImpersonationBlockedError;
}
