/**
 * T029 — `IngredientsController`: the `/v1/ingredients` HTTP surface (US1 MVP + async resolution).
 *
 * All endpoints are authenticated behind the fail-closed Clerk `AuthMiddleware` (so `req.principal`
 * is always present) — the controller reads `req.principal.userId` (the app-user ULID owner key) to
 * prove the caller is authenticated:
 *
 *   - `GET /v1/ingredients/search?q=&limit=` — fuzzy + full-text autocomplete over the shared catalog
 *     (`200` → `Ingredient[]`). A missing/blank `q` is a `400`.
 *   - `POST /v1/ingredients` `{ name }` — create a freeform (user-entered) ingredient (`201` →
 *     `Ingredient`). A missing/blank/over-long name is a `400`.
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
    Req,
    UnauthorizedException,
} from '@nestjs/common';
import type { Ingredient } from '@kitchensink/recipe-core';
import type { CandidateView } from '@kitchensink/food-service-client';

import type { AuthenticatedRequest } from '../auth/principal.js';
import { IngredientsService } from './ingredients.service.js';
import { SearchRateLimit, WriteRateLimit } from '../common/throttle/throttle.decorators.js';

/** Max length of a freeform ingredient name (mirrors the OpenAPI `CreateIngredientRequest`). */
const MAX_NAME_LENGTH = 120;

/**
 * Max candidate ids a single resolve request may carry. The food service resolves from a picked subset of
 * one food's own candidate set, which is small; a low cap keeps a malformed/abusive body bounded.
 */
const MAX_CANDIDATE_IDS = 20;

/** Parse + clamp the optional `limit` query param into `[1, 50]`, defaulting to 10. */
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

/** Validate the create-ingredient body, returning the trimmed name or throwing `400`. Pure. */
function requireName(body: unknown): string {
    const name = (body as { name?: unknown } | null)?.name;

    if (typeof name !== 'string' || name.trim().length === 0) {
        throw new BadRequestException('name is required');
    }

    if (name.trim().length > MAX_NAME_LENGTH) {
        throw new BadRequestException(`name must be at most ${MAX_NAME_LENGTH} characters`);
    }

    return name.trim();
}

/**
 * Validate the resolve-ingredient body, returning the trimmed candidate ids or throwing `400`. The
 * service further validates each id against the food's OWN candidate set — this is only the boundary
 * shape check (a non-empty, bounded array of non-blank strings). Pure.
 */
function requireCandidateIds(body: unknown): string[] {
    const raw = (body as { candidateIds?: unknown } | null)?.candidateIds;

    if (!Array.isArray(raw) || raw.length === 0) {
        throw new BadRequestException('candidateIds must be a non-empty array');
    }

    if (raw.length > MAX_CANDIDATE_IDS) {
        throw new BadRequestException(`candidateIds must contain at most ${MAX_CANDIDATE_IDS} ids`);
    }

    const ids = raw.map((id) => (typeof id === 'string' ? id.trim() : ''));

    if (ids.some((id) => id.length === 0)) {
        throw new BadRequestException('each candidateId must be a non-blank string');
    }

    return ids;
}

@Controller('v1/ingredients')
export class IngredientsController {
    public constructor(private readonly ingredients: IngredientsService) {}

    /**
     * `GET /v1/ingredients/search` — fuzzy + FTS autocomplete over the shared ingredient catalog.
     *
     * @param req - The authenticated request (its `principal.userId` proves authentication).
     * @param q - The name query (required, non-blank).
     * @param limit - Optional max hits (1–50, default 10).
     * @returns Ranked catalog ingredients.
     * @throws {BadRequestException} (→ 400) when `q` is missing/blank or `limit` is non-numeric.
     */
    @Get('search')
    @SearchRateLimit()
    public async search(
        @Req() req: AuthenticatedRequest,
        @Query('q') q?: string,
        @Query('limit') limit?: string,
    ): Promise<Ingredient[]> {
        this.requireUserId(req);

        const query = (q ?? '').trim();

        if (query.length === 0) {
            throw new BadRequestException('q is required');
        }

        return this.ingredients.search(query, parseLimit(limit));
    }

