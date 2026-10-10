/**
 * T029 — `IngredientsController`: the `/api/v1/ingredients` HTTP surface (US1 MVP + async resolution).
 *
 * All endpoints are authenticated behind the fail-closed Clerk `AuthMiddleware`. The `@OwnerId()`
 * decorator resolves the verified caller ULID from `req.principal` and fails closed with `401` when it is
 * absent (route escaped auth) — here it is used PURELY as an authentication assertion: the shared
 * `ingredients` catalog is intentionally ownerless (data-model R5), so no endpoint keys on the caller, but
 * every one still proves the caller is authenticated exactly the way the sibling controllers (recipes,
 * ratings, account) do. Bodies are validated by the controller-scoped `ZodValidationPipe` against the DTOs in
 * `dto/`, which ARE the authored wire contract (`ingredients.schema.ts`) rather than a second set of
 * `class-validator` rules beside it — CODING_STANDARDS §15.2. Unknown keys are stripped, so a stray/spoofed
 * field never reaches the service:
 *
 *   - `GET /api/v1/ingredients/search?q=&limit=` — food's catalog hits that already have a binding the caller
 *     may see (`200` → `Ingredient[]`). A missing/blank `q` is a `400`; food not answering is a `502`.
 *   - `POST /api/v1/ingredients` `{ name }` — create a freeform (user-entered) ingredient (`201` →
 *     `Ingredient`). A missing/blank/over-long name is a `400` (via {@link CreateIngredientDto}).
 *   - `POST /api/v1/ingredients/by-name` `{ name }` — add an unknown food by name through the source-agnostic
 *     food service (data-model R5): persists a food-backed catalog row and returns it (`202` → `Ingredient`)
 *     with its NON-terminal `foodResolutionStatus` (`PENDING` / `UNRESOLVED`). `202 Accepted` (not `201`) is
 *     deliberate: the ingredient ROW is created synchronously, but the meaningful work — nutrition resolution
 *     of the linked food — is asynchronous and NOT complete when this returns, so the caller must poll
 *     `GET :id/status` (or disambiguate an `UNRESOLVED` row). The status code is the caller's signal to poll,
 *     distinct from the synchronous `201` freeform create; the body's `foodResolutionStatus` is authoritative.
 *     A missing/blank/over-long name is a `400`. This is the ENTRY POINT of the async-resolution vertical
 *     (R5 / FR-007): `addByName` → `PENDING` (poll → `RESOLVED`) | `UNRESOLVED` (disambiguate) | terminal
 *     (`NOT_FOUND` / `FAILED`, freeform fallback).
 *   - `GET /api/v1/ingredients/{id}/status` — poll a food-backed ingredient's async resolution (data-model
 *     R5): re-reads the food service, persists the current status (and golden-record nutrition on
 *     `RESOLVED`), and returns the refreshed `Ingredient`. A missing ingredient is a `404`. This is a
 *     read from the caller's view (idempotent, convergent) and carries the generous read limit so a
 *     client polling a `PENDING` food is never throttled into a false failure mid-resolution.
 *
 * Input is validated at the boundary and delegated to {@link IngredientsService}; domain errors are
 * surfaced via thrown `RecipeError`s mapped by the global `ApiExceptionFilter`.
 *
 * **Forwarded caller credential (issue #120).** Every route that reaches the food service also takes
 * `@CallerBearerToken()`: food verifies a Clerk token, so recipe calls it AS the authenticated user rather
 * than with a service credential. The decorator yields `undefined` when the request carried no bearer (the
 * non-production dev-auth bypass) and the ingredient paths degrade rather than substitute a credential — see
 * `auth/CallerToken.ts` for why the credential is an opaque value object and never a `string`. `POST /` takes
 * no credential because it makes no cross-service call.
 *
 * @implements FR-007 FR-007a FR-047
 */
