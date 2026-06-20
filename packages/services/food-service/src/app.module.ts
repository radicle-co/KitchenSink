import { Module, ValidationPipe } from '@nestjs/common';

import { AppConfigModule } from './config/config.module.js';
import { HealthModule } from './health/health.module.js';

/**
 * Root module for the food service. Foundation scaffold (T-001): config validation + the `/health`
 * probe. The `/v1/foods/*` controllers, Drizzle database module, `FoodAuthGuard` middleware, the
 * Postgres-queue services, and the worker are added by later-phase tasks (T-010+).
 */
@Module({
    imports: [AppConfigModule, HealthModule],
    controllers: [],
    providers: [
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
