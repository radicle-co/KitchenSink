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

        // Bearer-only. There is deliberately NO `x-authorizer-context` header fallback: the service
        // is fronted by an internet-facing ALB with no upstream authorizer to produce or strip that
        // header, so trusting it would let any client forge an identity (and admin scopes). The
        // Clerk session token, verified here, is the sole authentication source.
        const bearer = extractBearerToken(req.headers['authorization']);

        if (!bearer) {
            throw new UnauthorizedException('Missing bearer token');
        }

        const claims = await this.clerkAuth.verify(bearer);
        req.user = await this.users.resolveOrCreateFromClaims(claims);

        next();
    }
}