import {
    BadRequestException,
    Body,
    Controller,
    Get,
    Header,
    HttpCode,
    HttpStatus,
    Inject,
    Param,
    ParseUUIDPipe,
    Post,
    Query,
    UsePipes,
} from '@nestjs/common';
import { ZodValidationPipe } from 'nestjs-zod';
import type { Ingredient } from '@kitchensink/recipe-core';

import { SkipErasureLock } from '../account/skipErasureLock.decorator.js';
import { CallerBearerToken } from '../auth/CallerToken.decorator.js';
import type { CallerToken } from '../auth/CallerToken.js';
import { OwnerId } from '../auth/currentPrincipal.decorator.js';
import { apiError } from '../common/apiError.js';
import { canonicalIngredientName, type CanonicalIngredientName } from './domain/ingredientName.js';
import { IngredientsService } from './ingredients.service.js';
import type { FoodReferencesResponse } from './ingredients.schema.js';
import type { IngredientFoodNutritionResponse } from './ingredients.schema.js';
import { AddIngredientByFoodDto } from './dto/addIngredientByFood.dto.js';
import { AddIngredientByFoodVariantDto } from './dto/addIngredientByFoodVariant.dto.js';
import { CreateIngredientDto } from './dto/createIngredient.dto.js';
import { IngredientFoodNutritionDto } from './dto/ingredientFoodNutrition.dto.js';
import { IngredientNutritionReader } from './ingredientNutrition.reader.js';
import { SearchRateLimit, WriteRateLimit } from '../common/throttle/throttle.decorators.js';

/** Parse the optional `limit` query param into a number (the DAL clamps it into `[1, 50]`, default 10). */
function parseLimit(raw: string | undefined): number | undefined {
    if (raw === undefined) {
        return undefined;
    }

    const parsed = Number(raw);

    if (!Number.isFinite(parsed)) {
        throw new BadRequestException('limit must be a number');
    }

    return parsed;
}

// Canonically served under the `/api/{version}/` prefix. The bare `v1/...` entry is a DEPRECATED ALIAS:
// `/v1/*` is live in production and held by consumers configured OUTSIDE this repo (the Clerk dashboard
// webhook URL) as well as already-shipped mobile builds and cached web bundles, whose endpoints were
// inlined at build time. Removing it REQUIRES updating the Clerk dashboard first — see ADR-0011.
@Controller(['api/v1/ingredients', 'v1/ingredients'])
@UsePipes(ZodValidationPipe)
export class IngredientsController {
    public constructor(
        private readonly ingredients: IngredientsService,
        /** The batch food nutrition read (plan 002 U9): a read, beside the catalog it reads about. */
        @Inject(IngredientNutritionReader) private readonly foodNutrition: Pick<IngredientNutritionReader, 'read'>,
    ) {}

    /**
     * `GET /api/v1/ingredients/search` — the foods among food's catalog hits that already have a binding the
     * caller may see, named from food (plan 002, 0051). Every result carries its `foodId`, which the recipe
     * filter keys on (R45).
     *
     * @param ownerId - The verified caller ULID; scopes private bindings to their author (R20).
     * @param caller - The caller's own bearer, forwarded to the food service (see the class doc).
     * @param q - The name query (required, non-blank).
     * @param limit - Optional max hits (1–50, default 10).
     * @returns The bound foods, in food's rank order.
     * @throws {BadRequestException} (→ 400) when `q` is missing/blank or `limit` is non-numeric.
     */
    @Get('search')
    @SearchRateLimit()
    public async search(
        @OwnerId() ownerId: string,
        @CallerBearerToken() caller: CallerToken | undefined,
        @Query('q') q?: string,
        @Query('limit') limit?: string,
    ): Promise<Ingredient[]> {
        const query = (q ?? '').trim();

        if (query.length === 0) {
            throw new BadRequestException('q is required');
        }

        // R20 (plan U11): the caller's identity scopes private-food bindings into (only) their own results.
        return this.ingredients.search(caller, query, ownerId, parseLimit(limit));
    }

