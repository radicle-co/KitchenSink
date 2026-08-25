/**
 * `make*` fixture factories for the account-export tests — one per persisted row shape the
 * `AccountExportDal` returns, each accepting `Partial<T>` overrides over a complete, sensible
 * default. Dates default to `Date` objects (as `node-postgres` yields for `timestamptz`), so the mapper
 * tests exercise the real `Date → ISO` normalization rather than a pre-stringified shortcut.
 */
import type { CollectionRow, RecipeCollectionRow } from '../../database/schema/collections.js';
import type { RecipeRatingRow } from '../../database/schema/ratings.js';
import type { RecipePhotoRow } from '../../database/schema/photos.js';
import type { AuthorHandleRow } from '../../database/schema/authorHandles.js';
import type { RecipeExportRow, VersionMetadataRow } from '../dal/export.dal.js';

/** A stable owner ULID the fixtures default to. */
export const FIXTURE_OWNER = '01JEXPORTOWNER0000000000AA';

const CREATED = new Date('2026-01-15T12:00:00.000Z');
const UPDATED = new Date('2026-02-20T09:30:00.000Z');

/** Build a `recipes` export row (all columns except the internal search artifacts). */
export function makeRecipeRow(overrides: Partial<RecipeExportRow> = {}): RecipeExportRow {
    return {
        id: '00000000-0000-4000-8000-00000000r001',
        ownerId: FIXTURE_OWNER,
        title: 'Classic Margherita Pizza',
        description: 'A simple pizza.',
        prepTimeMinutes: 20,
        cookTimeMinutes: 10,
        totalTimeMinutes: 30,
        servings: 4,
        difficulty: 'easy',
        mealType: 'dinner',
        averageRating: '4.50',
        ratingCount: 2,
        visibility: 'public',
        status: 'published',
        sourceType: 'user_created',
        sourceUrl: null,
        sourceAttribution: null,
        clonedFromId: null,
        hasSubstantiveEdit: false,
        cuisine: 'Italian',
        dietaryFlags: ['vegetarian'],
        tags: ['dinner'],
        authorHandle: 'chef-anna',
        currentVersion: 1,
        deletedAt: null,
        createdAt: CREATED,
        updatedAt: UPDATED,
        ...overrides,
    };
}

/** Build a `collections` row. */
export function makeCollectionRow(overrides: Partial<CollectionRow> = {}): CollectionRow {
    return {
        id: '00000000-0000-4000-8000-00000000c001',
        ownerId: FIXTURE_OWNER,
        name: 'Weeknight dinners',
        description: null,
        visibility: 'private',
        sourceCollectionId: null,
        lastPulledAt: null,
        sourceOwnerHandle: null,
        sourceCollectionName: null,
        createdAt: CREATED,
        updatedAt: UPDATED,
        ...overrides,
    };
}

/** Build a `recipe_collections` junction row. */
export function makeMembershipRow(overrides: Partial<RecipeCollectionRow> = {}): RecipeCollectionRow {
    return {
        collectionId: '00000000-0000-4000-8000-00000000c001',
        recipeId: '00000000-0000-4000-8000-00000000r001',
        addedAt: CREATED,
        addedVia: 'manual',
        ...overrides,
    };
}

/** Build a `recipe_ratings` row. */
export function makeRatingRow(overrides: Partial<RecipeRatingRow> = {}): RecipeRatingRow {
    return {
        id: '00000000-0000-4000-8000-00000000a001',
        recipeId: '00000000-0000-4000-8000-0000000other',
        userId: FIXTURE_OWNER,
        stars: 5,
        createdAt: CREATED,
        updatedAt: UPDATED,
        ...overrides,
    };
}

/** Build a `recipe_photos` row. */
export function makePhotoRow(overrides: Partial<RecipePhotoRow> = {}): RecipePhotoRow {
    return {
        id: '00000000-0000-4000-8000-00000000p001',
        recipeId: '00000000-0000-4000-8000-00000000r001',
        s3Key: `recipes/${FIXTURE_OWNER}/photos/original.jpg`,
        thumbnailKey: `recipes/${FIXTURE_OWNER}/photos/thumb.jpg`,
        contentType: 'image/jpeg',
        sizeBytes: 123456,
        sortOrder: 0,
        createdAt: CREATED,
        updatedAt: UPDATED,
        ...overrides,
    };
}

/** Build a version-metadata row (no snapshot blob). */
export function makeVersionRow(overrides: Partial<VersionMetadataRow> = {}): VersionMetadataRow {
    return {
        id: '00000000-0000-4000-8000-00000000v001',
        recipeId: '00000000-0000-4000-8000-00000000r001',
        versionNumber: 1,
        baseVersion: null,
        s3Key: null,
        createdBy: FIXTURE_OWNER,
        changeSummary: 'Initial version',
        deviceLabel: null,
        editorHandle: 'chef-anna',
        createdAt: CREATED,
        ...overrides,
    };
}

/** Build an `author_handles` row. */
export function makeAuthorHandleRow(overrides: Partial<AuthorHandleRow> = {}): AuthorHandleRow {
    return {
        userId: FIXTURE_OWNER,
        displayName: 'Chef Anna',
        sourceTimestamp: UPDATED,
        ...overrides,
    };
}
