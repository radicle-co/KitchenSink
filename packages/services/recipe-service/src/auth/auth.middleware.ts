/**
 * T019 — the recipe service's Clerk session-token `AuthMiddleware`.
 *
 * Fronts every non-public route on ECS/Fargate behind the public ALB (in-process, not an API-Gateway
 * authorizer — the shared ALB has no authorizer hook, and the Clerk token verifies networklessly in
 * ~1ms). Mirrors the identity service's `AuthMiddleware` in topology, but with **NO** read-through
 * user creation, no `resolveOrCreateFromClaims`, and no local `users` table.
 *
 * Contract (REQ-IF-007, FR-038):
 * - **Bearer-only.** No `Authorization: Bearer <token>` → `401`. There is deliberately NO trusted-header
 *   identity path (`x-authorizer-context` / `x-user-id` are forgeable behind a public ALB — ignored).
 * - **Owner identity = the app-user ULID.** The canonical Principal's `userId` is read from the verified
 *   token's `external_id` claim (surfaced by `@kitchensink/clerk-verify` as `userId`). `userId` is THE
 *   owner key; ownership everywhere compares `owner_id == principal.userId`. The Clerk `sub` is retained
 *   for trace/audit ONLY and is **never** an owner key.
 * - **FAIL-CLOSED enforcement point.** The shared verifier leaves `userId` **undefined** when
 *   `external_id` is absent and does NOT itself fail — THIS middleware is the enforcement point: an
 *   absent/undefined `userId` MUST reject with `401` and MUST NOT fall back to `sub`.
 * - **Dev bypass (non-production only).** In local dev, setting `RECIPE_DEV_AUTH_USER_ID` injects a
 *   fixed dev Principal (no Clerk token needed). It is IGNORED whenever `NODE_ENV === 'production'`, so
 *   it can never weaken a deployed stage.
 *
 * @implements REQ-IF-007 FR-038
 */
import { Injectable, UnauthorizedException, type NestMiddleware } from '@nestjs/common';
import { IDENTITY_SYNC_PENDING_CODE } from '@kitchensink/recipe-core';
import type { NextFunction, Response } from 'express';

import { ClerkAuthService } from './clerk-auth.service.js';
import { extractBearer } from './bearer.js';
import type { AuthenticatedRequest, Principal } from './principal.js';

/** Routes served without authentication (liveness + readiness probes hit by the ALB / ECS, no token). */
const PUBLIC_PATHS = new Set(['/health', '/health/ready']);

/** Normalize a request path: strip the query string and any trailing slash, defaulting to `/`. Pure. */
function getPath(req: AuthenticatedRequest): string {
    const raw = req.originalUrl ?? req.path ?? '/';

    return raw.split('?')[0]!.replace(/\/+$/, '') || '/';
}

/**
 * Resolve the non-production dev-bypass Principal, or `undefined`. Reads env at call time so it is
 * disabled the instant `NODE_ENV` is `production`, regardless of `RECIPE_DEV_AUTH_USER_ID`. Pure
 * w.r.t. its inputs (only reads env). The synthetic `sub` is deliberately distinct from `userId` so
 * even the bypass never conflates the owner key with a trace identifier.
 */
function resolveDevBypass(): Principal | undefined {
    if (process.env['NODE_ENV'] === 'production') {
        return undefined;
    }

    const devUserId = process.env['RECIPE_DEV_AUTH_USER_ID'];

    if (!devUserId) {
        return undefined;
    }

    return {
        userId: devUserId,
        sub: `dev-bypass:${devUserId}`,
        scopes: [],
        permissions: [],
    };
}

@Injectable()
export class AuthMiddleware implements NestMiddleware {
    public constructor(private readonly clerkAuth: ClerkAuthService) {}

    /**
     * Authenticate the request and attach the canonical Principal, or fail closed with `401`.
     *
     * @param req - The incoming request (augmented with `principal` on success).
     * @param _res - Unused.
     * @param next - Called exactly once, only after successful authentication (or on a public path).
     * @throws {UnauthorizedException} (→ 401) on a missing/invalid/expired token, or when the verified
     *   token carries no `external_id` (owner ULID) claim.
     * @sideEffect Mutates `req.principal` on success.
     */
    public async use(req: AuthenticatedRequest, _res: Response, next: NextFunction): Promise<void> {
        const path = getPath(req);

        if (PUBLIC_PATHS.has(path)) {
            next();

            return;
        }

        // Local-dev-only shortcut; hard-disabled in production by resolveDevBypass().
        const devPrincipal = resolveDevBypass();

        if (devPrincipal) {
            req.principal = devPrincipal;
            next();

            return;
        }

        const bearer = extractBearer(req.headers['authorization']);

        if (!bearer) {
            throw new UnauthorizedException('Missing bearer token');
        }

        // Any verification failure (bad signature, expiry, wrong azp, missing key) → opaque 401.
        const claims = await this.clerkAuth.verify(bearer);

        // FAIL-CLOSED enforcement point (REQ-IF-007): the owner key is the app-user ULID from
        // `external_id`. When it is absent the shared verifier leaves `userId` undefined; we reject
        // rather than fall back to the Clerk `sub`, which is trace/audit only and never an owner key.
        if (!claims.userId) {
            // Distinguishable from a hard auth failure: the token verified but carries no `external_id`
            // (the app-user ULID) yet — the first-token sync race (identity has not backfilled the ULID
            // to Clerk). The client keys on this `code` to refresh the token and retry with backoff. We
            // still NEVER fall back to `sub` as an owner key — an absent ULID is a rejection, not a guess.
            throw new UnauthorizedException({
                code: IDENTITY_SYNC_PENDING_CODE,
                message: 'App-user identity (external_id) not yet available; retry with a refreshed token.',
            });
        }

        req.principal = {
            userId: claims.userId, // owner key — NEVER claims.sub
            sub: claims.sub, // trace/audit only
            azp: claims.azp,
            email: claims.email,
            firstName: claims.firstName,
            lastName: claims.lastName,
            picture: claims.picture,
            scopes: claims.scopes,
            permissions: claims.permissions,
        };

        next();
    }
}