    /**
     * `POST /api/v1/ingredients` — create a freeform (user-entered) ingredient.
     *
     * @param _ownerId - The verified caller ULID; an auth assertion only (resolving it fails closed with `401`).
     * @param body - `{ name }` (non-blank, ≤120 chars), validated by {@link CreateIngredientDto}.
     * @returns The created (or deduped) freeform ingredient.
     */
    @Post()
    @HttpCode(HttpStatus.CREATED)
    @WriteRateLimit()
    public async create(@OwnerId() _ownerId: string, @Body() body: CreateIngredientDto): Promise<Ingredient> {
        return this.ingredients.createFreeform(this.visibleName(body.name));
    }

    /**
     * `POST /api/v1/ingredients/by-name` — add an unknown food by name through the source-agnostic food service.
     *
     * The ENTRY POINT of the async food-resolution vertical (data-model R5 / FR-007). The food service returns
     * a NON-terminal status (`PENDING` / `UNRESOLVED`); we persist a food-backed catalog row (deduped on the
     * opaque `food_id`) and return it immediately so the picker renders a "nutrition pending" state and either
     * polls `GET :id/status` to `RESOLVED` or disambiguates an `UNRESOLVED` row.
     *
     * Returns `202 Accepted` — NOT `201`: the row is created synchronously, but nutrition resolution proceeds
     * asynchronously and is incomplete when this returns, so the caller MUST poll. `202` is that poll signal
     * (distinct from the synchronous `201` freeform create); the body's `foodResolutionStatus` is authoritative.
     * A mutation (food-service add + DB write) → the write rate limit.
     *
     * ⚠️ **`ownerId` is no longer an auth assertion ALONE on this route** (plan U10). It is passed to the
     * service, where the resolution cascade uses it so a curated mapping the CALLER wrote outranks the global
     * one for them. Every other route here still takes it purely as the "this request is authenticated"
     * proof the shared, ownerless catalog otherwise has no use for.
     *
     * @param ownerId - The verified caller ULID: the authentication assertion, AND the identity whose own
     *   curated mappings take precedence in the cascade.
     * @param caller - The caller's own bearer, forwarded to the food service (see the class doc).
     * @param body - `{ name }` (non-blank, ≤120 chars), validated by {@link CreateIngredientDto}.
     * @returns The created (or deduped) food-backed ingredient with its current non-terminal resolution status.
     */
    @Post('by-name')
    @HttpCode(HttpStatus.ACCEPTED)
    @WriteRateLimit()
    public async addByName(
        @OwnerId() ownerId: string,
        @CallerBearerToken() caller: CallerToken | undefined,
        @Body() body: CreateIngredientDto,
    ): Promise<Ingredient> {
        return this.ingredients.addByName(caller, this.visibleName(body.name), ownerId);
    }

    /**
     * `POST /api/v1/ingredients/by-food` — bind a food the cook picked from food's search (ADR-0046) as a
     * food-backed ingredient, WITH its nutrition already backfilled.
     *
     * Returns **`200 OK`, not `202`** — the deliberate contrast with `by-name`. `by-name` is `202` because the
     * meaningful work (resolving an unknown food) is genuinely asynchronous and incomplete when it returns.
     * Here the food is an already-`RESOLVED` golden record, so the row is created AND its per-100g nutrition +
     * portions are written before the response: there is nothing to wait for, and telling the caller to poll
     * would be a lie. In the anomalous case where the food is unexpectedly still `PENDING`/`UNRESOLVED` and a
     * row already exists, that status comes back in the body and the caller uses the SAME poll/disambiguate
     * machinery — `foodResolutionStatus` is authoritative, exactly as it is for `by-name`.
     *
     * A mutation (food-service read + DB write) → the write rate limit.
     *
     * @param ownerId - The verified caller ULID; a private food is bound only for its author, who owns the binding.
     * @param caller - The caller's own bearer, forwarded to the food service (see the class doc).
     * @param body - `{ foodId }` (non-blank, ≤64 chars), validated by {@link AddIngredientByFoodDto}. Any
     *   caller-supplied `name` is REFUSED with a `400` (it was stripped before GR-017 §17-c) — the display name
     *   comes from the food service, so a client that supplied one must learn it was not used.
     * @returns The food-backed ingredient with its golden-record nutrition.
     * @throws {RecipeError} `UNKNOWN_INGREDIENT` (→ 400) when the food cannot back an ingredient (unknown,
     *   terminal, mid-resolution, or nameless) and no row exists to advance.
     */
    @Post('by-food')
    @HttpCode(HttpStatus.OK)
    @WriteRateLimit()
    public async addByFood(
        @OwnerId() ownerId: string,
        @CallerBearerToken() caller: CallerToken | undefined,
        @Body() body: AddIngredientByFoodDto,
    ): Promise<Ingredient> {
        // U11/R20: the caller ULID rides along for the privacy capture — a private authored food admitted
        // here must land with `food_owner_id` set, or its NAME enters every user's local search.
        return this.ingredients.addByFoodId(caller, body.foodId, ownerId);
    }

