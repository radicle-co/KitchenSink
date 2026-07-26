/**
 * `IngredientsModule` — the ingredients vertical (US1 MVP + Stage-2 blended typeahead). Wires the
 * `/v1/ingredients` controller, the picker business logic ({@link IngredientsService}), the catalog DAL
 * ({@link IngredientsDal}, built over the global Drizzle provider), and the TWO food-service seams it reads
 * nutrition and catalog suggestions through — the service NEVER queries USDA directly (data-model R5 / FR-007).
 *
 * **Two food-service clients, deliberately.** Both point at the same origin with the same M2M token; they
 * differ ONLY in their transport timeout, because their callers have opposite latency contracts:
 *
 *  - {@link FoodServiceClient} (the default 8s) backs `addByName` / `getStatus` / `resolve` — user-initiated
 *    writes and polls where waiting several seconds for a real answer beats failing.
 *  - {@link FoodCatalogGateway}'s private client uses {@link TYPEAHEAD_TIMEOUT_MS} (sub-second) because it
 *    runs on a PER-KEYSTROKE path (Stage 2 / F2). Sharing the 8s client here would let a degraded food service
 *    stall the typeahead for 8s per keystroke and pile up in-flight requests — the exact failure the short
 *    timeout plus the gateway's local-only fallback exists to prevent.
 *
 * The timeout is enforced at the transport (a real `AbortSignal` inside the client), NOT by racing a timer in
 * the caller — a race would return early while leaving the underlying request pending, leaking a socket per
 * keystroke during an outage.
 *
 * Configuration comes from the Zod-validated config (`foodServiceConfigSchema`) rather than raw
 * `process.env`, so boot-time validation actually governs the values used: `FOOD_SERVICE_URL` (origin),
 * `FOOD_SERVICE_TOKEN` (M2M bearer, re-read per request via the client's `getToken` callback so a rotated
 * token is always current), `FOOD_CATALOG_BLEND_ENABLED` (Stage-2 rollout switch) and
 * `FOOD_CATALOG_TYPEAHEAD_TIMEOUT_MS` (the per-keystroke bound).
 */
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FoodServiceClient } from '@kitchensink/food-service-client';

import { DrizzleProvider, type RecipeDrizzle } from '../database/database.module.js';
import { IngredientsController } from './ingredients.controller.js';
import { IngredientsService } from './ingredients.service.js';
import { FoodCatalogGateway } from './food-catalog.gateway.js';
import { IngredientsDal } from './dal/ingredients.dal.js';

/** Default food-service origin for local dev when `FOOD_SERVICE_URL` is unset. */
const DEFAULT_FOOD_SERVICE_URL = 'http://localhost:3002';

/**
 * Default per-keystroke bound on the catalog-blend request (ms).
 *
 * Sized against what the call actually does — food-service's `/v1/foods/search` is a local trgm+FTS query
 * plus two crosswalk lookups, so a healthy round-trip inside one VPC is tens of ms. 600ms therefore leaves
 * roughly an order of magnitude of headroom for a cold connection or a GC pause while still keeping the
 * WORST case comfortably under the ~300ms debounce plus a keystroke: a degraded food service costs the user a
 * brief wait for the catalog section, never a stalled typeahead.
 */
const TYPEAHEAD_TIMEOUT_MS = 600;

/** Read the M2M token source, re-reading `process.env` per request so a rotated secret takes effect live. */
function tokenSource(config: ConfigService): (() => string) | undefined {
    const token = config.get<string>('FOOD_SERVICE_TOKEN');

    return token !== undefined ? (): string => process.env['FOOD_SERVICE_TOKEN'] ?? token : undefined;
}

/** Build a food-service client for the configured origin with an explicit timeout. */
function createFoodServiceClient(config: ConfigService, timeoutMs?: number): FoodServiceClient {
    return new FoodServiceClient({
        baseUrl: config.get<string>('FOOD_SERVICE_URL') ?? DEFAULT_FOOD_SERVICE_URL,
        token: tokenSource(config),
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
    });
}

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
            useFactory: (config: ConfigService): FoodServiceClient => createFoodServiceClient(config),
        },
        {
            provide: FoodCatalogGateway,
            inject: [ConfigService],
            useFactory: (config: ConfigService): FoodCatalogGateway =>
                new FoodCatalogGateway(
                    createFoodServiceClient(
                        config,
                        config.get<number>('FOOD_CATALOG_TYPEAHEAD_TIMEOUT_MS') ?? TYPEAHEAD_TIMEOUT_MS,
                    ),
                    // Enabled unless an operator explicitly switches the blend off.
                    { enabled: config.get<boolean>('FOOD_CATALOG_BLEND_ENABLED') !== false },
                ),
        },
        IngredientsService,
    ],
    exports: [IngredientsService],
})
export class IngredientsModule {}
