/**
 * Unit tests for {@link ServiceErasureGuard} — the structurally-distinct inbound gate for the
 * service-principal erasure route (CR-002 / U4a), over a mocked {@link ServiceErasureAuthService}.
 *
 * Pins: a missing bearer is a `401` (before any verification); a verification failure propagates as the
 * verifier's `401` (the guard never swallows it into an allow); and a successful verification attaches the
 * bound principal to the request and lets it proceed.
 */
import { describe, it, expect, vi } from 'vitest';
import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';

import { ServiceErasureGuard } from '../serviceErasure.guard.js';
import type { ServiceErasureAuthService } from '../serviceErasureAuth.service.js';
import type { ServiceAuthenticatedRequest, ServicePrincipal } from '../servicePrincipal.js';

const PRINCIPAL: ServicePrincipal = {
    ownerId: '01JOWNER00000000000000000A',
    eventId: 'evt_del_1',
    actor: 'identity-deletion-worker',
};

/** Build an ExecutionContext wrapping the given request. */
function contextFor(request: ServiceAuthenticatedRequest): ExecutionContext {
    return {
        switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
}

/** A request with the given authorization header value (or none). */
function requestWith(authorization?: string): ServiceAuthenticatedRequest {
    return { headers: authorization !== undefined ? { authorization } : {} } as ServiceAuthenticatedRequest;
}

function makeGuard(verify: ReturnType<typeof vi.fn>): ServiceErasureGuard {
    return new ServiceErasureGuard({ verify } as unknown as ServiceErasureAuthService);
}

describe('ServiceErasureGuard', () => {
    it('rejects a request with NO bearer token — 401, without calling the verifier', async () => {
        const verify = vi.fn();
        const guard = makeGuard(verify);

        await expect(guard.canActivate(contextFor(requestWith()))).rejects.toBeInstanceOf(UnauthorizedException);
        expect(verify).not.toHaveBeenCalled();
    });

    it('propagates the verifier 401 on a bad token — never swallows a failure into an allow', async () => {
        const verify = vi.fn().mockRejectedValue(new UnauthorizedException());
        const guard = makeGuard(verify);
        const request = requestWith('Bearer forged');

        await expect(guard.canActivate(contextFor(request))).rejects.toBeInstanceOf(UnauthorizedException);
        expect(request.servicePrincipal).toBeUndefined();
    });

    it('verifies the extracted bearer and attaches the bound principal, then allows the request', async () => {
        const verify = vi.fn().mockResolvedValue(PRINCIPAL);
        const guard = makeGuard(verify);
        const request = requestWith('Bearer good-token');

        await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
        expect(verify).toHaveBeenCalledExactlyOnceWith('good-token');
        expect(request.servicePrincipal).toEqual(PRINCIPAL);
    });
});
