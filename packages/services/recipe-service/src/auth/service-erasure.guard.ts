/**
 * `ServiceErasureGuard` — the inbound gate for the service-principal erasure route (CR-002 / U4a).
 *
 * This is the STRUCTURALLY-DISTINCT auth path the plan requires: the machine-authenticated internal
 * erasure route is EXCLUDED from the global Clerk `AuthMiddleware`
 * (which only accepts user session tokens and hard-rejects anything without an `external_id`), and this
 * guard is what protects it instead. There is deliberately no runtime `if (principal.type === 'service')`
 * branch inside the shared user-token handler — a service token is verified by a SEPARATE verifier on a
 * SEPARATE route, so a bug in the user path can never let a user token reach the phrase-skipping erasure,
 * and vice versa.
 *
 * On success it attaches the verified `ServicePrincipal` (whose bound `ownerId` is the ONLY thing
 * that scopes the erasure) to the request; on any failure {@link ServiceErasureAuthService.verify} throws
 * an opaque `401`.
 */
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';

import { extractBearer } from './bearer.js';
import { ServiceErasureAuthService } from './service-erasure-auth.service.js';
import type { ServiceAuthenticatedRequest } from './service-principal.js';

@Injectable()
export class ServiceErasureGuard implements CanActivate {
    public constructor(private readonly auth: ServiceErasureAuthService) {}

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

        // Verification throws an opaque 401 on any failure (bad signature, wrong alg/iss/aud, expired,
        // over-window, missing claims, or no key configured) — the reason never leaks.
        request.servicePrincipal = await this.auth.verify(bearer);

        return true;
    }
}
