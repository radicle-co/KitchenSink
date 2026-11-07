/**
 * Unit tests for the suspended-account rule (ADR-0081): how the mark is read, the error that carries a refusal, and the
 * one list of routes a suspended user may still call.
 */
import { describe, expect, it } from 'vitest';

import {
    ACCOUNT_SUSPENDED_CODE,
    ClerkAccountSuspendedError,
    SUSPENDED_METADATA_KEY,
    isClerkAccountSuspendedError,
    isSuspendedAllowedRoute,
    isSuspendedMark,
} from '../accountSuspension.js';
import { ClerkVerificationError } from '../clerkVerify.js';

describe('isSuspendedMark', () => {
    it.each([undefined, null, false])('%s means not suspended', (value) => {
        expect(isSuspendedMark(value)).toBe(false);
    });

    // The mark takes access away, so an odd value fails toward the safe side: suspended.
    it.each([true, 'true', 'false', 1, 0, {}, []])('%j means suspended', (value) => {
        expect(isSuspendedMark(value)).toBe(true);
    });

    it('names the public_metadata key the worker writes', () => {
        expect(SUSPENDED_METADATA_KEY).toBe('suspended');
    });
});

describe('ACCOUNT_SUSPENDED_CODE', () => {
    // Every adopter answers with this one code, and each service publishes it in its own error contract. The literal is
    // pinned here so a rename cannot slip past the contracts that spell it out.
    it('is the one wire code a suspended account is answered with', () => {
        expect(ACCOUNT_SUSPENDED_CODE).toBe('ACCOUNT_SUSPENDED');
    });
});

describe('ClerkAccountSuspendedError', () => {
    it('is its own class, not a verification failure, so an adopter can answer 403 instead of 401', () => {
        const error = new ClerkAccountSuspendedError();

        expect(isClerkAccountSuspendedError(error)).toBe(true);
        expect(error).not.toBeInstanceOf(ClerkVerificationError);
        expect(isClerkAccountSuspendedError(new ClerkVerificationError())).toBe(false);
        expect(isClerkAccountSuspendedError(new Error('x'))).toBe(false);
    });
});

describe('isSuspendedAllowedRoute', () => {
    it.each([
        ['POST', '/api/v1/users/me/erasure'],
        ['POST', '/v1/users/me/erasure'],
        ['POST', '/api/v1/account/erasure'],
        ['GET', '/api/v1/account/export'],
        ['GET', '/api/v1/recipes'],
        ['get', '/api/v1/recipes/'],
        ['GET', '/api/v1/recipes?pageSize=100&cursor=abc'],
    ])('admits %s %s', (method, path) => {
        expect(isSuspendedAllowedRoute({ method, path })).toBe(true);
    });

    it.each([
        ['GET', '/api/v1/users/me'],
        ['PATCH', '/api/v1/users/me'],
        ['DELETE', '/api/v1/users/me'],
        ['GET', '/api/v1/users/me/erasure'],
        ['POST', '/api/v1/recipes'],
        ['GET', '/api/v1/recipes/01J9ZK8N7QF3B2X4M6T0V5C1AB'],
        ['GET', '/api/v1/account/erasure'],
        ['POST', '/api/v1/account/export'],
        ['POST', '/api/v1/internal/account/erasure'],
        ['GET', '/api/v1/foods/search'],
        ['POST', '/api/v1/users/me/erasure/extra'],
        ['POST', '/x/api/v1/users/me/erasure'],
        // Fail-closed shapes: anything that is not EXACTLY an allow-listed method and path is refused.
        ['GET', '/API/V1/RECIPES'],
        ['POST', '/API/V1/USERS/ME/ERASURE'],
        ['HEAD', '/api/v1/recipes'],
        ['HEAD', '/api/v1/account/export'],
        ['GET', '//api/v1/recipes'],
        ['GET', '/api/v1//recipes'],
        ['GET', '/api%2Fv1/recipes'],
        ['GET', '/api/v1%2Frecipes'],
        ['GET', '/api/v1/recipes%2F'],
        ['GET', '/api/v1/account/export-x'],
        ['POST', '/api/v1/account/erasure-x'],
        ['GET', '/api/v1/recipes/.'],
        ['GET', '/api/v1/recipes;x=1'],
        ['GET', '/api/v1/recipes#frag'],
    ])('refuses %s %s', (method, path) => {
        expect(isSuspendedAllowedRoute({ method, path })).toBe(false);
    });
});
