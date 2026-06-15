import 'reflect-metadata';
import { describe, expect, it } from 'vitest';

import { AuthModule } from '../auth.module.js';
import { AuthMiddleware } from '../middleware/auth.middleware.js';
import { ClerkAuthService } from '../clerk-auth.service.js';

// AuthMiddleware is applied in AppModule.configure() (consumer.apply(AuthMiddleware, ...)). NestJS
// instantiates an applied middleware in the context of the module that applies it, resolving its
// constructor dependencies from the EXPORTS of that module's imported modules — NOT from this
// module's private providers. So AuthModule must EXPORT every provider AuthMiddleware injects, or the
// app crash-loops on boot (ECS deployment circuit breaker) with:
//   "Nest can't resolve dependencies of the AuthMiddleware (?, UsersService). Please make sure that
//    the argument ClerkAuthService at index [0] is available in the AppModule module."
// Unit/E2E tests don't boot the full AppModule middleware graph, so they miss this — this guards it.
describe('AuthModule', () => {
    const moduleExports = Reflect.getMetadata('exports', AuthModule) as unknown[];

    it('exports ClerkAuthService so the applied AuthMiddleware can resolve it', () => {
        expect(moduleExports).toContain(ClerkAuthService);
    });

    it('exports AuthMiddleware', () => {
        expect(moduleExports).toContain(AuthMiddleware);
    });
});
