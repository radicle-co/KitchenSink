/**
 * The pure row→export Data Mappers for `GET /api/v1/account/export`.
 *
 * Every function here is a pure transformation from a persisted row to its `AccountExport` fragment:
 * `timestamptz` values normalized to ISO-8601 strings, nulls carried through explicitly (a portability
 * document declares every field), and photo object keys resolved to CDN URLs. The impure assembly (the
 * DB reads) lives in `AccountExportService`; these are the composable, exhaustively-testable core.
 */
import { resolveCdnUrl } from '../photos/photoView.js';
import type { CollectionRow, RecipeCollectionRow } from '../database/schema/collections.js';
import type { RecipeRatingRow } from '../database/schema/ratings.js';
import type { RecipePhotoRow } from '../database/schema/photos.js';
import type { AuthorHandleRow } from '../database/schema/authorHandles.js';
import type { RecipeExportRow, VersionMetadataRow } from './dal/export.dal.js';
import type {
    AuthorHandleExport,
    CollectionExport,
    CollectionMembershipExport,
    PhotoExport,
    RatingExport,
    RecipeExport,
    VersionExport,
} from './dto/export.dto.js';

/** Normalize a `timestamptz` (a `Date` from pg, or an ISO string) to an ISO-8601 string. Pure. */
export function toIsoString(value: Date | string): string {
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/** Normalize a nullable `timestamptz` to an ISO-8601 string, preserving `null`. Pure. */
export function toIsoStringOrNull(value: Date | string | null): string | null {
    return value === null ? null : toIsoString(value);
}

/** Map a `recipes` row (minus internal search columns) to its export shape. Pure. */
export function mapRecipe(row: RecipeExportRow): RecipeExport {
    return {
        id: row.id,
        ownerId: row.ownerId,
        title: row.title,
        description: row.description,
        prepTimeMinutes: row.prepTimeMinutes,
        cookTimeMinutes: row.cookTimeMinutes,
        totalTimeMinutes: row.totalTimeMinutes,
        servings: row.servings,
        difficulty: row.difficulty,
        mealType: row.mealType,
        averageRating: row.averageRating,
        ratingCount: row.ratingCount,
        visibility: row.visibility,
        status: row.status,
        sourceType: row.sourceType,
        sourceUrl: row.sourceUrl,
        sourceAttribution: row.sourceAttribution,
        clonedFromId: row.clonedFromId,
        hasSubstantiveEdit: row.hasSubstantiveEdit,
        cuisine: row.cuisine,
        dietaryFlags: row.dietaryFlags,
        tags: row.tags,
        // ⛔ `hasPartialNutrition` and `leadCaloriesPerServing` are GONE from the export (plan U10). Both
        // were derived from food's data and stored here, so exporting them shipped the user a value frozen
        // at its last pre-migration write — a stale number presented as their record.
        authorHandle: row.authorHandle,
        currentVersion: row.currentVersion,
        deletedAt: toIsoStringOrNull(row.deletedAt),
        createdAt: toIsoString(row.createdAt),
        updatedAt: toIsoString(row.updatedAt),
    };
}

/** Map a `recipe_collections` junction row to a collection membership. Pure. */
export function mapMembership(row: RecipeCollectionRow): CollectionMembershipExport {
    return {
        recipeId: row.recipeId,
        addedAt: toIsoString(row.addedAt),
        addedVia: row.addedVia,
    };
}

/**
 * Map a `collections` row plus its (already owner-scoped) membership rows to a collection export.
 *
 * `memberships` is the full owner-wide set; only those whose `collectionId` matches this collection are
 * embedded, so grouping N collections × M memberships is done by the caller iterating collections. Pure.
 *
 * @param row - The collection row.
 * @param memberships - All of the owner's membership rows (filtered here by `collectionId`).
 */
export function mapCollection(row: CollectionRow, memberships: readonly RecipeCollectionRow[]): CollectionExport {
    return {
        id: row.id,
        ownerId: row.ownerId,
        name: row.name,
        description: row.description,
        visibility: row.visibility,
        sourceCollectionId: row.sourceCollectionId,
        lastPulledAt: toIsoStringOrNull(row.lastPulledAt),
        sourceOwnerHandle: row.sourceOwnerHandle,
        sourceCollectionName: row.sourceCollectionName,
        createdAt: toIsoString(row.createdAt),
        updatedAt: toIsoString(row.updatedAt),
        recipes: memberships.filter((member) => member.collectionId === row.id).map(mapMembership),
    };
}

/** Map a `recipe_ratings` row to its export shape. Pure. */
export function mapRating(row: RecipeRatingRow): RatingExport {
    return {
        id: row.id,
        recipeId: row.recipeId,
        userId: row.userId,
        stars: row.stars,
        createdAt: toIsoString(row.createdAt),
        updatedAt: toIsoString(row.updatedAt),
    };
}

/**
 * Map a `recipe_photos` row to its export shape, resolving both the full-size and thumbnail CDN URLs
 * against `cloudfrontUrl`. The bytes are never included — only keys and their resolved URLs. Pure.
 *
 * @param row - The photo row.
 * @param cloudfrontUrl - The CDN base URL used to resolve object keys to URLs.
 */
export function mapPhoto(row: RecipePhotoRow, cloudfrontUrl: string): PhotoExport {
    return {
        id: row.id,
        recipeId: row.recipeId,
        key: row.s3Key,
        url: resolveCdnUrl(cloudfrontUrl, row.s3Key),
        thumbnailKey: row.thumbnailKey,
        thumbnailUrl: row.thumbnailKey === null ? null : resolveCdnUrl(cloudfrontUrl, row.thumbnailKey),
        contentType: row.contentType,
        sizeBytes: row.sizeBytes,
        sortOrder: row.sortOrder,
        createdAt: toIsoString(row.createdAt),
        updatedAt: toIsoString(row.updatedAt),
    };
}

/** Map a version-metadata row to its export shape (never the snapshot blob). Pure. */
export function mapVersion(row: VersionMetadataRow): VersionExport {
    return {
        id: row.id,
        recipeId: row.recipeId,
        versionNumber: row.versionNumber,
        baseVersion: row.baseVersion,
        s3Key: row.s3Key,
        createdBy: row.createdBy,
        changeSummary: row.changeSummary,
        editorHandle: row.editorHandle,
        createdAt: toIsoString(row.createdAt),
    };
}

/** Map an `author_handles` row to its export shape. Pure. */
export function mapAuthorHandle(row: AuthorHandleRow): AuthorHandleExport {
    return {
        userId: row.userId,
        displayName: row.displayName,
        sourceTimestamp: toIsoString(row.sourceTimestamp),
    };
}
