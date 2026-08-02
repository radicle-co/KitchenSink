/**
 * `FoodAuthGuard` (ARCH-012, T-033) — the single named auth component fronting EVERY `/api/v1/foods/*`
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
 * - **Auth-layer DoS protection (FR-052).** An {@link AuthLoadShedder} bounds concurrent signature
 *   verifications and applies a per-source `401`-rate cap: a flood of well-formed-but-invalid tokens is
 *   shed with `503` BEFORE the CPU-bound verification, so the verifier cannot be saturated and SC-011
 *   (≤10ms p95) holds under flood, not only on the happy path.
 *
 * @implements FR-035 FR-036 FR-037 FR-038 FR-040 FR-042 FR-047 FR-052 FR-053
 */
import {
    Injectable,
    Optional,
    ServiceUnavailableException,
    UnauthorizedException,
    type NestMiddleware,
} from '@nestjs/common';
import { resolveAzpEnforcement, verifyClerkToken } from '@kitchensink/clerk-verify';
import type { NextFunction, Response } from 'express';

import { AuthLoadShedder } from './auth-load-shedder.js';
import type { AuthenticatedRequest } from './authenticated-principal.js';

/**
 * Process-wide auth load-shedder (FR-052). Module-level so every request shares one concurrency pool +
 * per-source failure window; configured once from env. Overridable per-instance for tests.
 */
const defaultShedder = new AuthLoadShedder({
    maxConcurrent: numberFromEnv('FOOD_AUTH_MAX_CONCURRENT_VERIFICATIONS'),
    shedThreshold: numberFromEnv('FOOD_AUTH_SHED_THRESHOLD'),
    shedWindowMs: numberFromEnv('FOOD_AUTH_SHED_WINDOW_MS'),
});

/** Read a positive integer env var, or `undefined` (let the shedder use its default). Pure. */
function numberFromEnv(key: string): number | undefined {
    const raw = process.env[key];
    const value = raw === undefined ? Number.NaN : Number(raw);

    return Number.isFinite(value) && value > 0 ? value : undefined;
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
    /** Resolved `azp` enforcement — exact-match list OR a per-PR preview pattern. Read once. */
    private readonly azp: ReturnType<typeof resolveAzpEnforcement>;
    /** Auth-layer DoS shedder (FR-052) — shared process-wide unless overridden for tests. */
    private readonly shedder: AuthLoadShedder;

    /**
     * @param shedder - Optional load-shedder override (defaults to the process-wide singleton). Marked
     *   `@Optional()` so Nest's DI does not try to resolve `AuthLoadShedder` as a provider token — it
     *   injects `undefined`, and the default ({@link defaultShedder}) applies. Tests pass one explicitly.
     */
    public constructor(@Optional() shedder: AuthLoadShedder = defaultShedder) {
        this.jwtKey = process.env['CLERK_JWT_KEY'];
        this.azp = resolveAzpEnforcement({
            authorizedPartiesRaw: process.env['CLERK_AUTHORIZED_PARTIES'],
            previewBaseDomain: process.env['CLERK_AZP_PATTERN'],
            // Cutover selector (ADR-0001): `transition` also admits the path-routed apex origin while the
            // shared sandbox migrates to per-PR subdomains; unset/anything-else stays strict (subdomain-only).
            previewMode: process.env['CLERK_AZP_PREVIEW_MODE'],
            // Admit azp-less native-app tokens (`client_type: 'native'`) in pattern mode — the mobile app
            // mints them via the `commise-native` Clerk JWT template (no browser origin ⇒ no `azp`). Gated
            // by env so only stages fronting a native client enable it; the security signal lives once in
            // clerk-verify's `isNativeClientToken`, never on azp-absence alone.
            admitNativeClient: process.env['CLERK_ADMIT_NATIVE_CLIENT'] === 'true',
        });
        this.shedder = shedder;
    }

    /**
     * Verify the Bearer token and attach the principal, or fail closed with `401` — shedding with `503`
     * under an auth-layer DoS flood (FR-052) BEFORE the CPU-bound verification.
     *
     * @param req - The incoming request (augmented with `user` on success).
     * @param _res - Unused.
     * @param next - Called exactly once, only after a successful verification.
     * @throws {ServiceUnavailableException} (→ 503) when the source is over the `401`-rate cap or the
     *   verification pool is saturated (load-shed, FR-052) — no verification is performed.
     * @throws {UnauthorizedException} (→ 401) when no/invalid/expired/wrong-`azp` token is presented.
     * @sideEffect Mutates `req.user` on success; records auth failures into the shedder window.
     */
    public async use(req: AuthenticatedRequest, _res: Response, next: NextFunction): Promise<void> {
        const sourceKey = this.shedder.sourceKey({
            xForwardedFor: this.headerValue(req.headers['x-forwarded-for']),
            ip: req.ip,
        });

        // Cheap pre-check: a source already over the 401-rate cap is shed WITHOUT a signature check, so
        // a flood cannot consume verifier CPU (FR-052/SC-011).
        if (this.shedder.shouldShed(sourceKey)) {
            throw new ServiceUnavailableException('Auth temporarily unavailable');
        }

        const bearer = extractBearer(req.headers['authorization']);

        if (!bearer) {
            throw new UnauthorizedException('Valid Clerk session or M2M token required');
        }

        // Bound concurrent verifications: if the pool is saturated, shed rather than pile up behind CPU.
        if (!this.shedder.tryAcquire()) {
            throw new ServiceUnavailableException('Auth temporarily unavailable');
        }

        let claims;

        try {
            claims = await verifyClerkToken(bearer, { jwtKey: this.jwtKey, ...this.azp });
        } catch {
            // Any failure (bad signature, expiry, wrong azp, missing key) → opaque 401 (never the reason).
            // Feed the per-source 401-rate cap so a sustained flood from this source starts shedding.
            this.shedder.recordFailure(sourceKey);
            throw new UnauthorizedException('Valid Clerk session or M2M token required');
        } finally {
            this.shedder.release();
        }

        // Identity from the verified token ONLY — a forged x-debug-sub / x-authorizer-context is ignored.
        // `userId` (the app-user ULID from `external_id`) is THE user requester key (CR-002/U1/R5); it is
        // surfaced here but NOT enforced-present in the guard — reads work without it, and only the enqueue
        // paths defer on its absence (see FoodsController.requireRequesterId). A `svc_*` principal has none.
        req.user = {
            sub: claims.sub,
            userId: claims.userId,
            azp: claims.azp,
            scopes: claims.scopes,
            permissions: claims.permissions,
        };

        next();
    }

    /** Normalize an Express header value (string | string[] | undefined) to a single string. Pure. */
    private headerValue(value: string | string[] | undefined): string | undefined {
        return Array.isArray(value) ? value[0] : value;
    }
}
