/**
 * Unit tests for {@link resolveServicePrincipal} — the `@ServiceErasurePrincipal()` resolver (CR-002 /
 * U4b / R11). It returns the verified principal the guard attached, and fails closed (401) when absent (a
 * route reached without the guard verifying a token) rather than fabricating one.
 */
import { describe, it, expect } from 'vitest';
import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';

import { resolveServicePrincipal } from '../servicePrincipal.decorator.js';
import type { ServiceAuthenticatedRequest, ServicePrincipal } from '../servicePrincipal.js';

const ctxFor = (request: Partial<ServiceAuthenticatedRequest>): ExecutionContext =>
    ({ switchToHttp: () => ({ getRequest: () => request }) }) as unknown as ExecutionContext;

describe('resolveServicePrincipal', () => {
    it('returns the verified principal set by the guard', () => {
        const principal: ServicePrincipal = { ownerId: '01JOWNER00000000000000000A', eventId: 'e', actor: 'w' };

        expect(resolveServicePrincipal(undefined, ctxFor({ servicePrincipal: principal }))).toEqual(principal);
    });

    it('fails closed with 401 when no principal is present (route escaped the guard)', () => {
        expect(() => resolveServicePrincipal(undefined, ctxFor({}))).toThrow(UnauthorizedException);
    });
});
