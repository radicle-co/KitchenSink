/**
 * `FoodAuthGuard` (ARCH-012, T-033) — the single named auth component fronting EVERY `/v1/foods/*`
 * route. Implemented as an in-process NestJS middleware (not an API-Gateway Lambda authorizer): the
 * service sits behind a public ALB, which has no Lambda-authorizer hook, and the Clerk token verifies
 * networklessly in ~1ms in-process (plan §2A.1). Mirrors the identity service's `AuthMiddleware`.
 *
 * Contract (FR-035–FR-038, FR-040, FR-042, FR-053):
 * - **Bearer-only.** No `Authorization: Bearer <token>` → `401`. There is deliberately NO trusted-header
 *   identity path: `x-authorizer-context` / `x-debug-sub` are forgeable behind a public ALB and are
 *   ignored entirely (the old debug-sub path is removed).
 * - **Networkless verification** via `@kitchensink/clerk-verify` (`verifyToken` + `azp` allowlist) using
 *   the public `CLERK_JWT_KEY` — no IdP round trip, no secret key. A missing key fails closed (`401`).
 * - **Identity from the verified token only.** `sub`/`azp`/`scopes`/`permissions` come from the validated
 *   JWT and are attached to `req.user`; nothing else is trusted.
 * - **Fail-closed.** ANY failure throws `401` BEFORE `next()` — so no DB row, enqueue, or source call
 *   happens for an unauthenticated request (SC-010). M2M/service tokens (FR-047) are accepted the same
 *   way: their `azp` must be in the allowlist, enforced by the verifier.
 *
 * @implements FR-035 FR-036 FR-037 FR-038 FR-040 FR-042 FR-047 FR-053
 */
import { Injectable, UnauthorizedException, type NestMiddleware } from '@nestjs/common';
import { verifyClerkToken } from '@kitchensink/clerk-verify';
import type { NextFunction, Response } from 'express';

import type { AuthenticatedRequest } from './authenticated-principal.js';

/** Parse a comma-separated allowlist (the `azp` parties) into a trimmed, non-empty list. Pure. */
function parseCommaList(value: string | undefined): string[] {
    return (value ?? '')
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
}

/** Extract the bearer token from an `Authorization` header, else `undefined`. Pure. */
function extractBearer(authorization: string | undefined): string | undefined {
    if (typeof authorization !== 'string') {
        return undefined;
    }

    const match = authorization.match(/^Bearer\s+(.+)$/i);

    return match ? match[1]!.trim() : undefined;
}

@Injectable()
export class FoodAuthGuard implements NestMiddleware {
    /** Public PEM verification key (non-secret); absence fails closed. Read once at construction. */
    private readonly jwtKey: string | undefined;
    /** The `azp` allowlist (non-secret). Read once at construction. */
    private readonly authorizedParties: string[];

    public constructor() {
        this.jwtKey = process.env['CLERK_JWT_KEY'];
        this.authorizedParties = parseCommaList(process.env['CLERK_AUTHORIZED_PARTIES']);
    }

    /**
     * Verify the Bearer token and attach the principal, or fail closed with `401`.
     *
     * @param req - The incoming request (augmented with `user` on success).
     * @param _res - Unused.
     * @param next - Called exactly once, only after a successful verification.
     * @throws {UnauthorizedException} (→ 401) when no/invalid/expired/wrong-`azp` token is presented.
     * @sideEffect Mutates `req.user` on success.
     */
    public async use(req: AuthenticatedRequest, _res: Response, next: NextFunction): Promise<void> {
        const bearer = extractBearer(req.headers['authorization']);

        if (!bearer) {
            throw new UnauthorizedException('Valid Clerk session or M2M token required');
        }

        let claims;

        try {
            claims = await verifyClerkToken(bearer, {
                jwtKey: this.jwtKey,
                authorizedParties: this.authorizedParties,
            });
        } catch {
            // Any failure (bad signature, expiry, wrong azp, missing key) → opaque 401 (never the reason).
            throw new UnauthorizedException('Valid Clerk session or M2M token required');
        }

        // Identity from the verified token ONLY — a forged x-debug-sub / x-authorizer-context is ignored.
        req.user = {
            sub: claims.sub,
            azp: claims.azp,
            scopes: claims.scopes,
            permissions: claims.permissions,
        };

        next();
    }
}
