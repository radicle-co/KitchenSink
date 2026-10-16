import { describe, expect, it } from 'vitest';

import { IMPERSONATION_BLOCK, SUSPENDED_BLOCK, deriveAuthState } from '../authState.js';

const base = {
    isLoaded: true,
    isSignedIn: true,
    userId: 'user_abc',
    sessionClaims: {} as Record<string, unknown>,
    userPublicMetadata: {} as Record<string, unknown>,
};

describe('the block reasons', () => {
    // The user-facing words live in `authBlockMessages` (localized); a pure state derivation must carry none, or the
    // notice a blocked viewer sees cannot be localized and the platforms can word one fact two ways.
    it('carry only their code, never English', () => {
        expect(SUSPENDED_BLOCK).toEqual({ code: 'account_suspended' });
        expect(IMPERSONATION_BLOCK).toEqual({ code: 'impersonation_blocked' });
    });
});

describe('deriveAuthState', () => {
    it('returns loading before the IdP has loaded', () => {
        expect(deriveAuthState({ ...base, isLoaded: false })).toEqual({ status: 'loading' });
    });

    it('returns unauthenticated when not signed in', () => {
        expect(deriveAuthState({ ...base, isSignedIn: false, userId: null })).toEqual({
            status: 'unauthenticated',
        });
    });

    it('returns unauthenticated when signed-in flag is set but userId is missing', () => {
        expect(deriveAuthState({ ...base, userId: null })).toEqual({ status: 'unauthenticated' });
    });

    it('returns authenticated for a valid, non-impersonated, active session', () => {
        expect(deriveAuthState(base)).toEqual({ status: 'authenticated', userId: 'user_abc' });
    });

    it('blocks impersonated sessions (act claim) even when the impersonated user is active', () => {
        expect(deriveAuthState({ ...base, sessionClaims: { act: { sub: 'admin_1' } } })).toEqual({
            status: 'blocked',
            reason: IMPERSONATION_BLOCK,
        });
    });

    it('prioritises the impersonation block over suspension', () => {
        expect(
            deriveAuthState({
                ...base,
                sessionClaims: { act: { sub: 'admin_1' } },
                userPublicMetadata: { status: 'suspended' },
            }),
        ).toEqual({ status: 'blocked', reason: IMPERSONATION_BLOCK });
    });

    it('blocks suspended accounts', () => {
        expect(deriveAuthState({ ...base, userPublicMetadata: { status: 'suspended' } })).toEqual({
            status: 'blocked',
            reason: SUSPENDED_BLOCK,
        });
    });

    it('does not block on a falsy act claim', () => {
        expect(deriveAuthState({ ...base, sessionClaims: { act: null } })).toEqual({
            status: 'authenticated',
            userId: 'user_abc',
        });
    });
});
