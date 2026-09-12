/**
 * `FoodServiceErasureGuard` — the inbound gate for the food service-principal erasure route
 * (CR-002 / U4b / R11), the food mirror of recipe-service's U4a `ServiceErasureGuard`.
 *
 * This is a STRUCTURALLY-DISTINCT auth path: the internal erasure route is NOT covered by the Clerk
 * `FoodAuthGuard` middleware (which is mounted only on
 * `FoodsController`/`FoodsAdminController` and hard-rejects anything without a valid Clerk token), and this
 * guard protects it instead. There is deliberately no runtime `if (type === 'service')` branch inside the
 * Clerk guard — a service token is verified by a SEPARATE verifier on a SEPARATE route, so a bug in the
 * user path can never let a user token reach the internal erase, and vice versa.
 *
 * On success it attaches the verified `ServicePrincipal` (whose bound `ownerId` is the ONLY thing
 * scoping the erasure) to the request; on any failure {@link FoodServiceErasureAuthService.verify} throws
 * an opaque `401`.
 */
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';

import { extractBearer } from './bearer.js';
import { FoodServiceErasureAuthService } from './foodServiceErasureAuth.service.js';
import type { ServiceAuthenticatedRequest } from './servicePrincipal.js';

@Injectable()
export class FoodServiceErasureGuard implements CanActivate {
    public constructor(private readonly auth: FoodServiceErasureAuthService) {}

    /**
     * Verify the service-principal token and attach the bound principal, or fail closed with `401`.
     *
     * @param context - The Nest execution context for the current request.
     * @returns `true` when the token verifies (the route may proceed).
     * @throws {UnauthorizedException} (→ 401) on a missing bearer or any verification failure.
     * @sideEffect Mutates `req.servicePrincipal` on success.
     */
    public async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest<ServiceAuthenticatedRequest>();
        const bearer = extractBearer(request.headers['authorization']);

        if (!bearer) {
            throw new UnauthorizedException('Missing service bearer token');
        }

        request.servicePrincipal = await this.auth.verify(bearer);

        return true;
    }
}
