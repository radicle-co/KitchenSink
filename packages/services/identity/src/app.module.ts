import { MiddlewareConsumer, Module, NestModule, ValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { SentryModule } from '@sentry/nestjs/setup';

import { AppConfigModule } from './config/config.module.js';
import { HealthModule } from './health/health.module.js';
import { DatabaseModule } from './database/database.module.js';
import { AuthModule } from './auth/auth.module.js';
import { QueueModule } from './queue/queue.module.js';
import { UsersModule } from './users/users.module.js';
import { AdminModule } from './admin/admin.module.js';
import { AuthMiddleware } from './auth/middleware/auth.middleware.js';
import { ApiExceptionFilter } from './common/filters/api-exception.filter.js';
import { SentryContextMiddleware } from './observability/sentry-context.middleware.js';

@Module({
    imports: [
        SentryModule.forRoot(),
        AppConfigModule,
        HealthModule,
        DatabaseModule,
        AuthModule,
        QueueModule,
        UsersModule,
        AdminModule,
    ],
    controllers: [],
    providers: [
        {
            provide: APP_FILTER,
            useClass: ApiExceptionFilter,
        },
        {
            // APP_PIPE (not the bare `ValidationPipe` class token) is what registers a pipe GLOBALLY.
            // Bound to the class token, nothing injected it and DTO validation never ran — an over-long
            // displayName or non-URL avatarUrl reached the DB unchecked. See S-I1.
            provide: APP_PIPE,
            useValue: new ValidationPipe({
                whitelist: true,
                forbidNonWhitelisted: true,
                transform: true,
            }),
        },
    ],
})
export class AppModule implements NestModule {
    public configure(consumer: MiddlewareConsumer): void {
        consumer.apply(AuthMiddleware, SentryContextMiddleware).forRoutes('*');
    }
}
