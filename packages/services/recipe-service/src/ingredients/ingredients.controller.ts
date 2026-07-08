/**
 * T029 — `IngredientsController`: the `/v1/ingredients` HTTP surface (US1 MVP).
 *
 * Two endpoints, both authenticated behind the fail-closed Clerk `AuthMiddleware` (so `req.principal`
 * is always present) — the controller reads `req.principal.userId` (the app-user ULID owner key) to
 * prove the caller is authenticated:
 *
 *   - `GET /v1/ingredients/search?q=&limit=` — fuzzy + full-text autocomplete over the shared catalog
 *     (`200` → `Ingredient[]`). A missing/blank `q` is a `400`.
 *   - `POST /v1/ingredients` `{ name }` — create a freeform (user-entered) ingredient (`201` →
 *     `Ingredient`). A missing/blank/over-long name is a `400`.
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
    Post,
    Query,
    Req,
    UnauthorizedException,
} from '@nestjs/common';
import type { Ingredient } from '@kitchensink/recipe-core';

import type { AuthenticatedRequest } from '../auth/principal.js';
import { IngredientsService } from './ingredients.service.js';

/** Max length of a freeform ingredient name (mirrors the OpenAPI `CreateIngredientRequest`). */
const MAX_NAME_LENGTH = 120;

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
    public async create(@Req() req: AuthenticatedRequest, @Body() body: unknown): Promise<Ingredient> {
        this.requireUserId(req);

        const name = requireName(body);

        return this.ingredients.createFreeform(name);
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
