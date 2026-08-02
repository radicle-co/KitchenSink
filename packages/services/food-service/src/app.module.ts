import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';

import { ApiExceptionFilter } from './common/filters/api-exception.filter.js';
import { AppConfigModule } from './config/config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { FoodsModule } from './foods/foods.module.js';
import { HealthModule } from './health/health.module.js';

/**
 * Root module for the food service. Wires config validation, the `/health` probe, the global
 * {@link DatabaseModule} (Drizzle + `pg` pool over `kitchensink_food`), and {@link FoodsModule}
 * (the `/api/v1/foods/*` read API, T-010). The `FoodAuthGuard` middleware and the Fargate worker are
 * added by later-phase tasks (Phase 3 / Phase 7).
 */
@Module({
    imports: [AppConfigModule, DatabaseModule, FoodsModule, HealthModule],
    controllers: [],
    providers: [
        {
            provide: APP_FILTER,
            useClass: ApiExceptionFilter,
        },
        // NOTE (S-I1): a `ValidationPipe` bound to the bare class token used to sit here — inert (a
        // global pipe needs the `APP_PIPE` token) and pointless anyway, since the food API has no
        // class-validator DTOs and validates its inputs by hand in the controller. Removed as dead code.
    ],
})
export class AppModule {}
