/**
 * Drizzle definition for `recipe_photos` (T013). Mirrors data-model.md EXACTLY. Photos are processed
 * out-of-band by an S3-only Lambda (Sharp); the in-VPC Fargate API consumes the `photo-processed` SQS
 * message and performs the completion UPDATE. The 10-photos-per-recipe cap is enforced in the service
 * layer (COUNT + advisory lock), so `max_photos_per_recipe` is an advisory CHECK (true) only.
 */
import { sql, type InferInsertModel, type InferSelectModel } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { recipes } from './recipes.js';

/** Photo processing lifecycle. */
export const PHOTO_PROCESSING_STATUSES = ['pending', 'processing', 'complete', 'failed'] as const;

/** A photo processing-status value. */
export type PhotoProcessingStatus = (typeof PHOTO_PROCESSING_STATUSES)[number];

export const recipePhotos = pgTable(
    'recipe_photos',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        recipeId: uuid('recipe_id')
            .notNull()
            .references(() => recipes.id, { onDelete: 'cascade' }),
        s3KeyOrig: text('s3_key_orig').notNull(),
        s3KeyThumb: text('s3_key_thumb'),
        s3KeyCard: text('s3_key_card'),
        s3KeyFull: text('s3_key_full'),
        cdnUrlBase: text('cdn_url_base').notNull(),
        processingStatus: text('processing_status').notNull().default('pending'),
        sortOrder: integer('sort_order').notNull().default(0),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        check(
            'recipe_photos_processing_status_check',
            sql`${table.processingStatus} IN ('pending', 'processing', 'complete', 'failed')`,
        ),
        // Advisory only — the real cap is enforced in the service layer (COUNT + advisory lock).
        check('max_photos_per_recipe', sql`true`),
        index('idx_recipe_photos_recipe_id').on(table.recipeId),
    ],
);

/** A `recipe_photos` row as selected. */
export type RecipePhotoRow = InferSelectModel<typeof recipePhotos>;
/** A `recipe_photos` row for insert. */
export type NewRecipePhotoRow = InferInsertModel<typeof recipePhotos>;
