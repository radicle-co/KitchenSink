/**
 * The response DTOs for `GET /api/v1/account/export` — the GDPR Art. 15 (access) / Art. 20 (portability)
 * export of the CALLER'S OWN recipe-domain personal data, mirroring the `AccountExport` schema in
 * `api.openapi.yaml`.
 *
 * This is the read-only INVERSE of the erasure worker (`@kitchensink/recipe-workers`
 * `account-erasure-worker.ts`): it returns exactly the owner-scoped roots that erasure hard-deletes or
 * keeps — the user's recipes (ALL: public, private, drafts, and tombstoned), their collections +
 * memberships, their ratings on ANY recipe, their author handle(s), and the metadata (never the bytes)
 * of the photos and version snapshots attached to their recipes. "What we hold about you" therefore
 * equals "what erasure removes/keeps".
 *
 * Two deliberate shape decisions, both for a machine-readable export rather than the API's read contracts:
 *
 *  - **Absent values are explicit `null`, not omitted.** Unlike the recipe read-path Data Mapper (which
 *    omits nulls), a portability document benefits from a STABLE, fully-declared shape a consumer can
 *    rely on field-for-field, so every nullable column is present as `T | null`.
 *  - **Dates are ISO-8601 strings** (§Dates), normalized from the `timestamptz` columns.
 */

/** A single owner-scoped recipe (the `recipes` golden row), including tombstoned/draft/private rows. */
export interface RecipeExport {
    /** The recipe id (`recipes.id`, a UUID). */
    readonly id: string;
    /** The owner's app-user ULID (`recipes.owner_id`) — always the caller. */
    readonly ownerId: string;
    readonly title: string;
    readonly description: string | null;
    readonly prepTimeMinutes: number;
    readonly cookTimeMinutes: number;
    readonly totalTimeMinutes: number;
    readonly servings: number;
    /** Author-stated difficulty (`easy`/`medium`/`hard`), or `null` when not stated. */
    readonly difficulty: string | null;
    /** Denormalized rating aggregate (`numeric` → string), `null` when unrated. */
    readonly averageRating: string | null;
    readonly ratingCount: number;
    readonly visibility: string;
    readonly status: string;
    readonly sourceType: string;
    readonly sourceUrl: string | null;
    readonly sourceAttribution: string | null;
    /** Clone provenance: the recipe this was cloned FROM, or `null` for an original. */
    readonly clonedFromId: string | null;
    readonly hasSubstantiveEdit: boolean;
    readonly cuisine: string | null;
    readonly dietaryFlags: readonly string[];
    readonly tags: readonly string[];
    readonly hasPartialNutrition: boolean;
    /** Denormalized headline per-serving calories (`numeric` → string), `null` when unaccounted. */
    readonly leadCaloriesPerServing: string | null;
    readonly authorHandle: string | null;
    readonly currentVersion: number;
    /** Soft-delete tombstone (ISO-8601), or `null` when active. Present so an export is a faithful mirror. */
    readonly deletedAt: string | null;
    /** When this recipe was created. ISO 8601. */
    readonly createdAt: string;
    /** When this recipe was last updated. ISO 8601. */
    readonly updatedAt: string;
}

/** One recipe's membership in a collection (a `recipe_collections` junction row). */
export interface CollectionMembershipExport {
    /** The member recipe's id. */
    readonly recipeId: string;
    /** When the recipe was added to the collection. ISO 8601. */
    readonly addedAt: string;
    /** Provenance of how it entered the collection (`manual`/`clone_seed`/`pull`). */
    readonly addedVia: string;
}

