/**
 * Drizzle definition for `recipe_ratings` (CR-001 / FR-013). Mirrors data-model.md EXACTLY. One row per
 * `(recipe_id, user_id)`: re-rating UPDATEs the row, it never inserts a second one (the UNIQUE index is
 * also the conflict target of the idempotent `PUT /v1/recipes/{id}/rating` upsert).
 *
 * D2 (no local `users` table): `user_id` stores the app-user ULID of the RATER (from the token claim)
 * directly as `VARCHAR(255) NOT NULL` — no FK, no user replication — the same rule as `recipes.owner_id`.
 * Because a rating is authored by its rater, this table's rows routinely live on OTHER users' recipes,
 * which is why `user_id` is the third owner-scoped GDPR erasure root (see the erasure worker).
 *
 * The denormalized `recipes.average_rating` / `recipes.rating_count` aggregate over this table is
 * maintained ONLY by the statement-level `recipe_ratings_aggregate_refresh()` trigger (0010 migration).
 * Drizzle does not model triggers, so this file describes the table + indexes; the trigger is
 * hand-authored SQL and no application code may write those two `recipes` columns.
 */
import { sql, type InferInsertModel, type InferSelectModel } from 'drizzle-orm';
import { check, index, integer, pgTable, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';

import { recipes } from './recipes.js';

export const recipeRatings = pgTable(
    'recipe_ratings',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        recipeId: uuid('recipe_id')
            .notNull()
            .references(() => recipes.id, { onDelete: 'cascade' }),
        // App-user ULID of the RATER (from token claim). No FK, no local users table (D2).
        userId: varchar('user_id', { length: 255 }).notNull(),
        stars: integer('stars').notNull(),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        check('recipe_ratings_stars_range', sql`${table.stars} BETWEEN 1 AND 5`),
        // One rating per user per recipe — also the ON CONFLICT (recipe_id, user_id) upsert target. Its
        // index is (recipe_id, user_id), whose leftmost prefix already serves the aggregate recompute
        // ("all ratings for a recipe"), so no separate recipe_id index is needed.
        uniqueIndex('recipe_ratings_recipe_user_unique').on(table.recipeId, table.userId),
        // REQUIRED for GDPR erasure: the sweep is `DELETE FROM recipe_ratings WHERE user_id = :ownerId`.
        // Without this index that delete is a Seq Scan of every rating in the system.
        index('idx_recipe_ratings_user_id').on(table.userId),
    ],
);

/** A `recipe_ratings` row as selected. */
export type RecipeRatingRow = InferSelectModel<typeof recipeRatings>;
/** A `recipe_ratings` row for insert. */
export type NewRecipeRatingRow = InferInsertModel<typeof recipeRatings>;
