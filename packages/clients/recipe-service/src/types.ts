/**
 * Wire request/response shapes for `@kitchensink/recipe-service-client` (T-004 / T-095) that have NO
 * canonical equivalent in `@kitchensink/recipe-core`. The core domain types (`Recipe`, `Collection`,
 * `Ingredient`, `RecipePhoto`, `RecipeVersion`, `CreateRecipeInput`, `UpdateRecipeInput`,
 * `RecipeSearchParams`, `PaginatedResponse`) are imported directly from `@kitchensink/recipe-core`;
 * only the endpoint-specific envelopes/requests (photos, collections, search, versions, erasure) are
 * declared here, mirroring `contracts/api.openapi.yaml`. Dates are ISO-8601 strings (CODING_STANDARDS).
 */
import type { Collection, Recipe, RecipeSearchParams, RecipeVisibility } from '@kitchensink/recipe-core';

/** Sort key for `listRecipes` (`GET /v1/recipes`). */
export type RecipeListSortBy = 'updatedAt' | 'createdAt' | 'title';

/** Query parameters for `listRecipes`. */
export interface ListRecipesParams {
    readonly page?: number;
    readonly pageSize?: number;
    readonly sortBy?: RecipeListSortBy;
}

/** Query parameters for `listCollections` (`GET /v1/collections`). */
export interface ListCollectionsParams {
    readonly page?: number;
    readonly pageSize?: number;
}

/** Request body for `createPhotoUploadUrl` (`POST /v1/recipes/{id}/photos/upload-url`). */
export interface PhotoUploadUrlRequest {
    readonly fileName: string;
    readonly contentType: string;
    /** File size in bytes (≤ 5 MiB, per the contract). */
    readonly fileSize: number;
}

/** Response from `createPhotoUploadUrl`: a presigned S3 URL for a direct client upload. */
export interface UploadUrlResponse {
    readonly uploadUrl: string;
    readonly key: string;
    /** Presigned-URL expiry, in seconds. */
    readonly expiresIn: number;
    /** The maximum object size (bytes) the client must respect for this upload. */
    readonly maxBytes: number;
}

/** Request body for `confirmPhotoUpload` (`POST /v1/recipes/{id}/photos/confirm`). */
export interface PhotoConfirmRequest {
    readonly key: string;
    readonly contentType: string;
}

/** Request body for `createCollection` (`POST /v1/collections`). */
export interface CreateCollectionRequest {
    readonly name: string;
    readonly description?: string;
    /** Collection visibility (FR-010); defaults to `private` server-side. */
    readonly visibility?: RecipeVisibility;
}

/** Request body for `updateCollection` (`PATCH /v1/collections/{id}`); at least one field is required. */
export interface UpdateCollectionRequest {
    readonly name?: string;
    readonly description?: string;
    readonly visibility?: RecipeVisibility;
}

/** Response from `getCollectionById`: a collection plus its member recipes. */
export type CollectionWithRecipes = Collection & { readonly recipes?: readonly Recipe[] };

/** Provenance of a recipe's membership in a collection (`manual` | `clone_seed` | `pull`). */
export type CollectionRecipeAddedVia = 'manual' | 'clone_seed' | 'pull';

/** Response from `addRecipeToCollection`: the created membership join record. */
export interface CollectionRecipeMembership {
    readonly collectionId: string;
    readonly recipeId: string;
    readonly addedVia: CollectionRecipeAddedVia;
    readonly createdAt: string;
}

/** Optional overrides for `cloneCollection` (`POST /v1/collections/{id}/clone`). */
export interface CloneCollectionRequest {
    readonly name?: string;
    readonly description?: string;
}

/** Response from `pullCollectionFromSource` (`POST /v1/collections/{id}/pull-from-source`). */
export interface PullFromSourceResponse {
    readonly collection: Collection;
    /** Recipe ids added to the collection by this pull. */
    readonly addedRecipeIds: readonly string[];
}

/** Optional request body for `requestAccountErasure` (`POST /v1/account/erasure`). */
export interface ErasureRequest {
    /** Optional confirmation phrase the server validates before queuing the job. */
    readonly confirmationPhrase?: string;
}

/** Response from `requestAccountErasure`: the (possibly pre-existing, idempotent) erasure job. */
export interface ErasureRequestAcceptedResponse {
    readonly jobId: string;
    readonly status: 'queued' | 'running';
}

/** Response from `restoreRecipeVersion` (`POST /v1/recipes/{id}/versions/{versionNumber}/restore`). */
export interface RestoreVersionResponse {
    readonly recipe: Recipe;
    readonly restoredFromVersion: number;
    readonly currentVersion: number;
}

/** Facet count map (`{ facetValue: count }`) for a single search facet. */
export type RecipeSearchFacetCounts = Readonly<Record<string, number>>;

/** Facet counts returned alongside recipe search results. */
export interface RecipeSearchFacets {
    readonly cuisine?: RecipeSearchFacetCounts;
    readonly dietaryFlags?: RecipeSearchFacetCounts;
    readonly tags?: RecipeSearchFacetCounts;
}

/** Response from `searchRecipes` (`GET /v1/search/recipes`). */
export interface RecipeSearchResponse {
    readonly results: readonly Recipe[];
    readonly total: number;
    readonly page: number;
    readonly pageSize: number;
    readonly hasMore: boolean;
    readonly facets: RecipeSearchFacets;
    /** Echo of the filters the server actually applied. */
    readonly appliedFilters?: RecipeSearchParams;
}