    /**
     * `POST /api/v1/ingredients/by-food-variant` (curated U9, R20, R22) — bind a VARIANT the cook picked in the
     * details dialog. The same door as `by-food` for a variant ref: food's authorship-checked answer first, then
     * the binding of whatever food says the variant now is (its forward's live end).
     *
     * @param ownerId - The verified caller ULID.
     * @param caller - The caller's own bearer, forwarded to the food service.
     * @param body - `{ foodVariantId }`, validated by {@link AddIngredientByFoodVariantDto}.
     * @returns The bound ingredient: `foodId` its live root, `variant` its parts.
     * @throws {RecipeError} `UNKNOWN_INGREDIENT` (→ 400) when food will not let the variant be bound.
     * @throws {HttpException} `502 SOURCE_UNAVAILABLE` when food cannot be asked.
     */
    @Post('by-food-variant')
    @HttpCode(HttpStatus.OK)
    @WriteRateLimit()
    public async addByFoodVariant(
        @OwnerId() ownerId: string,
        @CallerBearerToken() caller: CallerToken | undefined,
        @Body() body: AddIngredientByFoodVariantDto,
    ): Promise<Ingredient> {
        return this.ingredients.addByFoodVariantId(caller, body.foodVariantId, ownerId);
    }

    /**
     * `POST /api/v1/ingredients/food-nutrition` (plan 002 U9, R31) — per-100 g nutrition for a batch of food refs,
     * bound to a recipe or not. Each distinct ref answers `found`, `absent` or `unavailable`; another user's private
     * food answers exactly as an unknown id does (R46, R50).
     *
     * A sibling of `POST /api/v1/recipes/nutrition-batch`, not an extension of it: that route is keyed by recipe and
     * answers per serving, and this one is keyed by food and answers per 100 g.
     *
     * ⛔ POST for a READ, with `@SkipErasureLock()`, for the reasons `RecipesController.getNutritionBatch` states:
     * the answer varies by caller, and the erasure guard keys on the HTTP method. It creates nothing, so it answers
     * `200`, and it carries no throttle decorator, so it inherits the read limit. No shared cache may keep the
     * answer, so it says `private, no-store`.
     *
     * ⚠️ Declared BEFORE the `:id/*` routes — Nest matches in declaration order.
     *
     * @param ownerId - The verified caller ULID, compared with each private binding's owner.
     * @param caller - The caller's own bearer, forwarded so food authorizes the read as this user.
     * @param body - `{ refs }`, validated by {@link IngredientFoodNutritionDto}.
     * @returns One entry per distinct ref, in order of first appearance.
     */
    @Post('food-nutrition')
    @HttpCode(HttpStatus.OK)
    @SkipErasureLock()
    @Header('Cache-Control', 'private, no-store')
    public async getFoodNutrition(
        @OwnerId() ownerId: string,
        @CallerBearerToken() caller: CallerToken | undefined,
        @Body() body: IngredientFoodNutritionDto,
    ): Promise<IngredientFoodNutritionResponse> {
        return { entries: await this.foodNutrition.read(ownerId, caller, body.refs) };
    }

