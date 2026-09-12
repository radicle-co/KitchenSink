/**
 * CR-001 / FR-013 — rating write orchestration + authorization.
 *
 * Sits between `RatingsController` (which supplies the verified rater ULID — `principal.userId`,
 * NEVER a body value) and {@link RatingsDal}. It owns the authorization rules the DAL does not, and the
 * ORDER of those rules is a security boundary, not an implementation detail:
 *
 *   1. **Missing / tombstoned** → 404 `RECIPE_NOT_FOUND`.
 *   2. **Not visible to the caller** (private and not theirs) → the SAME 404 `RECIPE_NOT_FOUND`, via
 *      {@link RecipesService.findReadableRecipe}, which applies the shared read-side visibility predicate. This is the IDOR boundary: a 403 here would
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

import { assertNotContained } from '../common/containment.error.js';
import type { ActingPrincipal } from '../auth/principal.js';
import { RatingsDal } from './dal/ratings.dal.js';
import { RecipesService } from '../recipes/recipes.service.js';
import { cannotRateOwnRecipe } from '../recipes/recipe.error.js';
import type { RecipeResponse } from '../recipes/dto/recipeResponse.dto.js';
import type { SetRatingDto } from './dto/setRating.dto.js';
import type { CallerToken } from '../auth/CallerToken.js';

/** DI token for the ratings DAL — provided by `RatingsModule` via `useFactory` over the Drizzle client. */
export const RATINGS_DAL = 'RATINGS_DAL';

@Injectable()
export class RatingsService {
    public constructor(
        @Inject(RATINGS_DAL) private readonly ratingsDal: RatingsDal,
        // Two doors on ONE collaborator: `findReadableRecipe` answers the existence + visibility question from
        // a single row (the rule lives there, not here), and `getById` is the read path's own `RecipeDetail`
        // (photos + per-serving nutrition) the PUT returns — ONE detail path, ONE visibility rule.
        private readonly recipesService: RecipesService,
    ) {}

    /**
     * Create or replace the caller's rating of a recipe, then return the recipe with its refreshed
     * aggregate (the contract's `RecipeDetail`). See the class docstring for the authorization precedence.
     *
     * @param rater - The verified rater: its app-user ULID, principal kind and the stage's containment mode.
     * @param recipeId - The recipe to rate.
     * @param dto - The validated `{ stars }` body (a spoofed body `userId` is already stripped).
     * @param caller - The caller's bearer, forwarded to the re-read so the detail's nutrition resolves;
     *   `undefined` only when the request carried none.
     * @returns The recipe detail with its trigger-recomputed `averageRating` / `ratingCount`.
     * @throws {RecipeDomainError} `RECIPE_NOT_FOUND` (404) when missing/tombstoned or unseeable (IDOR);
     *   `CANNOT_RATE_OWN_RECIPE` (403) when the caller owns the recipe.
     * @throws {HttpException} `TEST_PRINCIPAL_CONTAINED` (403) for a contained test principal (ADR-0040).
     * @sideEffect Upserts a `recipe_ratings` row (firing the aggregate trigger) and reads the recipe.
     */
    public async setRating(
        rater: ActingPrincipal,
        recipeId: string,
        dto: SetRatingDto,
        caller: CallerToken | undefined,
    ): Promise<RecipeResponse> {
        const raterId = rater.userId;
        // ADR-0040 — FIRST, before any read: a rating moves a real recipe's public aggregate for everyone, so a
        // contained test principal may not rate. The refusal is about the PRINCIPAL, never the recipe, so running it
        // ahead of the IDOR 404 cannot confirm anything exists.
        assertNotContained(rater, 'rate');

        await this.assertRateable(raterId, recipeId, { rejectOwn: true });

        await this.ratingsDal.upsert({ recipeId, userId: raterId, stars: dto.stars });

        // Re-read AFTER the upsert so the statement-level trigger has refreshed the aggregate. A rateable
        // recipe is, by rule, public (viewable-and-not-owned ⟹ public), so getById(raterId, id) always
        // resolves — it never re-raises a 403 for the recipe we just authorized.
        // The rating has COMMITTED, so the re-read answers on the short post-commit food budget.
        return this.recipesService.getById({ viewerId: raterId, id: recipeId, caller: caller, budget: 'postCommit' });
    }

    /**
     * Remove the caller's rating of a recipe. Idempotent: removing a rating that does not exist succeeds
     * (the endpoint returns `204` either way). The visibility 404 boundary matches `setRating`; there is
     * deliberately NO own-recipe 403 — the DELETE contract lists 204/401/404 only, and an owner can never
     * hold a rating on their own recipe (PUT forbids it), so an owner's delete is a clean no-op.
     *
     * @param rater - The verified rater.
     * @param recipeId - The recipe whose rating to remove.
     * @throws {RecipeDomainError} `RECIPE_NOT_FOUND` (404) when missing/tombstoned or unseeable (IDOR).
     * @sideEffect Deletes 0..1 `recipe_ratings` rows (firing the aggregate trigger).
     */
    public async deleteRating(rater: ActingPrincipal, recipeId: string): Promise<void> {
        // Deliberately NOT contained (ADR-0040): removing a rating only takes back what reached real data.
        await this.assertRateable(rater.userId, recipeId, { rejectOwn: false });

        await this.ratingsDal.delete(recipeId, rater.userId);
    }

    /**
     * Enforce the shared rating-access boundary: the recipe must exist AND be visible to the caller, else
     * a non-leaking 404. When `rejectOwn` is set (the PUT path), a recipe the caller owns is rejected with
     * 403 `CANNOT_RATE_OWN_RECIPE`; the DELETE path passes `false` (no own-recipe rejection).
     */
    private async assertRateable(raterId: string, recipeId: string, options: { rejectOwn: boolean }): Promise<void> {
        // Missing, tombstoned, or not visible to the caller → the SAME 404 (IDOR boundary): never a 403 that
        // would confirm the recipe exists to someone not allowed to know.
        const recipe = await this.recipesService.findReadableRecipe(raterId, recipeId);

        // Owner: safe to be explicit (they know it exists). Only the PUT path rejects here.
        if (options.rejectOwn && recipe.ownerId === raterId) {
            throw cannotRateOwnRecipe(recipeId);
        }
    }
}
