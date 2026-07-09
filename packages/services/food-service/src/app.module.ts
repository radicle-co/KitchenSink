import { Module, ValidationPipe } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';

import { ApiExceptionFilter } from './common/filters/api-exception.filter.js';
import { AppConfigModule } from './config/config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { FoodsModule } from './foods/foods.module.js';
import { HealthModule } from './health/health.module.js';

/**
 * Root module for the food service. Wires config validation, the `/health` probe, the global
 * {@link DatabaseModule} (Drizzle + `pg` pool over `kitchensink_food`), and {@link FoodsModule}
 * (the `/v1/foods/*` read API, T-010). The `FoodAuthGuard` middleware and the Fargate worker are
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
        {
            provide: ValidationPipe,
            useValue: new ValidationPipe({
                whitelist: true,
                forbidNonWhitelisted: true,
                transform: true,
            }),
        },
    ],
})
export class AppModule {}
