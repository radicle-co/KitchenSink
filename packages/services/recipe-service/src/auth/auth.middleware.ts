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
import { Inject, Injectable, Logger, UnauthorizedException, type NestMiddleware } from '@nestjs/common';
import { IDENTITY_SYNC_PENDING_CODE } from '@kitchensink/recipe-core';
import type { NextFunction, Response } from 'express';

import { ClerkAuthService } from './clerkAuth.service.js';
import { extractBearer } from './bearer.js';
import { CONTAINMENT_MODE } from './containmentMode.js';
import { TestPrincipalsDal } from './dal/testPrincipals.dal.js';
import type { AuthenticatedRequest, Principal } from './principal.js';
import type { TestPrincipalContainment } from '../common/containmentPolicy.js';

/** Routes served without authentication (liveness + readiness probes hit by the ALB / ECS, no token). */
const PUBLIC_PATHS = new Set(['/health', '/health/ready']);

/** Normalize a request path: strip the query string and any trailing slash, defaulting to `/`. Pure. */
function getPath(req: AuthenticatedRequest): string {
    const raw = req.originalUrl ?? req.path ?? '/';

    return raw.split('?')[0]!.replace(/\/+$/, '') || '/';
}

/**
 * The ONLY `NODE_ENV` values that may enable the dev bypass: a developer's machine and the test tiers.
 *
 * ⛔ An ALLOWLIST, not `!== 'production'`. That gate refuses exactly one value and admits every other, and
 * `RecipeServiceStack` ships `NODE_ENV: stage === 'prod' ? 'production' : 'staging'` — so on sandbox and on
 * every `pr-{N}`, all internet-facing behind the shared ALB, the sole thing between the public internet and
 * arbitrary-owner impersonation would be the ABSENCE of `RECIPE_DEV_AUTH_USER_ID`. A negative gate has to
 * predict every environment name that will ever exist; a positive one does not, so a stage added later
 * cannot opt itself in by being spelled something new.
 *
 * ⚠️ Identity and food hardcode `NODE_ENV: 'production'` and do not have this gap. Recipe keys its config on
 * the value, which is why it is the one service where the bypass could reach a deployed stage.
 */
const DEV_BYPASS_ENVIRONMENTS = new Set(['development', 'test']);

/**
 * Resolve the local-only dev-bypass Principal, or `undefined`. Reads env at call time so it tracks the
 * current value rather than a boot-time snapshot, and answers `undefined` for every environment outside
 * {@link DEV_BYPASS_ENVIRONMENTS} regardless of `RECIPE_DEV_AUTH_USER_ID`. Pure w.r.t. its inputs (only
 * reads env). The synthetic `sub` is deliberately distinct from `userId` so even the bypass never conflates
 * the owner key with a trace identifier.
 */
function resolveDevBypass(containment: TestPrincipalContainment): Principal | undefined {
    if (!DEV_BYPASS_ENVIRONMENTS.has(process.env['NODE_ENV'] ?? '')) {
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
        // The bypass has no signed claim to read, so it can never be a test principal.
        principalKind: 'real',
        containment,
    };
}

@Injectable()
export class AuthMiddleware implements NestMiddleware {
    private readonly logger = new Logger(AuthMiddleware.name);

    /**
     * The test principals THIS process has already written to the registry. The row is idempotent, so the set only
     * saves a round trip per request. Bounded by the number of Clerk users carrying the signed marker, which only a
     * Backend-API writer can set (ADR-0040).
     *
     * ⚠️ It is never invalidated, so it is sound only while nothing deletes the row of a principal that will act again
     * on a running process — otherwise the test reset door (which reads the ROW) answers `404` until a restart. That
     * holds today: the test purge keeps the row (`testResetSweepCoverage.test.ts`'s exemption), and the only other
     * delete, account erasure, reaches a pool slot only through a consumable erasure subject that `resetPool` never
     * resets and whose replacement is a new user with a new id. A change that lets a REUSED slot's row be deleted
     * owes this memo an invalidation.
     */
    private readonly registered = new Set<string>();

    public constructor(
        private readonly clerkAuth: ClerkAuthService,
        @Inject(CONTAINMENT_MODE) private readonly containment: TestPrincipalContainment,
        private readonly testPrincipals: TestPrincipalsDal,
    ) {}

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
        const devPrincipal = resolveDevBypass(this.containment);

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
            // ADR-0040: the kind comes from the SIGNED claim alone (containment is fail-closed on it); the stage's
            // mode rides along so every policy call site reads both off the request it already holds.
            principalKind: claims.testPrincipal ? 'test' : 'real',
            containment: this.containment,
        };

        if (claims.testPrincipal) {
            await this.registerOnce(claims.userId);
        }

        next();
    }

    /**
     * Write a signed test principal to the service registry once per process.
     *
     * ⛔ A failure is LOGGED, never thrown, and never memoized. Containment keys on the claim, so the request is still
     * correctly contained without the row; only the self-purge — which requires the registry to agree — is affected,
     * and the next request retries the write. Failing the request would make a registry outage an auth outage.
     *
     * @param userId - The verified app-user ULID of a signed test principal.
     * @sideEffect Inserts at most one `test_principals` row; logs on failure.
     */
    private async registerOnce(userId: string): Promise<void> {
        if (this.registered.has(userId)) {
            return;
        }

        try {
            await this.testPrincipals.register(userId);
            this.registered.add(userId);
        } catch (error) {
            this.logger.warn(
                `Could not register test principal ${userId}; its self-purge will 404 until a later request succeeds.`,
                error instanceof Error ? error.stack : String(error),
            );
        }
    }
}
