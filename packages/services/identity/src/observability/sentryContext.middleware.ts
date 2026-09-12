import { Injectable, type NestMiddleware } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import type { NextFunction, Request, Response } from 'express';

import type { AuthorizerContext } from '../types/index.js';

/**
 * Attach per-request context to the Sentry isolation scope so it appears on both errors and logs
 * (R15 / KTD4). Runs after `AuthMiddleware`, so `req.user` is populated on authenticated routes; the
 * unauthenticated `/health` path simply has no user and `setUser` is skipped.
 */
@Injectable()
export class SentryContextMiddleware implements NestMiddleware {
    public use(req: Request & { user?: AuthorizerContext }, _res: Response, next: NextFunction): void {
        const requestId =
            (req.headers['x-request-id'] as string | undefined) ??
            (req.headers['x-amzn-trace-id'] as string | undefined);

        Sentry.getIsolationScope().setAttributes({
            serviceName: 'identity-service',
            request_id: requestId,
            instance: process.env['HOSTNAME'],
        });

        if (req.user?.userId) {
            Sentry.setUser({ id: req.user.userId });
        }

        next();
    }
}
