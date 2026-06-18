import { Injectable, UnauthorizedException, type NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import * as Sentry from '@sentry/nestjs';

import type { AuthorizerContext } from '../../types/index.js';
import { ClerkAuthService } from '../clerk-auth.service.js';
import { UsersService } from '../../users/users.service.js';
import { createServiceLogger } from '../../observability/sentry-logging.js';
import { scrubText } from '../../observability/sentry-scrubbers.js';
import { traceAuth } from '../../observability/auth-trace.js';

const PUBLIC_PATHS = new Set(['/health']);

const logger = createServiceLogger('AuthMiddleware');

function getPath(req: Request): string {
    return req.originalUrl?.split('?')[0]?.replace(/\/$/, '') || '/';
}

function extractBearerToken(authorization: string | undefined): string | undefined {
    if (typeof authorization !== 'string') {
        return undefined;
    }

    const match = authorization.match(/^Bearer\s+(.+)$/i);

    return match ? match[1]!.trim() : undefined;
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
