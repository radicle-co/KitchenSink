/**
 * Drizzle definition for `recipe_photos` (T013). Mirrors data-model.md EXACTLY. Photos are accepted with
 * a size limit and validated by magic bytes, but NEVER resized or processed: a single stored object
 * (`s3_key`) is served as-is via CloudFront. There is no processing state machine and no derived variants.
 * The 10-photos-per-recipe cap is enforced in the service layer (COUNT + advisory lock), so
 * `max_photos_per_recipe` is an advisory CHECK (true) only.
 */
import { sql, type InferInsertModel, type InferSelectModel } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { recipes } from './recipes.js';

export const recipePhotos = pgTable(
    'recipe_photos',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        recipeId: uuid('recipe_id')
            .notNull()
            .references(() => recipes.id, { onDelete: 'cascade' }),
        s3Key: text('s3_key').notNull(),
        contentType: text('content_type').notNull(),
        sizeBytes: integer('size_bytes'),
        sortOrder: integer('sort_order').notNull().default(0),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        // Advisory only — the real cap is enforced in the service layer (COUNT + advisory lock).
        check('max_photos_per_recipe', sql`true`),
        index('idx_recipe_photos_recipe_id').on(table.recipeId),
    ],
);

/** A `recipe_photos` row as selected. */
export type RecipePhotoRow = InferSelectModel<typeof recipePhotos>;
/** A `recipe_photos` row for insert. */
export type NewRecipePhotoRow = InferInsertModel<typeof recipePhotos>;
