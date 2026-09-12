import { ForbiddenException, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { SCOPES_METADATA_KEY } from '../decorators/requireScopes.decorator.js';
import type { AuthorizerContext } from '../decorators/currentUser.decorator.js';

/**
 * Guard pattern: the declarative authorization seam for scope-gated routes. Reads the scopes a
 * handler/controller requires from `Reflector` metadata (set via `@RequireScopes(...)`) and checks them
 * against the authenticated caller's `AuthorizerContext` (`req.user`, populated by `AuthMiddleware` —
 * AUTHENTICATION stays in the middleware; this guard owns AUTHORIZATION only, and nothing else).
 *
 * This replaces the imperative `assertAdmin(ctx)` call that admin.service used to repeat as the first
 * line of every method — a check that was easy to forget on a new method and invisible from the
 * controller. Applying `@UseGuards(ScopesGuard)` + `@RequireScopes(...)` on a controller/handler makes
 * the requirement declarative and impossible to omit by construction: Nest runs the guard for every
 * route the decorator touches, before the handler body executes.
 *
 * A scope is satisfied if it appears in EITHER the caller's `scopes` OR `permissions` (mirrors the
 * semantics of the old `assertAdmin`, generalized from one scope to a list — every required scope must
 * be satisfied). A route with no `@RequireScopes` metadata is not gated by this guard (no requirement
 * declared → nothing to enforce); a route WITH required scopes fails closed — a missing `req.user`
 * (should be unreachable in production behind `AuthMiddleware`, but the guard must never assume it) is
 * treated as "no grants", not as "allow".
 */
@Injectable()
export class ScopesGuard implements CanActivate {
    constructor(private readonly reflector: Reflector) {}

    canActivate(context: ExecutionContext): boolean {
        const requiredScopes =
            this.reflector.getAllAndOverride<string[] | undefined>(SCOPES_METADATA_KEY, [
                context.getHandler(),
                context.getClass(),
            ]) ?? [];

        if (requiredScopes.length === 0) {
            return true;
        }

        const request = context.switchToHttp().getRequest<{ user?: AuthorizerContext }>();
        const user = request.user;

        if (!user) {
            // Fail-closed: no authenticated principal means no grants, never an implicit pass.
            throw new ForbiddenException('Admin user scope required');
        }

        const granted = new Set([...user.scopes, ...user.permissions]);
        const satisfied = requiredScopes.every((scope) => granted.has(scope));

        if (!satisfied) {
            throw new ForbiddenException('Admin user scope required');
        }

        return true;
    }
}
