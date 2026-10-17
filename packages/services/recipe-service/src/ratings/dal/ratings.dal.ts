/**
 * CR-001 / FR-013 — the rating data-access layer.
 *
 * Owns every SQL touch of `recipe_ratings` over the shared Drizzle client. It is intentionally
 * authorization-agnostic (the visibility / own-recipe rules live in `RatingsService`); it takes
 * ids + stars and returns rows. Two things it deliberately does NOT do:
 *
 *  - **Write the aggregate.** `recipes.average_rating` / `recipes.rating_count` are maintained ONLY by
 *    the statement-level `recipe_ratings_aggregate_refresh()` trigger (0010 migration). Hand-updating
 *    them here would double-count and fight the trigger, so this DAL writes `recipe_ratings` and nothing
 *    else — the aggregate re-derives itself.
 *  - **Bump `updated_at` via a default on re-rate.** The column default fires only on INSERT, so the
 *    idempotent upsert MUST set `updated_at = now()` explicitly in the `DO UPDATE` clause; otherwise a
 *    re-rate would leave a stale timestamp.
 *
 * @sideEffect Every method reads and/or writes Postgres via the injected Drizzle client.
 */
import { and, eq, sql } from 'drizzle-orm';

import type { RecipeDrizzle } from '../../database/client.js';
import { recipeRatings, type RecipeRatingRow } from '../../database/schema/index.js';

/** Everything the DAL needs to create or replace one caller's rating of one recipe. */
export interface UpsertRatingInput {
    /** The rated recipe's id. */
    readonly recipeId: string;
    /** App-user ULID of the RATER (the verified caller — never a body-supplied value). */
    readonly userId: string;
    /** Whole stars, 1–5 (also enforced by the DB CHECK). */
    readonly stars: number;
}

export class RatingsDal {
    public constructor(private readonly db: RecipeDrizzle) {}

    /**
     * Create the caller's rating, or replace it if one already exists — the idempotent upsert behind
     * `PUT /api/v1/recipes/{id}/rating`. The conflict target is the `(recipe_id, user_id)` unique constraint,
     * so re-rating UPDATEs the single existing row (never inserts a second), and `updated_at = now()` is
     * set explicitly because the column default only fires on INSERT.
     *
     * @returns The persisted rating row.
     * @sideEffect Inserts or updates one `recipe_ratings` row (which fires the aggregate-refresh trigger).
     */
    public async upsert(input: UpsertRatingInput): Promise<RecipeRatingRow> {
        const [row] = await this.db
            .insert(recipeRatings)
            .values({ recipeId: input.recipeId, userId: input.userId, stars: input.stars })
            .onConflictDoUpdate({
                target: [recipeRatings.recipeId, recipeRatings.userId],
                set: { stars: input.stars, updatedAt: sql`now()` },
            })
            .returning();

        if (!row) {
            throw new Error('RatingsDal.upsert: upsert returned no rating row');
        }

        return row;
    }

    /**
     * Read the caller's OWN star rating of a recipe, or `undefined` when they have not rated it — the
     * per-viewer value the `RecipeDetail` read embeds as `viewerRating` (FR-013) so the rating control can
     * pre-select. Scoped to exactly the `(recipe_id, user_id)` row (served by the unique index as a single
     * indexed point lookup), so it can ONLY ever return the caller's own rating, never anyone else's — the
     * viewer-scoping that keeps another user's rating from leaking into this viewer's detail.
     *
     * @param recipeId - The recipe being viewed.
     * @param userId - The VIEWER's app-user ULID (the verified caller — never a body-supplied value).
     * @returns The viewer's stars (1–5), or `undefined` when the viewer has no rating on this recipe.
     * @sideEffect Reads `recipe_ratings`.
     */
    public async findStars(recipeId: string, userId: string): Promise<number | undefined> {
        const [row] = await this.db
            .select({ stars: recipeRatings.stars })
            .from(recipeRatings)
            .where(and(eq(recipeRatings.recipeId, recipeId), eq(recipeRatings.userId, userId)))
            .limit(1);

        return row?.stars;
    }

    /**
     * Remove the caller's rating of a recipe (behind `DELETE /api/v1/recipes/{id}/rating`). Scoped to exactly
     * the `(recipe_id, user_id)` row so a caller can only ever delete their OWN rating.
     *
     * @returns `true` when a rating was removed, `false` when the caller had none (a clean idempotent
     *   no-op — the endpoint returns `204` either way).
     * @sideEffect Deletes 0..1 `recipe_ratings` rows (which fires the aggregate-refresh trigger).
     */
    public async delete(recipeId: string, userId: string): Promise<boolean> {
        const removed = await this.db
            .delete(recipeRatings)
            .where(and(eq(recipeRatings.recipeId, recipeId), eq(recipeRatings.userId, userId)))
            .returning({ id: recipeRatings.id });

        return removed.length > 0;
    }
}
