/**
 * T034 — the recipe-photo data-access layer.
 *
 * Owns every SQL touch of the `recipe_photos` rows (defined in `database/schema/photos.ts`). A photo is
 * a full-size stored object (`s3_key`, `content_type`, `size_bytes`) served as-is via CloudFront, plus an
 * optional derived cover-thumbnail rendition (`thumbnail_key`, NULL when absent — FOLLOW-UP-CR-001-A);
 * there is no processing state machine. The DAL enforces the 10-photos-per-recipe cap
 * ({@link MAX_PHOTOS_PER_RECIPE}) inside {@link PhotosDal.create}: it COUNTs the existing rows in the
 * same transaction as the INSERT and throws `MAX_PHOTOS_EXCEEDED` before writing, and it assigns the new
 * row's `sortOrder` as append-to-end (`= count`). Ordering, HTTP mapping, and S3 validation live above
 * it (service layer); the DAL is authorization-agnostic and only ever scopes by `recipeId`.
 *
 * @sideEffect Every method reads and/or writes Postgres via the injected Drizzle client.
 */
import { and, asc, eq, sql } from 'drizzle-orm';

import type { RecipeDrizzle } from '../../database/client.js';
import { recipePhotos, type RecipePhotoRow } from '../../database/schema/index.js';
import { maxPhotosExceeded } from '../photo.error.js';
import { isExactReorder } from '../photo-reorder.js';

/** The hard cap on photos per recipe, enforced by {@link PhotosDal.create}. */
export const MAX_PHOTOS_PER_RECIPE = 10;

/** Everything the DAL needs to persist a confirmed photo's metadata row. */
export interface CreatePhotoInput {
    recipeId: string;
    /** The full-size stored object key (validated by magic bytes upstream). */
    s3Key: string;
    /**
     * The cover-thumbnail rendition's object key (FOLLOW-UP-CR-001-A), or absent when generation degraded
     * — persisted as NULL so the cover projections fall back to `s3Key`.
     */
    thumbnailKey?: string;
    /** The DETECTED (sniffed) content type — never a client-sent header. */
    contentType: string;
    /** The object's byte size from the S3 HEAD (validated ≤ 5 MB upstream). */
    sizeBytes: number;
}

/** A minimal writer surface satisfied by both the Drizzle client and a transaction handle. */
type Writer = Pick<RecipeDrizzle, 'insert' | 'select' | 'update' | 'delete'>;

export class PhotosDal {
    public constructor(private readonly db: RecipeDrizzle) {}

