/**
 * T026 — the `/api/v1/recipes` REST surface (US1 recipe CRUD).
 *
 * Thin controller: the `@OwnerId()` / `@CurrentPrincipal()` decorators read the authenticated identity
 * from `req.principal` (set by the fail-closed `AuthMiddleware` — the owner key is the app-user ULID,
 * never the Clerk `sub`) and the controller delegates every decision to {@link RecipesService}. Domain
 * failures thrown by the service (`RECIPE_NOT_FOUND` / `NOT_OWNER` / `VERSION_CONFLICT`) are translated
 * to HTTP by the global `ApiExceptionFilter`. A controller-scoped `ZodValidationPipe` enforces the DTOs,
 * which ARE the authored wire contract (`recipes.schema.ts`) rather than a second set of `class-validator`
 * rules beside it — see CODING_STANDARDS §15.2. Unknown body keys are stripped (zod's `z.object` default),
 * and a `@Param` string passes through the pipe untouched because its metatype is not a `ZodDto`.
 *
 * ⚠️ THE PIPE IS LOAD-BEARING, not decoration. The DTOs are `createZodDto` classes and carry NO
 * `class-validator` metadata, so swapping this back to Nest's own `ValidationPipe` would validate NOTHING
 * while looking correctly wired — on the route that writes user-authored recipe content. The app registers no
 * global pipe, so this binding is the only enforcement point.
 */
import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    HttpStatus,
    Param,
    ParseUUIDPipe,
    Patch,
    Post,
    Query,
    UsePipes,
} from '@nestjs/common';
import { ZodValidationPipe } from 'nestjs-zod';

import { RecipesService } from './recipes.service.js';
import { CreateRecipeDto } from './dto/createRecipe.dto.js';
import { UpdateRecipeDto } from './dto/updateRecipe.dto.js';
import { ListRecipesQueryDto } from './dto/listRecipes.query.dto.js';
import { CloneRecipeDto } from './dto/cloneRecipe.dto.js';
import { RecipeNutritionRequestDto } from './dto/recipeNutrition.dto.js';
import { SetVisibilityDto } from './dto/setVisibility.dto.js';
import type { PaginatedRecipesResponse, RecipeResponse } from './dto/recipeResponse.dto.js';
import type { RecipeNutritionResponse } from './recipes.schema.js';
import { SkipErasureLock } from '../account/skipErasureLock.decorator.js';
import { CurrentPrincipal, OwnerId } from '../auth/currentPrincipal.decorator.js';
import type { Principal } from '../auth/principal.js';
import { CallerBearerToken } from '../auth/CallerToken.decorator.js';
import type { CallerToken } from '../auth/CallerToken.js';
import { WriteRateLimit } from '../common/throttle/throttle.decorators.js';
import { AnalyticsService } from '../analytics/analytics.service.js';

// Canonically served under the `/api/{version}/` prefix. The bare `v1/...` entry is a DEPRECATED ALIAS:
// `/v1/*` is live in production and held by consumers configured OUTSIDE this repo (the Clerk dashboard
// webhook URL) as well as already-shipped mobile builds and cached web bundles, whose endpoints were
// inlined at build time. Removing it REQUIRES updating the Clerk dashboard first — see ADR-0011.
@Controller(['api/v1/recipes', 'v1/recipes'])
@UsePipes(ZodValidationPipe)
export class RecipesController {
    public constructor(
        private readonly recipesService: RecipesService,
        private readonly analytics: AnalyticsService,
    ) {}

    /** `POST /api/v1/recipes` — create a recipe owned by the caller. */
    @Post()
    @HttpCode(HttpStatus.CREATED)
    @WriteRateLimit()
    public async create(
        @CurrentPrincipal() principal: Principal,
        @CallerBearerToken() caller: CallerToken | undefined,
        @Body() body: CreateRecipeDto,
    ): Promise<RecipeResponse> {
        return this.recipesService.create(principal, body, caller);
    }

    /** `GET /api/v1/recipes` — list the caller's recipes with pagination. */
    @Get()
    public async list(
        @OwnerId() ownerId: string,
        @Query() query: ListRecipesQueryDto,
    ): Promise<PaginatedRecipesResponse> {
        return this.recipesService.list(ownerId, query);
    }

