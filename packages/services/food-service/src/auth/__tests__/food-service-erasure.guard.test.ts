/**
 * Unit tests for {@link FoodServiceErasureGuard} (CR-002 / U4b / R11). The guard is the inbound gate for
 * the food internal erasure route: a missing bearer fails closed (401) before verification; a valid token
 * verifies and attaches the bound principal; a verification failure propagates the verifier's opaque 401.
 */
import { describe, it, expect, vi } from 'vitest';
import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';

import { FoodServiceErasureGuard } from '../food-service-erasure.guard.js';
import type { FoodServiceErasureAuthService } from '../food-service-erasure-auth.service.js';
import type { ServiceAuthenticatedRequest, ServicePrincipal } from '../service-principal.js';

const ctxFor = (request: Partial<ServiceAuthenticatedRequest>): ExecutionContext =>
    ({ switchToHttp: () => ({ getRequest: () => request }) }) as unknown as ExecutionContext;

const PRINCIPAL: ServicePrincipal = { ownerId: '01JOWNER00000000000000000A', eventId: 'e', actor: 'w' };

describe('FoodServiceErasureGuard', () => {
    it('verifies the bearer and attaches the bound principal to the request', async () => {
        const auth = { verify: vi.fn().mockResolvedValue(PRINCIPAL) };
        const guard = new FoodServiceErasureGuard(auth as unknown as FoodServiceErasureAuthService);
        const request: Partial<ServiceAuthenticatedRequest> = { headers: { authorization: 'Bearer tok' } };

        await expect(guard.canActivate(ctxFor(request))).resolves.toBe(true);
        expect(auth.verify).toHaveBeenCalledWith('tok');
        expect(request.servicePrincipal).toEqual(PRINCIPAL);
    });

    it('fails closed with 401 when the Authorization header is missing — no verification attempted', async () => {
        const auth = { verify: vi.fn() };
        const guard = new FoodServiceErasureGuard(auth as unknown as FoodServiceErasureAuthService);

        await expect(guard.canActivate(ctxFor({ headers: {} }))).rejects.toBeInstanceOf(UnauthorizedException);
        expect(auth.verify).not.toHaveBeenCalled();
    });

    it('propagates the verifier`s opaque 401 on a bad token', async () => {
        const auth = { verify: vi.fn().mockRejectedValue(new UnauthorizedException()) };
        const guard = new FoodServiceErasureGuard(auth as unknown as FoodServiceErasureAuthService);

        await expect(
            guard.canActivate(ctxFor({ headers: { authorization: 'Bearer bad' } })),
        ).rejects.toBeInstanceOf(UnauthorizedException);
    });
});
