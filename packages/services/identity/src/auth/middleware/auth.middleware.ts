import { Injectable, UnauthorizedException, type NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import * as Sentry from '@sentry/nestjs';

import type { AuthorizerContext, UserId } from '../../types/index.js';
import { ClerkAuthService } from '../clerkAuth.service.js';
import { UsersService } from '../../users/users.service.js';
import { createServiceLogger } from '../../observability/sentryLogging.js';
import { scrubText } from '../../observability/sentryScrubbers.js';
import { traceAuth } from '../../observability/authTrace.js';

// `/health` (liveness) and `/health/ready` (readiness) are the only unauthenticated routes — the ALB
// and ECS probe them with no bearer token, so both must bypass auth (ARCH-PS-3).
const PUBLIC_PATHS = new Set(['/health', '/health/ready']);

const logger = createServiceLogger('AuthMiddleware');

function getPath(req: Request): string {
    return req.originalUrl?.split('?')[0]?.replace(/\/$/, '') || '/';
}

/**
 * Extract the bearer token from an `Authorization` header value, or `undefined` when absent/malformed.
 *
 * The credential group is `\S.*`, not `.+`: `.` matches a space, so `.+` and the preceding `\s+` overlap,
 * and for a header the pattern REJECTS the engine retries every split of the whitespace run between them —
 * quadratic in the header's length (CodeQL `js/polynomial-redos`; measured 270ms at 40KB on the old
 * pattern), on the credential path of every request. Requiring the credential to start with a non-space
 * leaves exactly one candidate split, so the parse is linear. It also makes `'Bearer    '` yield
 * `undefined` rather than `''` — the honest answer for "no credential".
 *
 * @param authorization - The raw `Authorization` header value, if any.
 * @returns The trimmed token, or `undefined`. Pure.
 */
function extractBearerToken(authorization: string | undefined): string | undefined {
    if (typeof authorization !== 'string') {
        return undefined;
    }

    const match = authorization.match(/^Bearer\s+(\S.*)$/i);

    return match ? match[1]!.trim() : undefined;
}

/**
 * Resolve the non-production dev-bypass `AuthorizerContext`, or `undefined`. Reads env at call time so
 * it is disabled the instant `NODE_ENV` is `production`, regardless of `IDENTITY_DEV_AUTH_USER_ID`. This
 * mirrors the recipe-service dev bypass (`RECIPE_DEV_AUTH_USER_ID`): it lets in-process e2e tests
 * exercise authenticated routes without minting a real Clerk session token AND without the read-through
 * DB provisioning, by injecting a fixed synthetic principal. The synthetic `clerkUserId` is deliberately
 * distinct from `userId` so the bypass never conflates the app-user ULID with a Clerk trace identifier.
 *
 * @returns The synthetic dev principal when enabled outside production, else `undefined`.
 * @sideEffect Reads `process.env` (`NODE_ENV`, `IDENTITY_DEV_AUTH_USER_ID`).
 */
function resolveDevBypass(): AuthorizerContext | undefined {
    if (process.env['NODE_ENV'] === 'production') {
        return undefined;
    }

    const devUserId = process.env['IDENTITY_DEV_AUTH_USER_ID'];

    if (!devUserId) {
        return undefined;
    }

    return {
        userId: devUserId as UserId,
        email: 'dev-bypass@example.test',
        clerkUserId: `dev-bypass:${devUserId}`,
        scopes: [],
        permissions: [],
        tokenType: 'user',
    };
}

@Injectable()
export class AuthMiddleware implements NestMiddleware {
    constructor(
        private readonly clerkAuth: ClerkAuthService,
        private readonly users: UsersService,
    ) {}

    public async use(req: Request & { user?: AuthorizerContext }, _res: Response, next: NextFunction): Promise<void> {
        const path = getPath(req);

        if (PUBLIC_PATHS.has(path) || PUBLIC_PATHS.has(req.path)) {
            next();

            return;
        }

        // Local/e2e-only shortcut; hard-disabled in production by resolveDevBypass(). When set, it
        // authenticates the request as a fixed synthetic principal with NO Clerk verify and NO DB
        // read-through provisioning — the intended way to drive authenticated routes in in-process
        // e2e without minting real session tokens (mirrors recipe-service's RECIPE_DEV_AUTH_USER_ID).
        const devUser = resolveDevBypass();

        if (devUser) {
            req.user = devUser;
            next();

            return;
        }

        // Bearer-only. There is deliberately NO `x-authorizer-context` header fallback: the service
        // is fronted by an internet-facing ALB with no upstream authorizer to produce or strip that
        // header, so trusting it would let any client forge an identity (and admin scopes). The
        // Clerk session token, verified here, is the sole authentication source.
        const bearer = extractBearerToken(req.headers['authorization']);

        if (!bearer) {
            throw new UnauthorizedException('Missing bearer token');
        }

        const claims = await this.clerkAuth.verify(bearer);
        traceAuth('token.verified', { sub: claims.sub, path });

        try {
            traceAuth('provision.start', { sub: claims.sub });
            req.user = await this.users.resolveOrCreateFromClaims(claims);
            traceAuth('provision.done', { sub: claims.sub, userId: req.user.userId });
        } catch (err) {
            // A Postgres 23505 message embeds the offending value (the user's email for
            // users_email_unique); the log scrubber denylists keys + bearer strings but does NOT run
            // the email regex over arbitrary string attributes, so scrub the message here before it
            // becomes a log/trace attribute (only `clerk.sub` is a safe identifier to emit).
            const scrubbedError = scrubText(err instanceof Error ? err.message : String(err));
            traceAuth('provision.failed', { sub: claims.sub, error: scrubbedError });
            // A3 — read-through provisioning runs on EVERY authenticated request, so a failure here
            // 500s the request and hard-locks the user out of every route. Surface it as a loud,
            // distinct, filterable Sentry signal carrying the Clerk sub (not a bare 500 that blends
            // in, nor an `Unauthorized` that beforeSend drops) so a silent provisioning failure
            // pages instead of hiding. Re-throw so the request still fails (5xx).
            logger.error('auth: read-through provisioning failed', {
                clerkSub: claims.sub,
                outcome: 'failed',
                error: scrubbedError,
            });
            Sentry.captureException(err, {
                tags: { 'auth.provisioning': 'failed' },
                contexts: { auth: { clerkSub: claims.sub, outcome: 'failed' } },
            });

            throw err;
        }

        next();
    }
}
