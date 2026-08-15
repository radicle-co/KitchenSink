/**
 * ARCH-BE-5-test — unit tests for the `@OwnerId()` / `@CurrentPrincipal()` resolver factories.
 *
 * The decorators wrap {@link resolveOwnerId} / {@link resolveCurrentPrincipal}; we exercise those
 * factories against a mock {@link ExecutionContext} to pin the two behaviours that used to live (and be
 * separately tested) in every controller: return the verified value when a principal is present, and
 * fail closed with `401` when it is absent.
 */
import { describe, it, expect } from 'vitest';
import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';

import { resolveCurrentPrincipal, resolveOwnerId } from '../currentPrincipal.decorator.js';
import type { AuthenticatedRequest, Principal } from '../principal.js';

const PRINCIPAL: Principal = {
    userId: '01J000000000000000000FREE0',
    sub: 'clerk_sub',
    scopes: [],
    permissions: ['premium'],
};

/** A mock `ExecutionContext` whose HTTP request carries (or omits) a principal. */
function ctxWith(principal?: Principal): ExecutionContext {
    const request = { principal } as unknown as AuthenticatedRequest;

    return {
        switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
}

describe('resolveCurrentPrincipal', () => {
    it('returns the verified principal when present', () => {
        expect(resolveCurrentPrincipal(undefined, ctxWith(PRINCIPAL))).toBe(PRINCIPAL);
    });

    it('throws 401 when no principal is present', () => {
        expect(() => resolveCurrentPrincipal(undefined, ctxWith(undefined))).toThrow(UnauthorizedException);
    });
});

describe('resolveOwnerId', () => {
    it('returns the principal owner key (userId) when present', () => {
        expect(resolveOwnerId(undefined, ctxWith(PRINCIPAL))).toBe(PRINCIPAL.userId);
    });

    it('throws 401 when no principal is present', () => {
        expect(() => resolveOwnerId(undefined, ctxWith(undefined))).toThrow(UnauthorizedException);
    });
});
