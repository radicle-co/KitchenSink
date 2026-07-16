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
 * @implements FR-007 FR-007a
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

import { OwnerId } from '../auth/current-principal.decorator.js';
import { IngredientsService } from './ingredients.service.js';
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
     * @param body - `{ name }` (non-blank, ≤120 chars), validated by {@link CreateIngredientDto}.
     * @returns The created (or deduped) food-backed ingredient with its current non-terminal resolution status.
     */
    @Post('by-name')
    @HttpCode(HttpStatus.ACCEPTED)
    @WriteRateLimit()
    public async addByName(@OwnerId() _ownerId: string, @Body() body: CreateIngredientDto): Promise<Ingredient> {
        return this.ingredients.addByName(body.name);
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
     * @param id - The 001 ingredient id (UUID; a malformed id is a `400` via `ParseUUIDPipe`).
     * @returns The refreshed ingredient (with its current `foodResolutionStatus`).
     * @throws {RecipeError} `RECIPE_NOT_FOUND` (→ 404) when no such ingredient exists.
     */
    @Get(':id/status')
    public async status(@OwnerId() _ownerId: string, @Param('id', ParseUUIDPipe) id: string): Promise<Ingredient> {
        return this.ingredients.refreshStatus(id);
    }

    /**
     * `GET /v1/ingredients/{id}/candidates` — the disambiguation candidate set for an `UNRESOLVED`
     * food-backed ingredient. A read (no throttle decorator). Empty for a freeform or non-`UNRESOLVED` row.
     *
     * @param _ownerId - The verified caller ULID (auth assertion only; see {@link IngredientsController.search}).
     * @param id - The 001 ingredient id (UUID).
     * @returns The (non-expired) candidate set the caller can pick from to resolve the ingredient.
     * @throws {RecipeError} `RECIPE_NOT_FOUND` (→ 404) when no such ingredient exists.
     */
    @Get(':id/candidates')
    public async candidates(
        @OwnerId() _ownerId: string,
        @Param('id', ParseUUIDPipe) id: string,
    ): Promise<readonly CandidateView[]> {
        return this.ingredients.getCandidates(id);
    }

    /**
     * `POST /v1/ingredients/{id}/resolve` — resolve an `UNRESOLVED` food-backed ingredient from a candidate
     * pick, then re-poll so the newly-`RESOLVED` golden-record nutrition is persisted. Returns `200` with
     * the resolved ingredient (an update, not a creation). A mutation → the write rate limit.
     *
     * @param _ownerId - The verified caller ULID (auth assertion only; see {@link IngredientsController.search}).
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
        @Param('id', ParseUUIDPipe) id: string,
        @Body() body: ResolveIngredientDto,
    ): Promise<Ingredient> {
        return this.ingredients.resolve(id, body.candidateIds);
    }
}
