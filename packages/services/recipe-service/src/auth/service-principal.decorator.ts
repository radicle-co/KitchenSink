/**
 * The `@ServiceErasurePrincipal()` route-parameter decorator (CR-002 / U4a).
 *
 * The service-principal analogue of `@CurrentPrincipal()`: reads the verified {@link ServicePrincipal} off
 * the request (set by `ServiceErasureGuard`), or fails closed
 * with `401` when absent. An absent principal means the route was reached without the guard verifying a
 * token — a fail-closed rejection, never a fabricated principal. The resolver is exported so it can be
 * unit-tested directly against a mock {@link ExecutionContext}.
 */
import { createParamDecorator, UnauthorizedException, type ExecutionContext } from '@nestjs/common';

import type { ServiceAuthenticatedRequest, ServicePrincipal } from './service-principal.js';

/**
 * Read the verified {@link ServicePrincipal} off the request, or reject with `401` when absent.
 *
 * @param _data - Unused decorator data.
 * @param ctx - The Nest execution context for the current request.
 * @returns The verified service principal set by `ServiceErasureGuard`.
 * @throws {UnauthorizedException} (→ 401) when no service principal is present (route escaped the guard).
 */
export function resolveServicePrincipal(_data: unknown, ctx: ExecutionContext): ServicePrincipal {
    const request = ctx.switchToHttp().getRequest<ServiceAuthenticatedRequest>();

    if (!request.servicePrincipal) {
        throw new UnauthorizedException('Missing verified service principal');
    }

    return request.servicePrincipal;
}

/** Route-param decorator injecting the verified {@link ServicePrincipal} (fail-closed `401`). */
export const ServiceErasurePrincipal = createParamDecorator(resolveServicePrincipal);