    /**
     * `GET /api/v1/ingredients/food-references/:foodId` (plan U18, R22) — how many live recipes reference
     * this food, plus the CALLER's own referencing recipe ids. Consumed by the food service's authored
     * DELETE flow with the caller's forwarded bearer; the count spans all users, the ids never do.
     *
     * ⚠️ Declared BEFORE the `:id/*` routes — Nest matches in declaration order.
     */
    @Get('food-references/:foodId')
    public async foodReferences(
        @OwnerId() ownerId: string,
        @Param('foodId') foodId: string,
    ): Promise<FoodReferencesResponse> {
        return this.ingredients.foodReferences(ownerId, foodId);
    }

    /**
     * `GET /api/v1/ingredients/{id}/status` — poll a food-backed ingredient's async resolution (data-model R5).
     *
     * Re-reads the food service, persists the current status (and golden-record nutrition on `RESOLVED`),
     * and returns the refreshed ingredient. A freeform ingredient (no linked food) is returned unchanged.
     * NO throttle decorator: this GET is a client-driven poll, so it inherits the generous read limit — the
     * tighter write/search limits would 429 a caller mid-resolution.
     *
     * @param ownerId - The verified caller ULID; a private food that food-service returns is admitted only for its author.
     * @param caller - The caller's own bearer, forwarded to the food service (see the class doc).
     * @param id - The 001 ingredient id (UUID; a malformed id is a `400` via `ParseUUIDPipe`).
     * @returns The refreshed ingredient (with its current `foodResolutionStatus`).
     * @throws {RecipeError} `RECIPE_NOT_FOUND` (→ 404) when no such ingredient exists.
     */
    @Get(':id/status')
    public async status(
        @OwnerId() ownerId: string,
        @CallerBearerToken() caller: CallerToken | undefined,
        @Param('id', ParseUUIDPipe) id: string,
    ): Promise<Ingredient> {
        // The ULID rides along so a refresh re-captures the privacy fact (U11).
        return this.ingredients.refreshStatus(caller, id, ownerId);
    }

    /**
     * Reduce a caller's name to the canonical form the shared catalog stores, or reject it. THE parse
     * boundary for every name this API accepts (plan U3).
     *
     * ⛔ **HERE rather than in the published contract**, mirroring `foods.controller.ts`'s sibling method for
     * the sibling ownerless catalog. This is server-side NORMALIZATION, and `contract-gen` states the rule
     * directly: it "is not part of the shape a caller must satisfy — move it out of the published schema and
     * into the handler." Two further reasons this is not a style preference: an authored `*.schema.ts` that
     * imported the rule would drag the whole text of `recipe-core/src/foodName.ts` into the contract
     * fingerprint, so a future Unicode-hygiene fix with no wire projection would move `CONTRACT_HASH`; and
     * unlike `.trim()`, NFKC can EXPAND a string, so the published `maxLength: 120` would begin rejecting
     * bodies it documents as valid.
     *
     * The `400` is the SAME `VALIDATION_FAILED` envelope the validation pipe raises for `""`, because a name
     * of U+200B ZERO WIDTH SPACEs is the same condition written in characters a caller cannot see —
     * `String#trim` does not remove format characters, so the pipe's `min(1)` passes it and, before this, a
     * blank name was stored in a catalog every user searches.
     *
     * @param raw - The name from the validated request body (already trimmed and length-bounded).
     * @returns The parsed, branded canonical name.
     * @throws {HttpException} `VALIDATION_FAILED` (→ 400) when nothing visible survives canonicalization.
     */
    private visibleName(raw: string): CanonicalIngredientName {
        const name = canonicalIngredientName(raw);

        if (name === undefined) {
            throw apiError('VALIDATION_FAILED', 'name must contain at least one visible character');
        }

        return name;
    }
}
