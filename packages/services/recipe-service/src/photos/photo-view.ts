/**
 * Pure mapping from a persisted `recipe_photos` row to the shared `RecipePhoto` wire contract.
 *
 * Shared by the photos vertical (list/confirm/reorder responses) AND the recipes vertical (which embeds
 * a recipe's photos in the `RecipeDetail` read), so the single stored object → wire shape is defined ONCE:
 * the object is served as-is, the server resolves the full CDN `url` (clients never concatenate), and
 * `order` is the 1-based display position (the stored `sort_order` is 0-based).
 */
import type { RecipePhoto } from '@kitchensink/recipe-core';

import type { RecipePhotoRow } from '../database/schema/index.js';

/** Join a CDN base URL and an object key into a single URL, tolerating a trailing slash on the base. Pure. */
export function resolveCdnUrl(cloudfrontUrl: string, key: string): string {
    return `${cloudfrontUrl.replace(/\/+$/, '')}/${key}`;
}

/** Map a `recipe_photos` row to the shared `RecipePhoto` contract against the given CDN base. Pure. */
export function resolvePhotoView(row: RecipePhotoRow, cloudfrontUrl: string): RecipePhoto {
    return {
        id: row.id,
        recipeId: row.recipeId,
        key: row.s3Key,
        url: resolveCdnUrl(cloudfrontUrl, row.s3Key),
        contentType: row.contentType,
        order: row.sortOrder + 1,
        createdAt: row.createdAt.toISOString(),
    };
}
