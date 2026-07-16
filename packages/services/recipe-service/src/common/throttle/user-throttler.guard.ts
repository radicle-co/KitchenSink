/**
 * Per-authenticated-user rate-limit tracker for the recipe service.
 *
 * WHY THIS EXISTS. The stock `@nestjs/throttler` `ThrottlerGuard` keys every counter on `req.ip`. This
 * service runs on ECS/Fargate behind the shared, internet-facing ALB and does NOT enable Express
 * `trust proxy`, so `req.ip` is the ALB node's address for EVERY caller. Keyed on that, the "per-user"
 * limits the config comments describe would in fact be ONE global counter shared by all users — at any
 * real concurrency the Home widget's reads would 429 across unrelated users (a user exhausting a limit
 * would throttle everyone). The tracker is the ONLY thing that makes the limit per-user; the group/limit
 * assignments (`@WriteRateLimit()` etc.) are correct and untouched.
 *
 * THE KEY. Every non-public route is auth-gated by {@link AuthMiddleware}, which runs BEFORE guards and
 * attaches the verified {@link Principal}. So on every rate-limited route `req.principal.userId` (the
 * app-user ULID — the same owner key ownership compares against) is present, and it is the tracker. The
 * key is namespaced (`user:` / `ip:`) so a user ULID and an IP literal can never collide into one bucket.
 *
 * THE FALLBACK, AND WHY IT IS `req.ip` (the ALB), NOT X-Forwarded-For. The fallback is reached only for a
 * request with no principal. Today that is only the health probes, which are `@SkipThrottle()`, so the
 * fallback is effectively unreachable in production. It exists as defense-in-depth for any future
 * unauthenticated, non-health route. We deliberately do NOT enable `trust proxy` / read `X-Forwarded-For`
 * for it: behind a public ALB a client can forge `X-Forwarded-For`, so trusting it would let an
 * unauthenticated caller rotate their tracker key at will and evade the limit entirely — strictly worse
 * than the alternative. Falling back to `req.ip` (the ALB) instead makes all unauthenticated callers
 * share ONE bucket: that fails toward MORE throttling (over-restrictive), never less, which is the safe
 * direction for an anonymous surface. Authenticated routes never touch this path, so the ALB-IP collapse
 * is moot for them.
 */
import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

import type { AuthenticatedRequest } from '../../auth/principal.js';

@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
    /**
     * Resolve the rate-limit tracker for a request: the authenticated app-user ULID when present, else a
     * namespaced client-IP fallback. `@nestjs/throttler` folds this tracker together with the route's
     * class+handler+throttler-name to form the storage key, so distinct users (and distinct routes) keep
     * independent counters. Pure w.r.t. the request (reads `principal`/`ip`, mutates nothing).
     *
     * @param req - The Express request (augmented with `principal` by {@link AuthMiddleware} on success).
     * @returns The tracker string: `user:<ULID>` for an authenticated caller, else `ip:<addr>`.
     */
    protected override async getTracker(req: Record<string, unknown>): Promise<string> {
        const request = req as unknown as AuthenticatedRequest;
        const userId = request.principal?.userId;

        if (typeof userId === 'string' && userId.length > 0) {
            return `user:${userId}`;
        }

        // Unauthenticated fallback — the ALB address, deliberately NOT a forgeable X-Forwarded-For (see the
        // class docstring). `??` covers the (test/edge) case where `ip` is absent.
        return `ip:${request.ip ?? 'unknown'}`;
    }
}
