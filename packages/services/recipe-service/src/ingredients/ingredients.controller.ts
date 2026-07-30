/**
 * T029 — `IngredientsController`: the `/v1/ingredients` HTTP surface (US1 MVP + async resolution).
 *
 * All endpoints are authenticated behind the fail-closed Clerk `AuthMiddleware`. The `@OwnerId()`
 * decorator resolves the verified caller ULID from `req.principal` and fails closed with `401` when it is
 * absent (route escaped auth) — here it is used PURELY as an authentication assertion: the shared
 * `ingredients` catalog is intentionally ownerless (data-model R5), so no endpoint keys on the caller, but
 * every one still proves the caller is authenticated exactly the way the sibling controllers (recipes,
 * ratings, account) do. Bodies are validated by class-validator DTOs under the same controller-scoped
 * `ValidationPipe` (`transform + whitelist`) the siblings use, so a stray/spoofed field is stripped:
 *
 *   - `GET /v1/ingredients/search?q=&limit=` — fuzzy + full-text autocomplete over the shared catalog
 *     (`200` → `Ingredient[]`). A missing/blank `q` is a `400`.
 *   - `POST /v1/ingredients` `{ name }` — create a freeform (user-entered) ingredient (`201` →
 *     `Ingredient`). A missing/blank/over-long name is a `400` (via {@link CreateIngredientDto}).
 *   - `POST /v1/ingredients/by-name` `{ name }` — add an unknown food by name through the source-agnostic
 *     food service (data-model R5): persists a food-backed catalog row and returns it (`202` → `Ingredient`)
 *     with its NON-terminal `foodResolutionStatus` (`PENDING` / `UNRESOLVED`). `202 Accepted` (not `201`) is
 *     deliberate: the ingredient ROW is created synchronously, but the meaningful work — nutrition resolution
 *     of the linked food — is asynchronous and NOT complete when this returns, so the caller must poll
 *     `GET :id/status` (or disambiguate an `UNRESOLVED` row). The status code is the caller's signal to poll,
 *     distinct from the synchronous `201` freeform create; the body's `foodResolutionStatus` is authoritative.
 *     A missing/blank/over-long name is a `400`. This is the ENTRY POINT of the async-resolution vertical
 *     (R5 / FR-007): `addByName` → `PENDING` (poll → `RESOLVED`) | `UNRESOLVED` (disambiguate) | terminal
 *     (`NOT_FOUND` / `FAILED`, freeform fallback).
 *   - `GET /v1/ingredients/{id}/status` — poll a food-backed ingredient's async resolution (data-model
 *     R5): re-reads the food service, persists the current status (and golden-record nutrition on
 *     `RESOLVED`), and returns the refreshed `Ingredient`. A missing ingredient is a `404`. This is a
 *     read from the caller's view (idempotent, convergent) and carries the generous read limit so a
 *     client polling a `PENDING` food is never throttled into a false failure mid-resolution.
 *   - `GET /v1/ingredients/{id}/candidates` — the disambiguation candidate set for an `UNRESOLVED`
 *     food-backed ingredient (`200` → `Candidate[]`; empty for a freeform or non-`UNRESOLVED` row).
 *   - `POST /v1/ingredients/{id}/resolve` `{ candidateIds }` — resolve an `UNRESOLVED` ingredient from a
 *     candidate pick, then re-poll so the newly-`RESOLVED` nutrition is persisted (`200` → `Ingredient`).
 *     A missing/empty/oversized `candidateIds` is a `400`; a missing ingredient is a `404`.
 *
 * Input is validated at the boundary and delegated to {@link IngredientsService}; domain errors are
 * surfaced via thrown `RecipeError`s mapped by the global `ApiExceptionFilter`.
 *
 * **Forwarded caller credential (issue #120).** Every route that reaches the food service also takes
 * `@CallerBearerToken()`: food verifies a Clerk token, so recipe calls it AS the authenticated user rather
 * than with a service credential. The decorator yields `undefined` when the request carried no bearer (the
 * non-production dev-auth bypass) and the ingredient paths degrade rather than substitute a credential — see
 * `auth/caller-token.ts` for why the credential is an opaque value object and never a `string`. The
 * local-only routes (`/search`, `POST /`) take no credential because they make no cross-service call.
 *
 * @implements FR-007 FR-007a FR-047
 */
import {
    BadRequestException,
    Body,
    Controller,
    Get,
    HttpCode,
    HttpStatus,
    Param,
    ParseUUIDPipe,
    Post,
    Query,
    UsePipes,
    ValidationPipe,
} from '@nestjs/common';
import type { Ingredient } from '@kitchensink/recipe-core';
import type { CandidateView } from '@kitchensink/food-service-client';

import { CallerBearerToken } from '../auth/caller-token.decorator.js';
import type { CallerToken } from '../auth/caller-token.js';
import { OwnerId } from '../auth/current-principal.decorator.js';
import { IngredientsService } from './ingredients.service.js';
import type { IngredientSuggestions } from './ingredient-suggestion.js';
import { AddIngredientByFoodDto } from './dto/add-ingredient-by-food.dto.js';
import { CreateIngredientDto } from './dto/create-ingredient.dto.js';
import { ResolveIngredientDto } from './dto/resolve-ingredient.dto.js';
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