/** A single owner-scoped collection (the `collections` row) with its memberships embedded. */
export interface CollectionExport {
    readonly id: string;
    readonly ownerId: string;
    readonly name: string;
    readonly description: string | null;
    readonly visibility: string;
    /** Clone provenance: the collection this was cloned FROM, or `null` for an original. */
    readonly sourceCollectionId: string | null;
    /** Last pull-refresh time (ISO 8601), or `null` if never pulled. */
    readonly lastPulledAt: string | null;
    readonly sourceOwnerHandle: string | null;
    readonly sourceCollectionName: string | null;
    /** When this collection was created. ISO 8601. */
    readonly createdAt: string;
    /** When this collection was last updated. ISO 8601. */
    readonly updatedAt: string;
    /** The recipes in this collection (its `recipe_collections` junction rows). */
    readonly recipes: readonly CollectionMembershipExport[];
}

/** A single rating the owner authored on ANY recipe (a `recipe_ratings` row keyed by `user_id`). */
export interface RatingExport {
    readonly id: string;
    /** The rated recipe's id — may belong to another user (the owner's rating on their recipe). */
    readonly recipeId: string;
    /** The rater's app-user ULID (`recipe_ratings.user_id`) — always the caller. */
    readonly userId: string;
    readonly stars: number;
    /** When the rating was created. ISO 8601. */
    readonly createdAt: string;
    /** When the rating was last updated. ISO 8601. */
    readonly updatedAt: string;
}

/** Metadata (never the bytes) for one photo attached to an owner's recipe (a `recipe_photos` row). */
export interface PhotoExport {
    readonly id: string;
    readonly recipeId: string;
    /** The full-size object's S3 key. */
    readonly key: string;
    /** The resolved CDN URL of the full-size object (the bytes are not included). */
    readonly url: string;
    /** The cover-thumbnail rendition's S3 key, or `null` when the photo has no thumbnail. */
    readonly thumbnailKey: string | null;
    /** The resolved CDN URL of the thumbnail rendition, or `null` when there is none. */
    readonly thumbnailUrl: string | null;
    readonly contentType: string;
    readonly sizeBytes: number | null;
    /** The 0-based stored display order (`recipe_photos.sort_order`). */
    readonly sortOrder: number;
    /** When the photo was created. ISO 8601. */
    readonly createdAt: string;
    /** When the photo was last updated. ISO 8601. */
    readonly updatedAt: string;
}

/** Metadata (never the snapshot blob) for one version of an owner's recipe (a `recipe_versions` row). */
export interface VersionExport {
    readonly id: string;
    readonly recipeId: string;
    readonly versionNumber: number;
    /** The base version this one was authored against (3-way merge), or `null`. */
    readonly baseVersion: number | null;
    /** The S3 archive key for the snapshot, or `null` when DB-only so far. */
    readonly s3Key: string | null;
    /** The version's author (`recipe_versions.created_by`, the app-user ULID) — always the caller. */
    readonly createdBy: string;
    readonly changeSummary: string | null;
    readonly deviceLabel: string | null;
    readonly editorHandle: string | null;
    /** When the version was created. ISO 8601. */
    readonly createdAt: string;
}

/** The owner's author-handle read-model row(s) (`author_handles`, keyed by `user_id`). */
export interface AuthorHandleExport {
    /** The owner's app-user ULID (`author_handles.user_id`) — always the caller. */
    readonly userId: string;
    readonly displayName: string;
    /** The source timestamp the monotonic handle-sync guard compares. ISO 8601. */
    readonly sourceTimestamp: string;
}

/**
 * The complete `GET /api/v1/account/export` document: every recipe-domain personal-data root the caller
 * owns, as a single structured, machine-readable JSON payload (Art. 20 portability).
 *
 * `ownerId` echoes the VERIFIED token owner the export was scoped to (never a client-supplied value), so
 * the document self-documents whose data it contains.
 */
export interface AccountExport {
    /** When this export was generated. ISO 8601. */
    readonly exportedAt: string;
    /** The verified owner (app-user ULID) whose data this document contains. */
    readonly ownerId: string;
    readonly recipes: readonly RecipeExport[];
    readonly collections: readonly CollectionExport[];
    readonly ratings: readonly RatingExport[];
    readonly photos: readonly PhotoExport[];
    readonly versions: readonly VersionExport[];
    readonly authorHandles: readonly AuthorHandleExport[];
}
