/**
 * The account-export data-access layer — the read-only INVERSE of the erasure worker's owner-scoped
 * sweep, over the global Drizzle client.
 *
 * Owns every SQL touch for assembling a GDPR export. Like the other DALs it is identity-blind: it takes
 * the verified owner key (supplied by the service) and returns rows; ownership is the service's concern.
 * Every method is keyed on that owner exactly as the erasure worker's `DELETE`s are, so the set returned
 * here is precisely the set erasure removes/keeps:
 *
 *  - `recipes` / `collections` / `recipe_ratings` / `author_handles` are keyed DIRECTLY by their owner
 *    column (`owner_id`, `owner_id`, `user_id`, `user_id`).
 *  - `recipe_photos` and `recipe_versions` carry no owner column — they belong to a recipe — so they are
 *    scoped by an INNER JOIN to `recipes` on the owner, mirroring the FK cascade erasure relies on.
 *  - collection memberships (`recipe_collections`) are scoped by an INNER JOIN to the OWNER'S collections,
 *    so a membership only appears under a collection the caller owns.
 *
 * **Reads ALL recipe rows, including tombstoned ones (no `deleted_at IS NULL` filter) — deliberately.**
 * This is the same exemption from the `activeRecipe()` read-path rule the erasure worker's
 * `eraseRecipeRows` carves out: a soft-deleted recipe still holds the user's data (retention is not
 * reachability), erasure purges it, so a faithful "what we hold about you" export must include it. Every
 * OTHER read path in the service filters tombstones; this one and erasure are the two documented
 * exceptions.
 *
 * `listVersions` selects only the version METADATA columns, never the `snapshot` JSONB: the snapshot is a
 * full copy of recipe content already exported under `recipes`, and the contract asks for version
 * metadata — pulling every snapshot blob for a bulk export would be needless I/O.
 */
import { Inject, Injectable } from '@nestjs/common';
import { eq, getTableColumns } from 'drizzle-orm';

import { DrizzleProvider, type RecipeDrizzle } from '../../database/database.module.js';
import { recipes, type RecipeRow } from '../../database/schema/recipes.js';
import {
    collections,
    recipeCollections,
    type CollectionRow,
    type RecipeCollectionRow,
} from '../../database/schema/collections.js';
import { recipeRatings, type RecipeRatingRow } from '../../database/schema/ratings.js';
import { recipePhotos, type RecipePhotoRow } from '../../database/schema/photos.js';
import { recipeVersions } from '../../database/schema/versions.js';
import { authorHandles, type AuthorHandleRow } from '../../database/schema/authorHandles.js';

/**
 * A `recipes` row as returned for export: every column EXCEPT the two internal search-index artifacts
 * (`search_vector`, `ingredient_names_text`), which are derived machinery, not the user's personal data.
 */
export type RecipeExportRow = Omit<RecipeRow, 'searchVector' | 'ingredientNamesText'>;

/** The version METADATA columns exported (the heavy `snapshot` JSONB is deliberately excluded). */
export interface VersionMetadataRow {
    readonly id: string;
    readonly recipeId: string;
    readonly versionNumber: number;
    readonly baseVersion: number | null;
    readonly s3Key: string | null;
    readonly createdBy: string;
    readonly changeSummary: string | null;
    readonly deviceLabel: string | null;
    readonly editorHandle: string | null;
    readonly createdAt: Date | string;
}

@Injectable()
export class AccountExportDal {
    public constructor(@Inject(DrizzleProvider) private readonly db: RecipeDrizzle) {}

    /**
     * Every recipe the owner owns — public, private, draft, AND tombstoned (no `deleted_at` filter; see
     * the module docstring). Ordered oldest-first for a stable, deterministic export.
     *
     * @param ownerId - The verified owner (app-user ULID).
     * @returns The owner's recipe rows, minus the internal search columns.
     * @sideEffect Reads `recipes`.
     */
    public async listRecipes(ownerId: string): Promise<RecipeExportRow[]> {
        const {
            searchVector: _searchVector,
            ingredientNamesText: _ingredientNamesText,
            ...columns
        } = getTableColumns(recipes);

        return this.db.select(columns).from(recipes).where(eq(recipes.ownerId, ownerId)).orderBy(recipes.createdAt);
    }

