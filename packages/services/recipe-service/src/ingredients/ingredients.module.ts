/**
 * `IngredientsModule` — the ingredients vertical (US1 MVP + Stage-2 blended typeahead). Wires the
 * `/api/v1/ingredients` controller, the picker business logic ({@link IngredientsService}), the catalog DAL
 * ({@link IngredientsDal}, built over the global Drizzle provider), and the food-service seam it reads
 * nutrition and catalog suggestions through — the service NEVER queries USDA directly (data-model R5 / FR-007).
 *
 * ## Patterns in force here
 *
 * **Factory (`FoodServiceClients`) over singleton clients — because the credential is per request.** Food's
 * `FoodAuthGuard` verifies a *Clerk* token, so the only credential that can satisfy it is the CALLER's own
 * (issue #120). This module therefore provides no long-lived client at all: it provides one **Factory**, and
 * the controller threads an opaque `CallerToken` (a redacting **Value Object**, `auth/CallerToken.ts`)
 * down to it, where it is exchanged for a client bound to that caller and to the ONE config-supplied origin.
 * The alternative — a `Scope.REQUEST` provider — was rejected because request scope bubbles up the whole
 * injection chain (gateway, service, controller) to buy an implicit version of a value that reads better
 * explicit: every food call now NAMES the authority it acts under, which is what makes a forwarded user
 * credential reviewable rather than ambient. The pre-#120 wiring was two singleton clients sharing a static
 * `FOOD_SERVICE_TOKEN` env string — a value that was never set anywhere and could not have worked if it were.
 *
 * **The two latency contracts survive the change — do NOT collapse them.** They now live as the factory's two
 * methods rather than two providers:
 *
 *  - `standard()` (the client's default 8s) backs `addByName` / `getStatus` / `getCandidates` / `resolve` —
 *    user-initiated writes and polls where waiting several seconds for a real answer beats failing.
 *  - `typeahead()` uses {@link TYPEAHEAD_TIMEOUT_MS} (sub-second) because {@link FoodCatalogGateway} runs on a
 *    PER-KEYSTROKE path (Stage 2 / F2). Sharing the 8s budget there would let a degraded food service stall
 *    the typeahead for 8s per keystroke and pile up in-flight requests — the exact failure the short timeout
 *    plus the gateway's local-only fallback exists to prevent.
 *
 * Both bounds are enforced at the transport (a real `AbortSignal` inside the client), NOT by racing a timer in
 * the caller — a race would return early while leaving the underlying request pending, leaking a socket per
 * keystroke during an outage.
 *
 * **Gateway (`FoodCatalogGateway`)** still owns the availability discipline for the blend, and is now the
 * place a caller with NO credential degrades honestly instead of issuing a call that could only 401.
 *
 * **U14 — the correction route's collaborator.** `IngredientsController` now takes
 * {@link ResolutionMappingsService} alongside {@link IngredientsService}. It is a second collaborator rather
 * than a method on the first because it owns its own Unit of Work over a different table and answers a
 * different question: what a PHRASE means, not which ingredient row exists. Both are provided here, and the
 * service stays exported so `RecipesModule` and the integration tier reach the same instance.
 *
 * Configuration comes from the Zod-validated config (`foodServiceConfigSchema`) rather than raw
 * `process.env`, so boot-time validation governs the values used: `FOOD_SERVICE_URL` (origin — REQUIRED, with
 * no default anywhere, so a stage that was not told the food origin fails the boot instead of silently
 * calling `localhost`), `FOOD_CATALOG_BLEND_ENABLED` (Stage-2 rollout switch) and
 * `FOOD_CATALOG_TYPEAHEAD_TIMEOUT_MS` (the per-keystroke bound).
 */
import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DrizzleProvider, type RecipeDrizzle } from '../database/database.module.js';
import { IngredientsController } from './ingredients.controller.js';
import { IngredientsService } from './ingredients.service.js';
import { FoodCatalogGateway } from './foodCatalog.gateway.js';
import { FoodServiceClients } from './FoodServiceClients.factory.js';
import { FoodNutritionGateway } from './foodNutrition.gateway.js';
import { IngredientsDal } from './dal/ingredients.dal.js';
import { createCuratedTier } from './resolution/curatedTier.js';
import { createMemoTier } from './resolution/memoTier.js';
import { MappingPromotionAudit } from './resolution/mappingPromotionAudit.js';
import { IngredientResolutionsDal } from './resolution/ingredientResolutions.dal.js';
import { ResolutionMappingsDal } from './resolution/resolutionMappings.dal.js';
import { ResolutionMappingsService } from './resolution/resolutionMappings.service.js';
import type { ResolutionTier } from './resolution/resolutionCascade.js';

/**
 * Default per-keystroke bound on the catalog-blend request (ms).
 *
 * Sized against what the call actually does — food-service's `/api/v1/foods/search` is a local trgm+FTS query
 * plus two crosswalk lookups, so a healthy round-trip inside one VPC is tens of ms. 600ms therefore leaves
 * roughly an order of magnitude of headroom for a cold connection or a GC pause while still keeping the
 * WORST case comfortably under the ~300ms debounce plus a keystroke: a degraded food service costs the user a
 * brief wait for the catalog section, never a stalled typeahead.
 */
