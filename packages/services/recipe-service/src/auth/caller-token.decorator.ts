/**
 * The `@CallerBearerToken()` route-parameter decorator — the ONE place a controller obtains the caller's
 * forwardable credential (issue #120).
 *
 * Companion to `@OwnerId()` / `@CurrentPrincipal()` (`current-principal.decorator.ts`), and deliberately
 * different in one respect: those fail CLOSED with `401` when the verified principal is missing, because an
 * absent identity means the route escaped auth. This one returns `undefined` instead, because an absent
 * *bearer* is a legitimate state — the non-production dev-auth bypass (`RECIPE_DEV_AUTH_USER_ID`)
 * authenticates a principal with no token at all. Callers must therefore treat `undefined` as "no credential
 * to forward" and degrade (the food-catalog gateway reports `catalogAvailability: 'unavailable'`), never as
 * an auth failure and never as licence to substitute a different credential.
 *
 * Authorization on the ROUTE is unaffected: every route still carries `@OwnerId()`, whose fail-closed `401`
 * is the authentication assertion. This decorator only supplies the credential the ingredients vertical
 * forwards onward.
 */
import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import { CallerToken } from './caller-token.js';
import type { AuthenticatedRequest } from './principal.js';

/**
 * Wrap the request's bearer credential, or `undefined` when it carries none.
 *
 * @param _data - Unused decorator data.
 * @param ctx - The Nest execution context for the current request.
 * @returns The caller's opaque forwardable token, or `undefined`.
 */
export function resolveCallerBearerToken(_data: unknown, ctx: ExecutionContext): CallerToken | undefined {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();

    return CallerToken.fromAuthorizationHeader(request.headers['authorization']);
}

/**
 * Route-param decorator injecting the caller's opaque {@link CallerToken}, or `undefined` when the request
 * carries no bearer. See the module doc for why this does NOT fail closed.
 */
export const CallerBearerToken = createParamDecorator(resolveCallerBearerToken);
