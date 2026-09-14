import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AuthMiddleware } from './auth.middleware.js';
import { ClerkAuthService } from './clerkAuth.service.js';
import { CONTAINMENT_MODE } from './containmentMode.js';
import { TestPrincipalsDal } from './dal/testPrincipals.dal.js';
import type { TestPrincipalContainment } from '../common/containmentPolicy.js';
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
    providers: [
        ClerkAuthService,
        AuthMiddleware,
        ServiceErasureAuthService,
        ServiceErasureGuard,
        TestPrincipalsDal,
        {
            // ADR-0040 — the stage's containment mode, from the VALIDATED config (default `enforce`). `getOrThrow`
            // is belt-and-braces: the boot-time schema always materializes the default.
            provide: CONTAINMENT_MODE,
            inject: [ConfigService],
            useFactory: (config: ConfigService): TestPrincipalContainment =>
                config.getOrThrow<TestPrincipalContainment>('TEST_PRINCIPAL_CONTAINMENT'),
        },
    ],
    exports: [
        ClerkAuthService,
        AuthMiddleware,
        ServiceErasureAuthService,
        ServiceErasureGuard,
        TestPrincipalsDal,
        CONTAINMENT_MODE,
    ],
})
export class AuthModule {}