@Controller('v1/ingredients')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: false }))
export class IngredientsController {
    public constructor(private readonly ingredients: IngredientsService) {}

    /**
     * `GET /v1/ingredients/search` — fuzzy + FTS autocomplete over the shared ingredient catalog.
     *
     * @param _ownerId - The verified caller ULID (resolved by `@OwnerId()`, purely an auth assertion — the
     *   catalog is ownerless, so it is not used to scope the query, but its resolution guarantees the caller
     *   is authenticated and fails closed with `401` otherwise).
     * @param q - The name query (required, non-blank).
     * @param limit - Optional max hits (1–50, default 10).
     * @returns Ranked catalog ingredients.
     * @throws {BadRequestException} (→ 400) when `q` is missing/blank or `limit` is non-numeric.
     */
    @Get('search')
    @SearchRateLimit()
    public async search(
        @OwnerId() _ownerId: string,
        @Query('q') q?: string,
        @Query('limit') limit?: string,
    ): Promise<Ingredient[]> {
        const query = (q ?? '').trim();

        if (query.length === 0) {
            throw new BadRequestException('q is required');
        }

        return this.ingredients.search(query, parseLimit(limit));
    }

    /**
     * `GET /v1/ingredients/suggest` — the Stage-2 BLENDED typeahead: the shared `ingredients` catalog **plus**
     * the food-service golden catalog, deduped on `food_id` and sectioned by provenance.
     *
     * **Why this is a separate route from `/search`, not a flag on it.** They are different reads with
     * different consumers and different correctness rules — the same knowledge is not being duplicated:
     *  - `/search` returns `Ingredient[]`, every element a real catalog row whose `id` is a valid
     *    `recipe_ingredients.ingredient_id`. Its other consumer is the recipe-SEARCH ingredient filter, where
     *    a result id becomes an `ingredientIds` filter value — a not-yet-admitted food would be meaningless
     *    there (nothing could match it), so blending into `/search` would be wrong, not merely shape-breaking.
     *  - `/suggest` returns a DISCRIMINATED UNION, because a catalog hit has no ingredient id and no nutrition
     *    and must be admitted (`POST by-food`) before it can go on a recipe line.
     * A query param that switches the RESPONSE TYPE would put two contracts on one route and leave every
     * client narrowing by hand; a separate route keeps each contract single-shaped, and leaves `/search`'s
     * existing wire contract (and its clients) untouched.
     *
     * F2: never fails because of the food service — a slow/unavailable catalog yields the local section plus
     * `catalogAvailability: 'unavailable'`. The response's `catalogAvailability` is how the picker tells the
     * user the catalog is degraded instead of silently showing fewer results.
     *
     * @param _ownerId - The verified caller ULID (auth assertion only; see {@link IngredientsController.search}).
     * @param caller - The caller's own bearer, forwarded to the food service (see the class doc).
     * @param q - The name query (required, non-blank).
     * @param limit - Optional max hits PER SECTION (1–50, default 10).
     * @returns The blended suggestions plus whether the food catalog contributed.
     * @throws {BadRequestException} (→ 400) when `q` is missing/blank or `limit` is non-numeric.
     */
    @Get('suggest')
    @SearchRateLimit()
    public async suggest(
        @OwnerId() _ownerId: string,
        @CallerBearerToken() caller: CallerToken | undefined,
        @Query('q') q?: string,
        @Query('limit') limit?: string,
    ): Promise<IngredientSuggestions> {
        const query = (q ?? '').trim();

        if (query.length === 0) {
            throw new BadRequestException('q is required');
        }

        return this.ingredients.suggest(caller, query, parseLimit(limit));
    }

    /**
     * `POST /v1/ingredients` — create a freeform (user-entered) ingredient.
     *
     * @param _ownerId - The verified caller ULID (auth assertion only; see {@link IngredientsController.search}).
     * @param body - `{ name }` (non-blank, ≤120 chars), validated by {@link CreateIngredientDto}.
     * @returns The created (or deduped) freeform ingredient.
     */
    @Post()
    @HttpCode(HttpStatus.CREATED)
    @WriteRateLimit()
    public async create(@OwnerId() _ownerId: string, @Body() body: CreateIngredientDto): Promise<Ingredient> {
        return this.ingredients.createFreeform(body.name);
    }

    /**
     * `POST /v1/ingredients/by-name` — add an unknown food by name through the source-agnostic food service.
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
     * @param _ownerId - The verified caller ULID (auth assertion only; see {@link IngredientsController.search}).
     * @param caller - The caller's own bearer, forwarded to the food service (see the class doc).
     * @param body - `{ name }` (non-blank, ≤120 chars), validated by {@link CreateIngredientDto}.
     * @returns The created (or deduped) food-backed ingredient with its current non-terminal resolution status.
     */
    @Post('by-name')
    @HttpCode(HttpStatus.ACCEPTED)
    @WriteRateLimit()
    public async addByName(
        @OwnerId() _ownerId: string,
        @CallerBearerToken() caller: CallerToken | undefined,
        @Body() body: CreateIngredientDto,
    ): Promise<Ingredient> {
        return this.ingredients.addByName(caller, body.name);
    }

