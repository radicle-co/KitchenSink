import { Injectable, UnauthorizedException, type NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';

import type { AuthorizerContext } from '../../types/index.js';
import { ClerkAuthService } from '../clerk-auth.service.js';
import { UsersService } from '../../users/users.service.js';

const PUBLIC_PATHS = new Set(['/health']);

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

        const bearer = extractBearerToken(req.headers['authorization']);

        if (bearer) {
            // Primary path: verify the Clerk session token and read-through resolve/create the user.
            // A present-but-invalid token is a hard 401 — we do not fall back to the legacy header.
            const claims = await this.clerkAuth.verify(bearer);
            req.user = await this.users.resolveOrCreateFromClaims(claims);
        } else {
            // Fallback: a base64 `x-authorizer-context` header from an upstream API Gateway
            // authorizer. No producer exists today; retained for a future edge gateway (KTD5).
            const header = req.headers['x-authorizer-context'];

            if (typeof header === 'string') {
                try {
                    const decoded = Buffer.from(header, 'base64').toString('utf-8');
                    const ctx = JSON.parse(decoded) as AuthorizerContext;

                    if (isAuthorizerContext(ctx)) {
                        req.user = {
                            ...ctx,
                            scopes: ctx.scopes,
                            permissions: ctx.permissions,
                        };
                    }
                } catch {
                    /* no-op — leave req.user undefined */
                }
            }
        }

        if (!req.user) {
            throw new UnauthorizedException('Missing authorizer context');
        }

        next();
    }
}

function isAuthorizerContext(value: unknown): value is AuthorizerContext {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const ctx = value as Partial<AuthorizerContext>;

    return (
        typeof ctx.userId === 'string' &&
        Array.isArray(ctx.scopes) &&
        Array.isArray(ctx.permissions) &&
        ctx.tokenType === 'user'
    );
}