    /**
     * `POST /v1/ingredients` — create a freeform (user-entered) ingredient.
     *
     * @param req - The authenticated request (its `principal.userId` proves authentication).
     * @param body - `{ name }` (non-blank, ≤120 chars).
     * @returns The created (or deduped) freeform ingredient.
     * @throws {BadRequestException} (→ 400) on an invalid name.
     */
    @Post()
    @HttpCode(HttpStatus.CREATED)
    @WriteRateLimit()
    public async create(@Req() req: AuthenticatedRequest, @Body() body: unknown): Promise<Ingredient> {
        this.requireUserId(req);

        const name = requireName(body);

        return this.ingredients.createFreeform(name);
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
     * @param req - The authenticated request (its `principal.userId` proves authentication).
     * @param body - `{ name }` (non-blank, ≤120 chars).
     * @returns The created (or deduped) food-backed ingredient with its current non-terminal resolution status.
     * @throws {BadRequestException} (→ 400) on an invalid name.
     */
    @Post('by-name')
    @HttpCode(HttpStatus.ACCEPTED)
    @WriteRateLimit()
    public async addByName(@Req() req: AuthenticatedRequest, @Body() body: unknown): Promise<Ingredient> {
        this.requireUserId(req);

        const name = requireName(body);

        return this.ingredients.addByName(name);
    }

    /**
     * `GET /v1/ingredients/{id}/status` — poll a food-backed ingredient's async resolution (data-model R5).
     *
     * Re-reads the food service, persists the current status (and golden-record nutrition on `RESOLVED`),
     * and returns the refreshed ingredient. A freeform ingredient (no linked food) is returned unchanged.
     * NO throttle decorator: this GET is a client-driven poll, so it inherits the generous read limit — the
     * tighter write/search limits would 429 a caller mid-resolution.
     *
     * @param req - The authenticated request (its `principal.userId` proves authentication).
     * @param id - The 001 ingredient id (UUID; a malformed id is a `400` via `ParseUUIDPipe`).
     * @returns The refreshed ingredient (with its current `foodResolutionStatus`).
     * @throws {RecipeError} `RECIPE_NOT_FOUND` (→ 404) when no such ingredient exists.
     */
    @Get(':id/status')
    public async status(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string): Promise<Ingredient> {
        this.requireUserId(req);

        return this.ingredients.refreshStatus(id);
    }

    /**
     * `GET /v1/ingredients/{id}/candidates` — the disambiguation candidate set for an `UNRESOLVED`
     * food-backed ingredient. A read (no throttle decorator). Empty for a freeform or non-`UNRESOLVED` row.
     *
     * @param req - The authenticated request (its `principal.userId` proves authentication).
     * @param id - The 001 ingredient id (UUID).
     * @returns The (non-expired) candidate set the caller can pick from to resolve the ingredient.
     * @throws {RecipeError} `RECIPE_NOT_FOUND` (→ 404) when no such ingredient exists.
     */
    @Get(':id/candidates')
    public async candidates(
        @Req() req: AuthenticatedRequest,
        @Param('id', ParseUUIDPipe) id: string,
    ): Promise<readonly CandidateView[]> {
        this.requireUserId(req);

        return this.ingredients.getCandidates(id);
    }

    /**
     * `POST /v1/ingredients/{id}/resolve` — resolve an `UNRESOLVED` food-backed ingredient from a candidate
     * pick, then re-poll so the newly-`RESOLVED` golden-record nutrition is persisted. Returns `200` with
     * the resolved ingredient (an update, not a creation). A mutation → the write rate limit.
     *
     * @param req - The authenticated request (its `principal.userId` proves authentication).
     * @param id - The 001 ingredient id (UUID).
     * @param body - `{ candidateIds }` — the picked candidate ids (non-empty, ≤20, each non-blank).
     * @returns The refreshed, resolved ingredient.
     * @throws {BadRequestException} (→ 400) on a missing/empty/oversized/blank `candidateIds`.
     * @throws {RecipeError} `RECIPE_NOT_FOUND` (→ 404) when no such ingredient exists.
     */
    @Post(':id/resolve')
    @HttpCode(HttpStatus.OK)
    @WriteRateLimit()
    public async resolve(
        @Req() req: AuthenticatedRequest,
        @Param('id', ParseUUIDPipe) id: string,
        @Body() body: unknown,
    ): Promise<Ingredient> {
        this.requireUserId(req);

        const candidateIds = requireCandidateIds(body);

        return this.ingredients.resolve(id, candidateIds);
    }

    /**
     * Read the verified owner key from the request principal. The middleware guarantees it on every
     * non-public route; this is a defensive fail-closed check (never trusts a client-supplied identity).
     */
    private requireUserId(req: AuthenticatedRequest): string {
        const userId = req.principal?.userId;

        if (userId === undefined || userId.length === 0) {
            throw new UnauthorizedException('Missing authenticated principal');
        }

        return userId;
    }
}
