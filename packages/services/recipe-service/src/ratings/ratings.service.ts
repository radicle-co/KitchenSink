/**
 * CR-001 / FR-013 — rating write orchestration + authorization.
 *
 * Sits between {@link RatingsController} (which supplies the verified rater ULID — `principal.userId`,
 * NEVER a body value) and {@link RatingsDal}. It owns the authorization rules the DAL does not, and the
 * ORDER of those rules is a security boundary, not an implementation detail:
 *
 *   1. **Missing / tombstoned** → 404 `RECIPE_NOT_FOUND`.
 *   2. **Not visible to the caller** (private and not theirs) → the SAME 404 `RECIPE_NOT_FOUND`, via the
 *      shared read-side {@link isRecipeViewableBy} predicate. This is the IDOR boundary: a 403 here would
 *      confirm to an unauthorized caller that the recipe exists, so an unreadable recipe MUST be
 *      indistinguishable from a missing one.
 *   3. **Owned by the caller** → 403 `CANNOT_RATE_OWN_RECIPE` (FR-013). Safe to be explicit: the owner
 *      already knows their recipe exists, so nothing leaks. The precedence matters — an owner passes the
 *      visibility check (owners see their own private recipes), so the own-check is what decides for a
 *      recipe the caller CAN see; a caller who canNOT see the recipe never reaches this line.
 *   4. Otherwise → upsert the rating (idempotent), then return the recipe with its trigger-refreshed
 *      `averageRating` / `ratingCount` as the `RecipeDetail` the contract mandates.
 *
 * The rater is ALWAYS the app-user ULID from the verified token; ownership compares `owner_id == raterId`
 * (D2 / REQ-IF-007). Authorization deliberately REUSES the read path's viewability rule so the "who may
 * rate" boundary can never drift from the "who may read" boundary.
 */
import { Inject, Injectable } from '@nestjs/common';

import { RatingsDal } from './dal/ratings.dal.js';
import { RecipesService } from '../recipes/recipes.service.js';
import { RecipesDal } from '../recipes/dal/recipes.dal.js';
import { isRecipeViewableBy } from '../recipes/domain/recipe-visibility.js';
import { cannotRateOwnRecipe, recipeNotFound } from '../recipes/recipe.error.js';
import type { RecipeResponse } from '../recipes/dto/recipe-response.dto.js';
import type { SetRatingDto } from './dto/set-rating.dto.js';

/** DI token for the ratings DAL — provided by `RatingsModule` via `useFactory` over the Drizzle client. */
export const RATINGS_DAL = 'RATINGS_DAL';

/**
 * DI token for the ratings vertical's OWN {@link RecipesDal} instance (over the shared Drizzle client),
 * used only for the recipe existence/visibility/ownership read that authorizes a rating. Its own instance
 * (not the recipes vertical's private `RECIPES_DAL`) keeps `RatingsModule` self-contained — the same
 * pattern the recipes vertical uses for its embedded PhotosDal.
 */
export const RATING_RECIPES_DAL = 'RATING_RECIPES_DAL';

@Injectable()
export class RatingsService {
    public constructor(
        @Inject(RATINGS_DAL) private readonly ratingsDal: RatingsDal,
        // The recipe read used for the existence + visibility + ownership decision. Its OWN RecipesDal
        // instance over the shared Drizzle client (the RecipesModule token is not exported); the same
        // "own DAL instance" pattern the recipes vertical uses for its embedded PhotosDal.
        @Inject(RATING_RECIPES_DAL) private readonly recipesDal: RecipesDal,
        // The detail response is the read path's own `RecipeDetail` (photos + per-serving nutrition), so
        // the write reuses RecipesService.getById rather than re-deriving that shaping — ONE detail path.
        private readonly recipesService: RecipesService,
    ) {}

    /**
     * Create or replace the caller's rating of a recipe, then return the recipe with its refreshed
     * aggregate (the contract's `RecipeDetail`). See the class docstring for the authorization precedence.
     *
     * @param raterId - The verified caller's app-user ULID (the rater).
     * @param recipeId - The recipe to rate.
     * @param dto - The validated `{ stars }` body (a spoofed body `userId` is already stripped).
     * @returns The recipe detail with its trigger-recomputed `averageRating` / `ratingCount`.
     * @throws {RecipeDomainError} `RECIPE_NOT_FOUND` (404) when missing/tombstoned or unseeable (IDOR);
     *   `CANNOT_RATE_OWN_RECIPE` (403) when the caller owns the recipe.
     * @sideEffect Upserts a `recipe_ratings` row (firing the aggregate trigger) and reads the recipe.
     */
    public async setRating(raterId: string, recipeId: string, dto: SetRatingDto): Promise<RecipeResponse> {
        await this.assertRateable(raterId, recipeId, { rejectOwn: true });

        await this.ratingsDal.upsert({ recipeId, userId: raterId, stars: dto.stars });

        // Re-read AFTER the upsert so the statement-level trigger has refreshed the aggregate. A rateable
        // recipe is, by rule, public (viewable-and-not-owned ⟹ public), so getById(raterId, id) always
        // resolves — it never re-raises a 403 for the recipe we just authorized.
        return this.recipesService.getById(raterId, recipeId);
    }

    /**
     * Remove the caller's rating of a recipe. Idempotent: removing a rating that does not exist succeeds
     * (the endpoint returns `204` either way). The visibility 404 boundary matches `setRating`; there is
     * deliberately NO own-recipe 403 — the DELETE contract lists 204/401/404 only, and an owner can never
     * hold a rating on their own recipe (PUT forbids it), so an owner's delete is a clean no-op.
     *
     * @param raterId - The verified caller's app-user ULID.
     * @param recipeId - The recipe whose rating to remove.
     * @throws {RecipeDomainError} `RECIPE_NOT_FOUND` (404) when missing/tombstoned or unseeable (IDOR).
     * @sideEffect Deletes 0..1 `recipe_ratings` rows (firing the aggregate trigger).
     */
    public async deleteRating(raterId: string, recipeId: string): Promise<void> {
        await this.assertRateable(raterId, recipeId, { rejectOwn: false });

        await this.ratingsDal.delete(recipeId, raterId);
    }

    /**
     * Enforce the shared rating-access boundary: the recipe must exist AND be visible to the caller, else
     * a non-leaking 404. When `rejectOwn` is set (the PUT path), a recipe the caller owns is rejected with
     * 403 `CANNOT_RATE_OWN_RECIPE`; the DELETE path passes `false` (no own-recipe rejection).
     */
    private async assertRateable(raterId: string, recipeId: string, options: { rejectOwn: boolean }): Promise<void> {
        const existing = await this.recipesDal.findById(recipeId);

        // Missing OR tombstoned (findById excludes `deleted_at IS NOT NULL`) → 404.
        if (!existing) {
            throw recipeNotFound(recipeId);
        }

        // IDOR boundary: a recipe the caller cannot see is the SAME 404 a missing recipe gives. Never a
        // 403 here — that would confirm the recipe exists to someone not allowed to know.
        if (!isRecipeViewableBy(existing.recipe, raterId)) {
            throw recipeNotFound(recipeId);
        }

        // Owner: safe to be explicit (they know it exists). Only the PUT path rejects here.
        if (options.rejectOwn && existing.recipe.ownerId === raterId) {
            throw cannotRateOwnRecipe(recipeId);
        }
    }
}
