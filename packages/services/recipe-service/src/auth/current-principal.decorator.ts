/**
 * ARCH-BE-5 — the `@OwnerId()` / `@CurrentPrincipal()` route-parameter decorators.
 *
 * ONE authoritative place for "read the verified {@link Principal} off the request, or fail closed with
 * `401`". Before this, the same throw-on-missing-principal helper (`ownerIdOf` / `principalOf`) was
 * copy-pasted into every controller; a decorator collapses that knowledge into a single tested unit and
 * lets controllers declare exactly what they need:
 *
 *   - `@OwnerId() ownerId: string` — the app-user ULID (`principal.userId`), THE owner key.
 *   - `@CurrentPrincipal() principal: Principal` — the whole verified principal (for the C-004
 *     premium/permissions gate, where the owner key alone is insufficient).
 *
 * The absent-principal case is a defensive `401`: the fail-closed {@link AuthMiddleware} guarantees a
 * principal on every non-public route, so reaching a decorator with none means the route escaped auth —
 * we reject rather than fabricate an identity.
 *
 * The resolver factories are exported so they can be unit-tested directly against a mock
 * {@link ExecutionContext} (the wrapped decorator hides them from the test).
 */
import { createParamDecorator, UnauthorizedException, type ExecutionContext } from '@nestjs/common';

import type { AuthenticatedRequest, Principal } from './principal.js';

/**
 * Read the verified {@link Principal} off the request, or reject with `401` when absent.
 *
 * @param ctx - The Nest execution context for the current request.
 * @returns The verified principal set by {@link AuthMiddleware}.
 * @throws {UnauthorizedException} (→ 401) when no principal is present (route escaped auth).
 */
export function resolveCurrentPrincipal(_data: unknown, ctx: ExecutionContext): Principal {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();

    if (!request.principal) {
        throw new UnauthorizedException('Missing authenticated principal');
    }

    return request.principal;
}

/**
 * Read the verified owner key (`principal.userId`, the app-user ULID) off the request, or reject `401`.
 *
 * @param ctx - The Nest execution context for the current request.
 * @returns The owner key.
 * @throws {UnauthorizedException} (→ 401) when no principal is present.
 */
export function resolveOwnerId(_data: unknown, ctx: ExecutionContext): string {
    return resolveCurrentPrincipal(_data, ctx).userId;
}

/** Route-param decorator injecting the full verified {@link Principal} (fail-closed `401`). */
export const CurrentPrincipal = createParamDecorator(resolveCurrentPrincipal);

/** Route-param decorator injecting the verified owner key `principal.userId` (fail-closed `401`). */
export const OwnerId = createParamDecorator(resolveOwnerId);