    /**
     * `POST /api/v1/recipes/nutrition-batch` — the DEFERRED calorie lookup: per-serving nutrition for many
     * recipes at once, so a card grid renders immediately and fills its figures in afterwards.
     *
     * ⚠️ **Declared BEFORE every `:id` route.** Nest matches in DECLARATION order, so a route registered
     * after a same-shape `:id` pattern is swallowed by it — `nutrition-batch` would bind as a recipe id and
     * this endpoint would 404 with no clue why. `FoodsController.getNutritionBatch` carries the same
     * warning, where the collision is live against its `:id/status` route.
     *
     * ⛔ **POST for a READ, deliberately against food's `GET /api/v1/foods/nutrition` precedent, and the
     * reason food chose GET is exactly the reason this cannot.** ADR-0020 makes food's route cacheable at
     * the edge because "the response must not vary by caller; the edge keys it on the URL alone". THIS
     * response varies by caller BY CONSTRUCTION — a recipe the caller may not read is OMITTED, and omission
     * IS the authorization signal — so a URL-keyed edge cache would serve one viewer's map to another. GET
     * is also infeasible at the cap: 500 × a 36-character uuid is ~18 kB of query string, past CloudFront's
     * 8192-byte URL limit and the ALB's default 8 kB request line. This path must never be added to a
     * CloudFront cache policy.
     *
     * ⛔ **`@SkipErasureLock()` is REQUIRED, and it is not a formality.** `ErasureLockGuard` keys on the
     * HTTP METHOD, so a POST-shaped read would answer `423` for a caller with an in-flight erasure — their
     * recipe list would render while its calorie badges failed — and every call would pay an
     * `account_erasure_jobs` round trip on a hot path. HAZ-052 rejects MUTATIONS, not visibility.
     *
     * No `@WriteRateLimit()`: reads inherit the default read limit by carrying no throttle decorator.
     * `200`, not Nest's `@Post` default of `201` — this endpoint creates nothing.
     */
    @Post('nutrition-batch')
    @HttpCode(HttpStatus.OK)
    @SkipErasureLock()
    public async getNutritionBatch(
        @OwnerId() ownerId: string,
        // Forwarded so FOOD authorizes the nutrition read as this user (U10); absent ⇒ the gateway degrades.
        @CallerBearerToken() caller: CallerToken | undefined,
        @Body() body: RecipeNutritionRequestDto,
    ): Promise<RecipeNutritionResponse> {
        return this.recipesService.getNutritionForRecipes(ownerId, body.recipeIds, caller);
    }

    /** `GET /api/v1/recipes/{id}` — fetch one recipe (owner, or any public recipe). */
    @Get(':id')
    public async getById(
        @OwnerId() ownerId: string,
        @Param('id', ParseUUIDPipe) id: string,
        // Forwarded so the food service authorizes the nutrition read AS this user (U10). Omitting it
        // degrades every recipe to nutrition-absent, which is indistinguishable from a food outage.
        @CallerBearerToken() caller: CallerToken | undefined,
    ): Promise<RecipeResponse> {
        // The impact read rides in parallel with the domain read (the `viewerRating` shape one layer
        // up): a Promise.all rejection is the domain read's own 404/403, and the counts merge only
        // onto a response the caller was authorized to receive — so the visibility boundary is
        // inherited, never re-derived. Composed HERE, not in `RecipesService.getById`, for the same
        // reason capture is (below): the service method is also an internal authorization helper with
        // six non-view call sites that must not pay — or serve — analytics.
        const [response, impact] = await Promise.all([
            this.recipesService.getById(ownerId, id, caller),
            this.analytics.readImpactSignals(id),
        ]);

        // ⛔ View capture lives at THIS handler, deliberately not in `RecipesService.getById` (analytics
        // plan U3): the service method doubles as an internal authorization helper with six non-view
        // call sites (photos ×2, versions ×3, ratings ×1) — capturing there would count every photo
        // upload and version restore as a view, permanently inflating the lifetime counts 015 consumes.
        // After the await, so a refused read (404/403) is never a view. Fire-and-forget: never awaited.
        this.analytics.capture({ type: 'recipe_viewed', userId: ownerId, recipeId: id });

        // Absent impact means UNKNOWN (the read degraded) — the field is omitted, never zeroed.
        return impact === undefined ? response : { ...response, impact };
    }

    /** `PATCH /api/v1/recipes/{id}` — update a recipe the caller owns (optimistic concurrency). */
    @Patch(':id')
    @WriteRateLimit()
    public async update(
        @CurrentPrincipal() principal: Principal,
        @Param('id', ParseUUIDPipe) id: string,
        @Body() body: UpdateRecipeDto,
    ): Promise<RecipeResponse> {
        return this.recipesService.update(principal, id, body);
    }

    /** `DELETE /api/v1/recipes/{id}` — soft-delete (tombstone) a recipe the caller owns. */
    @Delete(':id')
    @HttpCode(HttpStatus.NO_CONTENT)
    @WriteRateLimit()
    public async remove(@OwnerId() ownerId: string, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
        await this.recipesService.delete(ownerId, id);
    }

    /** `POST /api/v1/recipes/{id}/clone` — clone a recipe (public, or the caller's own) into a new owned recipe. */
    @Post(':id/clone')
    @HttpCode(HttpStatus.CREATED)
    @WriteRateLimit()
    public async clone(
        @CurrentPrincipal() principal: Principal,
        @Param('id', ParseUUIDPipe) id: string,
        @Body() _body: CloneRecipeDto,
    ): Promise<RecipeResponse> {
        return this.recipesService.clone(principal, id);
    }

    /** `PATCH /api/v1/recipes/{id}/visibility` — set visibility (C-004 policy, gated on premium + provenance). */
    @Patch(':id/visibility')
    @WriteRateLimit()
    public async setVisibility(
        @CurrentPrincipal() principal: Principal,
        @Param('id', ParseUUIDPipe) id: string,
        @Body() body: SetVisibilityDto,
    ): Promise<RecipeResponse> {
        return this.recipesService.setVisibility(principal, id, body.visibility);
    }
}