    /**
     * Persist a confirmed photo's metadata, enforcing the {@link MAX_PHOTOS_PER_RECIPE} cap. Runs the
     * COUNT and the INSERT in one transaction so the cap check and the write are consistent, and assigns
     * the new row's `sortOrder` as append-to-end.
     *
     * @throws `MAX_PHOTOS_EXCEEDED` when the recipe already holds {@link MAX_PHOTOS_PER_RECIPE} photos.
     * @sideEffect Reads a COUNT and inserts one `recipe_photos` row.
     */
    public async create(input: CreatePhotoInput): Promise<RecipePhotoRow> {
        return this.db.transaction(async (tx) => {
            // Serialize concurrent confirms for the SAME recipe: without this, two transactions can both
            // COUNT 9 and both INSERT, exceeding the cap (and colliding on `sortOrder`). A transaction-
            // scoped advisory lock keyed on the recipe id makes the COUNT + INSERT atomic per recipe
            // (released automatically at commit/rollback); different recipes never contend.
            await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${input.recipeId})::bigint)`);

            const count = await this.countByRecipe(tx, input.recipeId);

            if (count >= MAX_PHOTOS_PER_RECIPE) {
                throw maxPhotosExceeded(input.recipeId, MAX_PHOTOS_PER_RECIPE);
            }

            const [row] = await tx
                .insert(recipePhotos)
                .values({
                    recipeId: input.recipeId,
                    s3Key: input.s3Key,
                    thumbnailKey: input.thumbnailKey ?? null,
                    contentType: input.contentType,
                    sizeBytes: input.sizeBytes,
                    sortOrder: count,
                })
                .returning();

            if (!row) {
                throw new Error('PhotosDal.create: insert returned no photo row');
            }

            return row;
        });
    }

    /**
     * List one recipe's photos, ordered by `sortOrder` then insertion time.
     *
     * @sideEffect Reads `recipe_photos`.
     */
    public async findByRecipe(recipeId: string): Promise<RecipePhotoRow[]> {
        return this.loadByRecipe(this.db, recipeId);
    }

    /**
     * Load one photo by id.
     *
     * @returns The row, or `undefined` when no photo has that id.
     * @sideEffect Reads `recipe_photos`.
     */
    public async findById(id: string): Promise<RecipePhotoRow | undefined> {
        const [row] = await this.db.select().from(recipePhotos).where(eq(recipePhotos.id, id)).limit(1);

        return row;
    }

    /**
     * Hard-delete a photo (the table has no soft-delete column — a removed photo is gone), scoped to its
     * recipe so a mismatched `recipeId` never deletes another recipe's photo.
     *
     * @returns `true` when a row was removed, `false` when none matched.
     * @sideEffect Deletes at most one `recipe_photos` row.
     */
    public async delete(recipeId: string, id: string): Promise<boolean> {
        const removed = await this.db
            .delete(recipePhotos)
            .where(and(eq(recipePhotos.id, id), eq(recipePhotos.recipeId, recipeId)))
            .returning({ id: recipePhotos.id });

        return removed.length > 0;
    }

    /**
     * Rewrite the `sortOrder` of a recipe's photos to the given id order (index 0..n-1) in one
     * transaction, then return the reordered rows. `orderedIds` MUST be an exact reordering of the
     * recipe's current photos; otherwise no row is touched and `null` is returned (the caller maps it to
     * a 400). The current ids are read `FOR UPDATE` so the permutation check and the rewrite are atomic —
     * a concurrent add/delete cannot slip in a gap or duplicate `sortOrder` between validate and write.
     * Returning `null` (rather than throwing) keeps the DAL free of HTTP/domain-error coupling.
     *
     * @sideEffect Updates `sortOrder` on the recipe's `recipe_photos` rows when the request is valid.
     */
    public async reorder(recipeId: string, orderedIds: string[]): Promise<RecipePhotoRow[] | null> {
        return this.db.transaction(async (tx) => {
            const current = await tx
                .select({ id: recipePhotos.id })
                .from(recipePhotos)
                .where(eq(recipePhotos.recipeId, recipeId))
                .for('update');

            if (
                !isExactReorder(
                    current.map((row) => row.id),
                    orderedIds,
                )
            ) {
                return null;
            }

            for (let index = 0; index < orderedIds.length; index += 1) {
                await tx
                    .update(recipePhotos)
                    .set({ sortOrder: index, updatedAt: new Date() })
                    .where(and(eq(recipePhotos.id, orderedIds[index] as string), eq(recipePhotos.recipeId, recipeId)));
            }

            return this.loadByRecipe(tx, recipeId);
        });
    }

    /** COUNT a recipe's photos over the given reader (client or transaction). */
    private async countByRecipe(reader: Pick<RecipeDrizzle, 'select'>, recipeId: string): Promise<number> {
        const rows = await reader
            .select({ count: sql<number>`count(*)::int` })
            .from(recipePhotos)
            .where(eq(recipePhotos.recipeId, recipeId));

        return rows[0]?.count ?? 0;
    }

    /** Load a recipe's photos ordered by `sortOrder` then `createdAt`, over any reader. */
    private async loadByRecipe(reader: Pick<Writer, 'select'>, recipeId: string): Promise<RecipePhotoRow[]> {
        return reader
            .select()
            .from(recipePhotos)
            .where(eq(recipePhotos.recipeId, recipeId))
            .orderBy(asc(recipePhotos.sortOrder), asc(recipePhotos.createdAt));
    }
}
