import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { ZodValidationPipe } from 'nestjs-zod';
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
            // APP_PIPE (not the bare pipe class token) is what registers a pipe GLOBALLY. Bound to the class
            // token, nothing injected it and DTO validation never ran — an over-long displayName or non-URL
            // avatarUrl reached the DB unchecked. See S-I1.
            //
            // IT MUST BE `nestjs-zod`'s PIPE, NOT NEST'S. The request DTOs are now `createZodDto` classes over
            // the AUTHORED wire schemas (CODING_STANDARDS §15.2), so the service validates with the same
            // definition it publishes. Those classes carry NO `class-validator` metadata, so Nest's own
            // `ValidationPipe` would pass every body straight through — validating nothing while LOOKING
            // validated, on a route that writes user data. That is a strictly worse failure than the original
            // S-I1 bug, because it presents as correctly wired.
            //
            // The two behaviours the old pipe was configured for are preserved where they belong: `transform`
            // is inherent (zod returns parsed data), and `whitelist`/`forbidNonWhitelisted` is now
            // `z.strictObject` in `users.schema.ts` — zod's plain `z.object()` STRIPS unknown keys silently
            // instead of rejecting them, so the strictness had to move with the rule rather than be assumed.
            //
            // Left NON-strict (`strictSchemaDeclaration` defaulted off) on purpose: it makes the pipe pass
            // through any parameter whose metatype is not a Zod DTO, and every `@Param`/`@Query` in this
            // service is a bare `string`. Turning it on would 500 every one of them.
            provide: APP_PIPE,
            useValue: new ZodValidationPipe(),
        },
    ],
})
export class AppModule implements NestModule {
    public configure(consumer: MiddlewareConsumer): void {
        consumer.apply(AuthMiddleware, SentryContextMiddleware).forRoutes('*');
    }
}
