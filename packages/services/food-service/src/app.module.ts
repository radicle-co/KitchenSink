import { Module } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { ZodValidationPipe } from 'nestjs-zod';

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
        {
            // THE PIPE IS LOAD-BEARING, and three details about this binding each have a failure attached.
            //
            // 1. `APP_PIPE` (not the bare pipe class token) is what registers a pipe GLOBALLY. Bound to the
            //    class token nothing injects it and validation never runs — bug S-I1, whose earlier fix here
            //    was to DELETE the inert pipe rather than fix it, on the reasoning that the controller
            //    validated by hand. It did, three times, with three error labels, and not at all on `search`.
            // 2. IT MUST BE `nestjs-zod`'s PIPE, NOT NEST'S. The request DTOs are `createZodDto` classes over
            //    the AUTHORED wire schemas (`foods.schema.ts`), so the service validates with the same
            //    definition it publishes. Those classes carry NO `class-validator` metadata, so Nest's own
            //    `ValidationPipe` would pass every body straight through — validating nothing while LOOKING
            //    correctly wired, on routes that enqueue source fetches and spend a rate-limit budget.
            // 3. Left NON-strict (`strictSchemaDeclaration` defaulted off) on purpose: it makes the pipe pass
            //    through any parameter whose metatype is not a Zod DTO, and every `@Param('id')` in this
            //    service is a bare `string` narrowed by the controller's ULID check. Turning it on would 500
            //    every one of them.
            //
            // Unknown-key REJECTION rides on `z.strictObject` in `foods.schema.ts`, not on a pipe option:
            // zod's plain `z.object()` STRIPS unknown keys silently, so the strictness has to live with the
            // rule rather than be assumed from a pipe flag that does not exist here.
            provide: APP_PIPE,
            useValue: new ZodValidationPipe(),
        },
    ],
})
export class AppModule {}
