import { Module } from '@nestjs/common';

import { AuthMiddleware } from './auth.middleware.js';
import { ClerkAuthService } from './clerk-auth.service.js';

/**
 * `AuthModule` — provides the Clerk session-token verification stack. `ClerkAuthService` (networkless
 * `verifyToken`) and the `AuthMiddleware` (fail-closed owner-identity enforcement) are exported so the
 * root `AppModule` can apply the middleware across all non-public routes.
 */
@Module({
    providers: [ClerkAuthService, AuthMiddleware],
    exports: [ClerkAuthService, AuthMiddleware],
})
export class AuthModule {}
