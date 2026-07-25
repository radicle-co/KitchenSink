import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';

import { AppConfigModule } from './config/config.module.js';
import { CommonModule } from './common/common.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { AuthModule } from './auth/auth.module.js';
import { RecipesModule } from './recipes/recipes.module.js';
import { RatingsModule } from './ratings/ratings.module.js';
import { IngredientsModule } from './ingredients/ingredients.module.js';
import { VersionsModule } from './versions/versions.module.js';
import { PhotosModule } from './photos/photos.module.js';
import { CollectionsModule } from './collections/collections.module.js';
import { SearchModule } from './search/search.module.js';
import { AccountModule } from './account/account.module.js';
import { AuthMiddleware } from './auth/auth.middleware.js';
import { ApiExceptionFilter } from './common/filters/api-exception.filter.js';
import { throttlerModuleOptions } from './common/throttle/throttle.config.js';
import { UserThrottlerGuard } from './common/throttle/user-throttler.guard.js';
import { ErasureLockGuard } from './account/erasure-lock.guard.js';

/**
 * Root application module. Wires the config, per-domain feature modules, the global Drizzle provider,
 * and the cross-cutting concerns: the API exception filter (`APP_FILTER`), rate limiting
 * (`ThrottlerModule` + the global {@link UserThrottlerGuard}, which keys per authenticated user — not per
 * ALB-shared IP), the HAZ-052 erasure write-lock ({@link ErasureLockGuard}, global — see its own
 * docstring for why a single `APP_GUARD` is the right seam over a per-service check), and the
 * fail-closed Clerk `AuthMiddleware` applied to every non-public route.
 */
@Module({
    imports: [
        AppConfigModule,
        ThrottlerModule.forRoot(throttlerModuleOptions),
        CommonModule,
        DatabaseModule,
        HealthModule,
        AuthModule,
        RecipesModule,
        RatingsModule,
        IngredientsModule,
        VersionsModule,
        PhotosModule,
        CollectionsModule,
        SearchModule,
        AccountModule,
    ],
    providers: [
        {
            provide: APP_FILTER,
            useClass: ApiExceptionFilter,
        },
        {
            // Keys the rate limit on the authenticated app-user ULID (see UserThrottlerGuard) rather than
            // the ALB-shared `req.ip` the stock ThrottlerGuard uses.
            provide: APP_GUARD,
            useClass: UserThrottlerGuard,
        },
        {
            // HAZ-052 (Catastrophic) — rejects mutating requests from an owner with an in-flight erasure
            // job with 423, on every controller, unconditionally. See ErasureLockGuard's own docstring.
            provide: APP_GUARD,
            useClass: ErasureLockGuard,
        },
    ],
})
export class AppModule implements NestModule {
    public configure(consumer: MiddlewareConsumer): void {
        consumer.apply(AuthMiddleware).forRoutes('*');
    }
}
