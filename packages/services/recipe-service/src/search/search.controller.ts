/**
 * T043 — the `/api/v1/search/recipes` REST surface (recipe discovery).
 *
 * Thin controller: the `@OwnerId()` decorator reads the authenticated owner key from `req.principal`
 * (set by the fail-closed `AuthMiddleware` — the app-user ULID, never the Clerk `sub`) and the
 * controller delegates the validated query to {@link SearchService}. A controller-scoped
 * `ZodValidationPipe` coerces and validates the query string against {@link SearchRecipesQueryDto}; the app
 * registers no global pipe.
 *
 * ⚠️ It was Nest's OWN `ValidationPipe` over a `class-validator` DTO until the query contract was authored as
 * zod (ADR-0015 §1). Do NOT swap it back: a `createZodDto` class carries no `class-validator` metadata, so
 * Nest's pipe would validate NOTHING while every visible signal said it did — ADR-0015's failure mode 3, which
 * had already shipped once on identity's `PATCH /users/me`.
 */
import { Controller, Get, Query, UsePipes } from '@nestjs/common';
import { ZodValidationPipe } from 'nestjs-zod';

import { SearchService } from './search.service.js';
import { SearchRecipesQueryDto } from './dto/searchRecipes.query.dto.js';
import type { RecipeSearchResponse } from './search.schema.js';
import { OwnerId } from '../auth/currentPrincipal.decorator.js';
import { SearchRateLimit } from '../common/throttle/throttle.decorators.js';

// Canonically served under the `/api/{version}/` prefix. The bare `v1/...` entry is a DEPRECATED ALIAS:
// `/v1/*` is live in production and held by consumers configured OUTSIDE this repo (the Clerk dashboard
// webhook URL) as well as already-shipped mobile builds and cached web bundles, whose endpoints were
// inlined at build time. Removing it REQUIRES updating the Clerk dashboard first — see ADR-0011.
@Controller(['api/v1/search', 'v1/search'])
@SearchRateLimit()
@UsePipes(ZodValidationPipe)
export class SearchController {
    public constructor(private readonly searchService: SearchService) {}

    /**
     * `GET /api/v1/search/recipes` — ranked, faceted, paginated full-text search over visible recipes
     * (public recipes + the caller's own).
     *
     * @param ownerId - The verified owner key (app-user ULID) — the visibility owner key.
     * @param query - The validated search parameters.
     * @returns The ranked results, facet counts, and pagination envelope.
     */
    @Get('recipes')
    public async searchRecipes(
        @OwnerId() ownerId: string,
        @Query() query: SearchRecipesQueryDto,
    ): Promise<RecipeSearchResponse> {
        return this.searchService.searchRecipes(ownerId, query);
    }
}
