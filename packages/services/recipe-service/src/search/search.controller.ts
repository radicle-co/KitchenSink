/**
 * T043 — the `/v1/search/recipes` REST surface (recipe discovery).
 *
 * Thin controller: it reads the authenticated owner key from `req.principal.userId` (set by the
 * fail-closed `AuthMiddleware` — the app-user ULID, never the Clerk `sub`) and delegates the validated
 * query to {@link SearchService}. A controller-scoped `ValidationPipe` (`transform: true`) coerces the
 * query string into {@link SearchRecipesQueryDto}; the app registers no global pipe.
 */
import { Controller, Get, Query, Req, UnauthorizedException, UsePipes, ValidationPipe } from '@nestjs/common';

import { SearchService } from './search.service.js';
import { SearchRecipesQueryDto } from './dto/search-recipes.query.dto.js';
import type { RecipeSearchResponse } from './dto/search-response.dto.js';
import type { AuthenticatedRequest } from '../auth/principal.js';

/** Read the verified owner key (app-user ULID) or reject — the middleware guarantees it on this route. */
function ownerIdOf(req: AuthenticatedRequest): string {
    const userId = req.principal?.userId;

    if (!userId) {
        throw new UnauthorizedException('Missing authenticated principal');
    }

    return userId;
}

@Controller('v1/search')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: false }))
export class SearchController {
    public constructor(private readonly searchService: SearchService) {}

    /**
     * `GET /v1/search/recipes` — ranked, faceted, paginated full-text search over visible recipes
     * (public recipes + the caller's own).
     *
     * @param req - The authenticated request (its `principal.userId` is the visibility owner key).
     * @param query - The validated search parameters.
     * @returns The ranked results, facet counts, and pagination envelope.
     */
    @Get('recipes')
    public async searchRecipes(
        @Req() req: AuthenticatedRequest,
        @Query() query: SearchRecipesQueryDto,
    ): Promise<RecipeSearchResponse> {
        return this.searchService.searchRecipes(ownerIdOf(req), query);
    }
}