    /**
     * `POST /v1/ingredients/by-food` — Stage 2 pick: admit a `catalog` suggestion from
     * {@link IngredientsController.suggest} as a food-backed ingredient, WITH its nutrition already backfilled.
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
     * @param _ownerId - The verified caller ULID (auth assertion only; see {@link IngredientsController.search}).
     * @param caller - The caller's own bearer, forwarded to the food service (see the class doc).
     * @param body - `{ foodId }` (non-blank, ≤64 chars), validated by {@link AddIngredientByFoodDto}. Any
     *   caller-supplied `name` is stripped by the whitelist — the display name comes from the food service.
     * @returns The food-backed ingredient with its golden-record nutrition.
     * @throws {RecipeError} `UNKNOWN_INGREDIENT` (→ 400) when the food cannot back an ingredient (unknown,
     *   terminal, mid-resolution, or nameless) and no row exists to advance.
     */
    @Post('by-food')
    @HttpCode(HttpStatus.OK)
    @WriteRateLimit()
    public async addByFood(
        @OwnerId() _ownerId: string,
        @CallerBearerToken() caller: CallerToken | undefined,
        @Body() body: AddIngredientByFoodDto,
    ): Promise<Ingredient> {
        return this.ingredients.addByFoodId(caller, body.foodId);
    }

    /**
     * `GET /v1/ingredients/{id}/status` — poll a food-backed ingredient's async resolution (data-model R5).
     *
     * Re-reads the food service, persists the current status (and golden-record nutrition on `RESOLVED`),
     * and returns the refreshed ingredient. A freeform ingredient (no linked food) is returned unchanged.
     * NO throttle decorator: this GET is a client-driven poll, so it inherits the generous read limit — the
     * tighter write/search limits would 429 a caller mid-resolution.
     *
     * @param _ownerId - The verified caller ULID (auth assertion only; see {@link IngredientsController.search}).
     * @param caller - The caller's own bearer, forwarded to the food service (see the class doc).
     * @param id - The 001 ingredient id (UUID; a malformed id is a `400` via `ParseUUIDPipe`).
     * @returns The refreshed ingredient (with its current `foodResolutionStatus`).
     * @throws {RecipeError} `RECIPE_NOT_FOUND` (→ 404) when no such ingredient exists.
     */
    @Get(':id/status')
    public async status(
        @OwnerId() _ownerId: string,
        @CallerBearerToken() caller: CallerToken | undefined,
        @Param('id', ParseUUIDPipe) id: string,
    ): Promise<Ingredient> {
        return this.ingredients.refreshStatus(caller, id);
    }

    /**
     * `GET /v1/ingredients/{id}/candidates` — the disambiguation candidate set for an `UNRESOLVED`
     * food-backed ingredient. A read (no throttle decorator). Empty for a freeform or non-`UNRESOLVED` row.
     *
     * @param _ownerId - The verified caller ULID (auth assertion only; see {@link IngredientsController.search}).
     * @param caller - The caller's own bearer, forwarded to the food service (see the class doc).
     * @param id - The 001 ingredient id (UUID).
     * @returns The (non-expired) candidate set the caller can pick from to resolve the ingredient.
     * @throws {RecipeError} `RECIPE_NOT_FOUND` (→ 404) when no such ingredient exists.
     */
    @Get(':id/candidates')
    public async candidates(
        @OwnerId() _ownerId: string,
        @CallerBearerToken() caller: CallerToken | undefined,
        @Param('id', ParseUUIDPipe) id: string,
    ): Promise<readonly CandidateView[]> {
        return this.ingredients.getCandidates(caller, id);
    }

    /**
     * `POST /v1/ingredients/{id}/resolve` — resolve an `UNRESOLVED` food-backed ingredient from a candidate
     * pick, then re-poll so the newly-`RESOLVED` golden-record nutrition is persisted. Returns `200` with
     * the resolved ingredient (an update, not a creation). A mutation → the write rate limit.
     *
     * @param _ownerId - The verified caller ULID (auth assertion only; see {@link IngredientsController.search}).
     * @param caller - The caller's own bearer, forwarded to the food service (see the class doc).
     * @param id - The 001 ingredient id (UUID).
     * @param body - `{ candidateIds }` (non-empty, ≤20, each non-blank), validated by {@link ResolveIngredientDto}.
     * @returns The refreshed, resolved ingredient.
     * @throws {RecipeError} `RECIPE_NOT_FOUND` (→ 404) when no such ingredient exists.
     */
    @Post(':id/resolve')
    @HttpCode(HttpStatus.OK)
    @WriteRateLimit()
    public async resolve(
        @OwnerId() _ownerId: string,
        @CallerBearerToken() caller: CallerToken | undefined,
        @Param('id', ParseUUIDPipe) id: string,
        @Body() body: ResolveIngredientDto,
    ): Promise<Ingredient> {
        return this.ingredients.resolve(caller, id, body.candidateIds);
    }
}
