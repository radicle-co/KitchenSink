/**
 * CR-001 / FR-013 — the `/api/v1/recipes/{id}/rating` REST surface (rating write).
 *
 * A thin controller sharing the `v1/recipes` base path with {@link RecipesController} (distinct method +
 * sub-path, so no route collision). The `@OwnerId()` decorator resolves the verified caller ULID from
 * `req.principal` (set by the fail-closed `AuthMiddleware`) — here that caller is the RATER, never taken
 * from the body. Both routes are WRITES, so both carry `@WriteRateLimit()`. Domain failures thrown by the
 * service (`RECIPE_NOT_FOUND` → 404, `CANNOT_RATE_OWN_RECIPE` → 403) are mapped to HTTP by the global
 * `ApiExceptionFilter`; the controller-scoped `ZodValidationPipe` enforces the DTO — which IS the authored
 * wire contract (`ratings.schema.ts` → recipe-core's one rating rule), per CODING_STANDARDS §15.2 — and
 * strips any spoofed body `userId`, because `z.object` drops unknown keys.
 */
import { Body, Controller, Delete, HttpCode, HttpStatus, Param, ParseUUIDPipe, Put, UsePipes } from '@nestjs/common';
import { ZodValidationPipe } from 'nestjs-zod';

import { RatingsService } from './ratings.service.js';
import { SetRatingDto } from './dto/set-rating.dto.js';
import type { RecipeResponse } from '../recipes/dto/recipe-response.dto.js';
import { OwnerId } from '../auth/current-principal.decorator.js';
import { WriteRateLimit } from '../common/throttle/throttle.decorators.js';

// Canonically served under the `/api/{version}/` prefix. The bare `v1/...` entry is a DEPRECATED ALIAS:
// `/v1/*` is live in production and held by consumers configured OUTSIDE this repo (the Clerk dashboard
// webhook URL) as well as already-shipped mobile builds and cached web bundles, whose endpoints were
// inlined at build time. Removing it REQUIRES updating the Clerk dashboard first — see ADR-0011.
@Controller(['api/v1/recipes', 'v1/recipes'])
@UsePipes(ZodValidationPipe)
export class RatingsController {
    public constructor(private readonly ratingsService: RatingsService) {}

    /**
     * `PUT /api/v1/recipes/{id}/rating` — set the caller's rating (idempotent upsert). Returns `200` with the
     * recipe's refreshed `RecipeDetail`.
     */
    @Put(':id/rating')
    @WriteRateLimit()
    public async setRating(
        @OwnerId() raterId: string,
        @Param('id', ParseUUIDPipe) id: string,
        @Body() body: SetRatingDto,
    ): Promise<RecipeResponse> {
        return this.ratingsService.setRating(raterId, id, body);
    }

    /**
     * `DELETE /api/v1/recipes/{id}/rating` — remove the caller's rating (`204`, idempotent — removing a
     * non-existent rating still succeeds).
     */
    @Delete(':id/rating')
    @HttpCode(HttpStatus.NO_CONTENT)
    @WriteRateLimit()
    public async deleteRating(@OwnerId() raterId: string, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
        await this.ratingsService.deleteRating(raterId, id);
    }
}