const TYPEAHEAD_TIMEOUT_MS = 600;

/**
 * The ordered resolution cascade (plan U10 / R11). ⛔ **THE ORDER IS THE CONFIGURATION** — it is R11's
 * precedence, not an implementation detail, which is why it lives here as an explicit registry rather than
 * being assembled inside the service.
 *
 * Today it holds tiers **1** (curated mappings) and **3** (remembered resolutions). The two absentees are
 * absent for stated reasons rather than by oversight:
 *
 *  - **Tier 2, lexical**, is U5/U6's: the ranking and the margin at which it is confident are theirs, and
 *    inserting a half-built one here would give the cascade a metric nobody had measured. Until it ships, the
 *    EXISTING `addByName` path is the lexical fallback — it runs after the cascade is exhausted, which is the
 *    same position in the precedence. U5/U6 insert their tier at index 1.
 *  - **Tier 4, the LLM gate, is NOT A TIER OF THIS CHAIN AT ALL** — corrected 2026-08-22, when its producer
 *    shipped. KTD-3 is "the verification gate, NOT a residual fallback": the model verifies what is about to
 *    be PUBLISHED, whereas a tier here is consulted precisely when tiers 1–3 have all passed, i.e. when there
 *    is nothing resolved to verify. The gate's producer lives on the RECIPE write path, which is the only
 *    layer holding the recipe id, the raw source line, the parsed quantity and the resolved food together —
 *    see `recipes/domain/verificationRequests.ts`. This registry stays two tiers long until U5/U6 ship the
 *    lexical one at index 1.
 *
 * @param mappings - The knowledge-base repository both live tiers read through.
 * @returns The tiers, in R11's order.
 */
function resolutionTiers(mappings: ResolutionMappingsDal): readonly ResolutionTier[] {
    return [createCuratedTier(mappings), createMemoTier(mappings)];
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
            provide: FoodServiceClients,
            inject: [ConfigService],
            useFactory: (config: ConfigService): FoodServiceClients =>
                new FoodServiceClients({
                    // `getOrThrow` states the invariant locally too: there is no default, at any layer.
                    baseUrl: config.getOrThrow<string>('FOOD_SERVICE_URL'),
                    typeaheadTimeoutMs: config.get<number>('FOOD_CATALOG_TYPEAHEAD_TIMEOUT_MS') ?? TYPEAHEAD_TIMEOUT_MS,
                }),
        },
        {
            provide: FoodCatalogGateway,
            inject: [FoodServiceClients, ConfigService],
            useFactory: (clients: FoodServiceClients, config: ConfigService): FoodCatalogGateway =>
                new FoodCatalogGateway(clients, {
                    // Enabled unless an operator explicitly switches the blend off.
                    enabled: config.get<boolean>('FOOD_CATALOG_BLEND_ENABLED') !== false,
                }),
        },
        {
            // The recipe read path's nutrition source (U10). Provided HERE, beside the food client factory
            // it depends on, and exported so `RecipesModule` consumes it rather than building a second
            // instance — a second instance would mean a second cache, halving the hit rate and letting the
            // two disagree about what food last said.
            provide: FoodNutritionGateway,
            inject: [FoodServiceClients],
            useFactory: (clients: FoodServiceClients): FoodNutritionGateway => new FoodNutritionGateway(clients),
        },
        {
            provide: IngredientResolutionsDal,
            inject: [DrizzleProvider],
            useFactory: (db: RecipeDrizzle): IngredientResolutionsDal => new IngredientResolutionsDal(db),
        },
        {
            provide: ResolutionMappingsDal,
            inject: [DrizzleProvider],
            useFactory: (db: RecipeDrizzle): ResolutionMappingsDal => new ResolutionMappingsDal(db),
        },
        {
            // The promotion audit's log half goes through Nest's `Logger`, so the identifiers it carries are
            // scrubbed on the way out; the metric half writes EMF straight to stdout by default.
            provide: MappingPromotionAudit,
            useFactory: (): MappingPromotionAudit => {
                const logger = new Logger(MappingPromotionAudit.name);

                return new MappingPromotionAudit(undefined, undefined, (message, context) =>
                    logger.log(message, context),
                );
            },
        },
        ResolutionMappingsService,
        {
            provide: IngredientsService,
            inject: [
                IngredientsDal,
                FoodServiceClients,
                FoodCatalogGateway,
                ResolutionMappingsDal,
                IngredientResolutionsDal,
            ],
            useFactory: (
                dal: IngredientsDal,
                clients: FoodServiceClients,
                catalog: FoodCatalogGateway,
                mappings: ResolutionMappingsDal,
                resolutions: IngredientResolutionsDal,
            ): IngredientsService =>
                new IngredientsService(dal, clients, catalog, resolutionTiers(mappings), resolutions),
        },
    ],
    exports: [IngredientsService, FoodNutritionGateway, ResolutionMappingsService, IngredientResolutionsDal],
})
export class IngredientsModule {}
