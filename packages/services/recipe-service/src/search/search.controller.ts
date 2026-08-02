/**
 * T043 — the `/api/v1/search/recipes` REST surface (recipe discovery).
 *
 * Thin controller: the `@OwnerId()` decorator reads the authenticated owner key from `req.principal`
 * (set by the fail-closed `AuthMiddleware` — the app-user ULID, never the Clerk `sub`) and the
 * controller delegates the validated query to {@link SearchService}. A controller-scoped
 * `ValidationPipe` (`transform: true`) coerces the query string into {@link SearchRecipesQueryDto}; the
 * app registers no global pipe.
 */
import { Controller, Get, Query, UsePipes, ValidationPipe } from '@nestjs/common';

import { SearchService } from './search.service.js';
import { SearchRecipesQueryDto } from './dto/search-recipes.query.dto.js';
import type { RecipeSearchResponse } from './dto/search-response.dto.js';
import { OwnerId } from '../auth/current-principal.decorator.js';
import { SearchRateLimit } from '../common/throttle/throttle.decorators.js';

// Canonically served under the `/api/{version}/` prefix. The bare `v1/...` entry is a DEPRECATED ALIAS:
// `/v1/*` is live in production and held by consumers configured OUTSIDE this repo (the Clerk dashboard
// webhook URL) as well as already-shipped mobile builds and cached web bundles, whose endpoints were
// inlined at build time. Removing it REQUIRES updating the Clerk dashboard first — see ADR-0011.
@Controller(['api/v1/search', 'v1/search'])
@SearchRateLimit()
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: false }))
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
