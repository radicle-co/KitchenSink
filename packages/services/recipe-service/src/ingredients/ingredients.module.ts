/**
 * `IngredientsModule` — the ingredients vertical (US1 MVP). Wires the `/v1/ingredients` controller, the
 * picker business logic ({@link IngredientsService}), the catalog DAL ({@link IngredientsDal}, built over
 * the global Drizzle provider), and the food-service client ({@link FoodServiceClient}) it resolves
 * nutrition through — the service NEVER queries USDA directly (data-model R5 / FR-007).
 *
 * `FoodServiceClient` is a singleton configured from the environment: `FOOD_SERVICE_URL` (the food
 * service origin) and an optional `FOOD_SERVICE_TOKEN` (a service/M2M bearer, re-read per request via
 * the client's `getToken` callback so a rotated token is always current). Infra injects both as env
 * vars, exactly like the other cross-service integration points.
 */
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FoodServiceClient } from '@kitchensink/food-service-client';

import { DrizzleProvider, type RecipeDrizzle } from '../database/database.module.js';
import { IngredientsController } from './ingredients.controller.js';
import { IngredientsService } from './ingredients.service.js';
import { IngredientsDal } from './dal/ingredients.dal.js';

/** Default food-service origin for local dev when `FOOD_SERVICE_URL` is unset. */
const DEFAULT_FOOD_SERVICE_URL = 'http://localhost:3002';

@Module({
    controllers: [IngredientsController],
    providers: [
        {
            provide: IngredientsDal,
            inject: [DrizzleProvider],
            useFactory: (db: RecipeDrizzle): IngredientsDal => new IngredientsDal(db),
        },
        {
            provide: FoodServiceClient,
            inject: [ConfigService],
            useFactory: (config: ConfigService): FoodServiceClient => {
                // Read the base URL from the Zod-validated config (foodServiceConfigSchema) rather than raw
                // process.env, so the boot-time validation actually governs the value the client uses. The
                // token is still read live per request via the callback so a rotated secret takes effect
                // without a redeploy.
                const token = config.get<string>('FOOD_SERVICE_TOKEN');

                return new FoodServiceClient({
                    baseUrl: config.get<string>('FOOD_SERVICE_URL') ?? DEFAULT_FOOD_SERVICE_URL,
                    token: token !== undefined ? (): string => process.env['FOOD_SERVICE_TOKEN'] ?? token : undefined,
                });
            },
        },
        IngredientsService,
    ],
    exports: [IngredientsService],
})
export class IngredientsModule {}