    /**
     * Every collection the owner owns, oldest-first.
     *
     * @param ownerId - The verified owner.
     * @returns The owner's collection rows.
     * @sideEffect Reads `collections`.
     */
    public async listCollections(ownerId: string): Promise<CollectionRow[]> {
        return this.db
            .select()
            .from(collections)
            .where(eq(collections.ownerId, ownerId))
            .orderBy(collections.createdAt);
    }

    /**
     * Every membership row belonging to one of the OWNER'S collections. Scoped by an INNER JOIN so a
     * membership can never surface under a collection the caller does not own.
     *
     * @param ownerId - The verified owner.
     * @returns The `recipe_collections` rows for the owner's collections.
     * @sideEffect Reads `recipe_collections` joined to `collections`.
     */
    public async listCollectionMemberships(ownerId: string): Promise<RecipeCollectionRow[]> {
        return this.db
            .select(getTableColumns(recipeCollections))
            .from(recipeCollections)
            .innerJoin(collections, eq(recipeCollections.collectionId, collections.id))
            .where(eq(collections.ownerId, ownerId));
    }

    /**
     * Every rating the owner authored, on ANY recipe (theirs or another user's), oldest-first. Keyed on
     * `user_id` exactly as the erasure sweep's `DELETE FROM recipe_ratings WHERE user_id = :owner`.
     *
     * @param ownerId - The verified owner (the rater).
     * @returns The owner's rating rows.
     * @sideEffect Reads `recipe_ratings`.
     */
    public async listRatings(ownerId: string): Promise<RecipeRatingRow[]> {
        return this.db
            .select()
            .from(recipeRatings)
            .where(eq(recipeRatings.userId, ownerId))
            .orderBy(recipeRatings.createdAt);
    }

    /**
     * Every photo attached to one of the owner's recipes, scoped by an INNER JOIN to `recipes` (photos
     * carry no owner column — they belong to a recipe, exactly as the erasure cascade treats them).
     *
     * @param ownerId - The verified owner.
     * @returns The `recipe_photos` rows for the owner's recipes.
     * @sideEffect Reads `recipe_photos` joined to `recipes`.
     */
    public async listPhotos(ownerId: string): Promise<RecipePhotoRow[]> {
        return this.db
            .select(getTableColumns(recipePhotos))
            .from(recipePhotos)
            .innerJoin(recipes, eq(recipePhotos.recipeId, recipes.id))
            .where(eq(recipes.ownerId, ownerId));
    }

    /**
     * Every version's METADATA for the owner's recipes, scoped by an INNER JOIN to `recipes`. The heavy
     * `snapshot` JSONB is excluded (see the module docstring).
     *
     * @param ownerId - The verified owner.
     * @returns The version-metadata rows for the owner's recipes.
     * @sideEffect Reads `recipe_versions` joined to `recipes`.
     */
    public async listVersions(ownerId: string): Promise<VersionMetadataRow[]> {
        return this.db
            .select({
                id: recipeVersions.id,
                recipeId: recipeVersions.recipeId,
                versionNumber: recipeVersions.versionNumber,
                baseVersion: recipeVersions.baseVersion,
                s3Key: recipeVersions.s3Key,
                createdBy: recipeVersions.createdBy,
                changeSummary: recipeVersions.changeSummary,
                deviceLabel: recipeVersions.deviceLabel,
                editorHandle: recipeVersions.editorHandle,
                createdAt: recipeVersions.createdAt,
            })
            .from(recipeVersions)
            .innerJoin(recipes, eq(recipeVersions.recipeId, recipes.id))
            .where(eq(recipes.ownerId, ownerId));
    }

    /**
     * The owner's author-handle read-model row(s). Keyed on `user_id` exactly as the erasure sweep's
     * `DELETE FROM author_handles WHERE user_id = :owner`. At most one row exists (the PK is `user_id`),
     * but a list keeps the DAL uniform and the assertion honest.
     *
     * @param ownerId - The verified owner.
     * @returns The owner's `author_handles` rows.
     * @sideEffect Reads `author_handles`.
     */
    public async listAuthorHandles(ownerId: string): Promise<AuthorHandleRow[]> {
        return this.db.select().from(authorHandles).where(eq(authorHandles.userId, ownerId));
    }
}
