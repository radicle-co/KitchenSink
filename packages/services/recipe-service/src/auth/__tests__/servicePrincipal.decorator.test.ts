/**
 * Unit tests for {@link resolveServicePrincipal} (behind `@ServiceErasurePrincipal()`) — CR-002 / U4a.
 *
 * The decorator is fail-closed: it surfaces the verified service principal the guard attached, and rejects
 * with `401` if it is somehow absent (a route reached without the guard) rather than fabricating one.
 */
import { describe, it, expect } from 'vitest';
import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';

import { resolveServicePrincipal } from '../servicePrincipal.decorator.js';
import type { ServiceAuthenticatedRequest, ServicePrincipal } from '../servicePrincipal.js';

const PRINCIPAL: ServicePrincipal = {
    ownerId: '01JOWNER00000000000000000A',
    eventId: 'evt_del_1',
    actor: 'identity-deletion-worker',
};

function contextFor(request: ServiceAuthenticatedRequest): ExecutionContext {
    return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}

describe('resolveServicePrincipal', () => {
    it('returns the verified service principal the guard attached', () => {
        const request = { servicePrincipal: PRINCIPAL } as ServiceAuthenticatedRequest;

        expect(resolveServicePrincipal(undefined, contextFor(request))).toEqual(PRINCIPAL);
    });

    it('rejects with 401 when no service principal is present (route escaped the guard)', () => {
        const request = {} as ServiceAuthenticatedRequest;

        expect(() => resolveServicePrincipal(undefined, contextFor(request))).toThrow(UnauthorizedException);
    });
});
