import { sql, type SQL } from 'drizzle-orm';

/**
 * The cover-photo rule as SQL — the ONE definition every read that shows a recipe's cover shares (the search page,
 * a collection's cover mosaic): the recipe's first photo by `sort_order`, serving the small thumbnail rendition when
 * present and the full-size original otherwise (FOLLOW-UP-CR-001-A; a pre-thumbnail row has `thumbnail_key` NULL).
 *
 * A lateral subquery aliased `cp` exposing `cover_photo_key`, correlated on the enclosing `recipes` row. The caller
 * chooses the join: `LEFT JOIN … ON true` keeps a photo-less recipe, `JOIN … ON true` drops it. Pure.
 *
 * @returns The `LATERAL ( … ) cp` fragment, to follow a `JOIN`.
 */
export function coverPhotoLateral(): SQL {
    return sql`LATERAL (
        SELECT COALESCE(p.thumbnail_key, p.s3_key) AS cover_photo_key
        FROM recipe_photos p
        WHERE p.recipe_id = recipes.id
        ORDER BY p.sort_order, p.created_at, p.id
        LIMIT 1
    ) cp`;
}
