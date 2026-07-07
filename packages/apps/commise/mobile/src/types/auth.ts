import type { UserReadDto, UserStatus } from '@commise/services-identity';

export type { UserReadDto, UserStatus };

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

export class AccountSuspendedError extends Error {
    readonly code = 'account_suspended' as const;
    constructor(message = 'Account suspended') {
        super(message);
        this.name = 'AccountSuspendedError';
    }
}

export class ImpersonationBlockedError extends Error {
    readonly code = 'impersonation_blocked' as const;
    constructor(message = 'Impersonation blocked') {
        super(message);
        this.name = 'ImpersonationBlockedError';
    }
}

export function isAccountSuspendedError(error: unknown): error is AccountSuspendedError {
    return error instanceof AccountSuspendedError;
}

export const SUSPENDED_BLOCK: AuthBlockMessage = {
    title: 'Account suspended',
    body: 'Your account has been suspended. Please contact support.',
    code: 'account_suspended',
};

export const IMPERSONATION_BLOCK: AuthBlockMessage = {
    title: 'Impersonation blocked',
    body: 'Impersonated sessions cannot access the mobile app.',
    code: 'impersonation_blocked',
};
