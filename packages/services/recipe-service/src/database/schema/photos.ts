/**
 * Drizzle definition for `recipe_photos` (T013). Mirrors data-model.md EXACTLY. Photos are accepted with
 * a size limit and validated by magic bytes; the full-size object (`s3_key`) is served as-is via
 * CloudFront. There is no processing state machine.
 *
 * `thumbnail_key` (FOLLOW-UP-CR-001-A) is the ONE derived rendition: a small cover thumbnail the service
 * generates synchronously on confirm and stores BESIDE the original under the same owner erasure prefix
 * (`@kitchensink/recipe-core` `recipePhotoThumbnailKey`). It is NULLABLE on purpose — photos uploaded
 * before this feature, or whose thumbnail generation degraded, have no rendition, and the cover
 * projections `COALESCE(thumbnail_key, s3_key)` so those simply fall back to the full-size original. The
 * key is persisted (not recomputed) so the erasure sweep and the format can each evolve independently.
 *
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
        // The cover-thumbnail rendition's object key (FOLLOW-UP-CR-001-A). NULL when the photo has no
        // thumbnail (pre-feature rows, or a degraded generation); the cover LATERALs COALESCE to `s3_key`.
        thumbnailKey: text('thumbnail_key'),
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
        // CR-001 / FR-001c: serves the cover-photo LATERAL on the recipe LIST projection (lowest
        // sort_order, ties broken by created_at then id). The (recipe_id, sort_order, created_at, id)
        // ordering matches the LATERAL's ORDER BY so the LIMIT 1 is an index-only lookup.
        index('idx_recipe_photos_recipe_cover').on(table.recipeId, table.sortOrder, table.createdAt, table.id),
    ],
);

/** A `recipe_photos` row as selected. */
export type RecipePhotoRow = InferSelectModel<typeof recipePhotos>;
/** A `recipe_photos` row for insert. */
export type NewRecipePhotoRow = InferInsertModel<typeof recipePhotos>;
