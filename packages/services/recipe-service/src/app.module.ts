import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { AppConfigModule } from './config/config.module.js';
import { CommonModule } from './common/common.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { AuthModule } from './auth/auth.module.js';
import { RecipesModule } from './recipes/recipes.module.js';
import { IngredientsModule } from './ingredients/ingredients.module.js';
import { VersionsModule } from './versions/versions.module.js';
import { PhotosModule } from './photos/photos.module.js';
import { CollectionsModule } from './collections/collections.module.js';
import { SearchModule } from './search/search.module.js';
import { AccountModule } from './account/account.module.js';
import { AuthMiddleware } from './auth/auth.middleware.js';
import { ApiExceptionFilter } from './common/filters/api-exception.filter.js';
import { throttleGroups } from './common/throttle/throttle.config.js';

/**
 * Root application module. Wires the config, per-domain feature modules, the global Drizzle provider,
 * and the cross-cutting concerns: the API exception filter (`APP_FILTER`), rate limiting
 * (`ThrottlerModule` + global `ThrottlerGuard`), and the fail-closed Clerk `AuthMiddleware` applied to
 * every non-public route.
 */
@Module({
    imports: [
        AppConfigModule,
        ThrottlerModule.forRoot([...throttleGroups]),
        CommonModule,
        DatabaseModule,
        HealthModule,
        AuthModule,
        RecipesModule,
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
            provide: APP_GUARD,
            useClass: ThrottlerGuard,
        },
    ],
})
export class AppModule implements NestModule {
    public configure(consumer: MiddlewareConsumer): void {
        consumer.apply(AuthMiddleware).forRoutes('*');
    }
}
