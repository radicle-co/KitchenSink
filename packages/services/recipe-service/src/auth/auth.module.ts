import { Module } from '@nestjs/common';

import { AuthMiddleware } from './auth.middleware.js';
import { ClerkAuthService } from './clerkAuth.service.js';
import { ServiceErasureAuthService } from './serviceErasureAuth.service.js';
import { ServiceErasureGuard } from './serviceErasure.guard.js';

/**
 * `AuthModule` — provides the two verification stacks the recipe service authenticates with:
 *
 *  - **User session tokens** — `ClerkAuthService` (networkless Clerk `verifyToken`) + the fail-closed
 *    `AuthMiddleware`, applied by `AppModule` across all non-public routes.
 *  - **The GREENFIELD service principal** (CR-002 / U4a) — `ServiceErasureAuthService` (networkless
 *    verification of the deletion-worker's signed, single-target erasure token) + `ServiceErasureGuard`,
 *    which protects the internal erasure route that is deliberately EXCLUDED from `AuthMiddleware`.
 *
 * All are exported so `AppModule` (middleware) and `AccountModule` (the guarded internal controller) can
 * consume them.
 */
@Module({
    providers: [ClerkAuthService, AuthMiddleware, ServiceErasureAuthService, ServiceErasureGuard],
    exports: [ClerkAuthService, AuthMiddleware, ServiceErasureAuthService, ServiceErasureGuard],
})
export class AuthModule {}
