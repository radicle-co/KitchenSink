/**
 * Wire request/response shapes for `@kitchensink/recipe-service-client` (T-004 / T-095) that have NO
 * canonical equivalent in `@kitchensink/recipe-core`. The core domain types (`Recipe`, `Ingredient`,
 * `RecipePhoto`, `RecipeVersion`, `CreateRecipeInput`, `UpdateRecipeInput`, `RecipeSearchParams`,
 * `PaginatedResponse`) are imported directly from `@kitchensink/recipe-core`; only the endpoint-specific
 * envelopes/requests (photos, collections, search, versions, erasure) are declared here, mirroring
 * `contracts/api.openapi.yaml`. Dates are ISO-8601 strings (CODING_STANDARDS).
 *
 * `Collection` is the ONE exception: it is re-declared here (W5 Task 5) as `@kitchensink/recipe-core`'s
 * `Collection` WIDENED with the recipe service's response-only pull-provenance fields (see below) — every
 * client method that returns a collection returns THIS shape, not the narrower core entity.
 */
import type { RecipeSearchFacets } from '@kitchensink/schema-recipe';

// The search and ingredient wire shapes now live in the GENERATED contract. Re-exported here so modules that
// already import them from `./types.js` keep working, and so there is exactly ONE declaration behind both
// paths. NOTHING below is re-declared: where a name here differs from the contract's, it is an ALIAS of the
// contract type, never a second definition (§15 Rule 1).
export type { RecipeSearchFacets, RecipeSearchResponse } from '@kitchensink/schema-recipe';

export type { AddIngredientByFoodRequest, IngredientCandidate } from '@kitchensink/schema-recipe';

/**
 * The photo-upload wire shapes, from the contract. `PhotoUploadUrlRequest`/`PhotoConfirmRequest`/
 * `UploadUrlResponse` are the client's historical NAMES for them, kept because this package's public surface
 * and its consumers use them; each is an ALIAS of the contract type, never a second declaration. The client's
 * copies had already drifted — both request types widened `contentType` to a bare `string`, which is what the
 * validation layer enforces, so the alias is the honest shape either way.
 */
export type {
    ConfirmPhotoRequest as PhotoConfirmRequest,
    CreatePhotoUploadRequest as PhotoUploadUrlRequest,
    PhotoUploadUrlResponse as UploadUrlResponse,
} from '@kitchensink/schema-recipe';
// Imported (not merely re-exported) because `IngredientSuggestionProvenance` below is DERIVED from it, and a
// re-export does not bring a name into this module's scope.
import type { IngredientSuggestion } from '@kitchensink/schema-recipe';

export type { IngredientSuggestion } from '@kitchensink/schema-recipe';

/**
 * Whether the food catalog contributed to a blend (F2). ALIAS of the contract's `CatalogAvailability` — the
 * client-side name is kept because 25 export sites and 5 consumer files use it, and renaming it would be a
 * breaking change to this package's public surface for no gain.
 */
export type { CatalogAvailability as IngredientCatalogAvailability } from '@kitchensink/schema-recipe';

/** Response envelope of `suggestIngredients`. ALIAS of the contract's `IngredientSuggestionsResponse`. */
export type { IngredientSuggestionsResponse as IngredientSuggestions } from '@kitchensink/schema-recipe';

import type { Collection as CoreCollection, Recipe, RecipeVisibility } from '@kitchensink/recipe-core';

/** Sort key for `listRecipes` (`GET /api/v1/recipes`). */
export type RecipeListSortBy = 'updatedAt' | 'createdAt' | 'title';

/** Query parameters for `listRecipes`. */
export interface ListRecipesParams {
    readonly page?: number;
    readonly pageSize?: number;
    readonly sortBy?: RecipeListSortBy;
}

/** Query parameters for `listCollections` (`GET /api/v1/collections`). */
export interface ListCollectionsParams {
    readonly page?: number;
    readonly pageSize?: number;
}

/**
 * Where a blended typeahead suggestion came from (`GET /api/v1/ingredients/suggest`, search Stage 2).
 *
 *  - `local` — a real `ingredients` catalog row. Pickable as-is: its `id` is a valid recipe-line
 *    `ingredientId`, and it carries whatever nutrition the row already has.
 *  - `catalog` — a food-service golden record with **no `ingredients` row yet**. It has NO ingredient id and
 *    NO nutrition; picking it must first ADMIT it via `addIngredientByFood`.
 *
 * DERIVED from the contract's discriminated union rather than declared, so it cannot drift from the values the
 * service actually sends — the same pattern as `RecipeSearchFacetCounts` below.
 */
export type IngredientSuggestionProvenance = IngredientSuggestion['provenance'];

/** Request body for `createCollection` (`POST /api/v1/collections`). */
export interface CreateCollectionRequest {
    readonly name: string;
    readonly description?: string;
    /** Collection visibility (FR-010); defaults to `private` server-side. */
    readonly visibility?: RecipeVisibility;
}

/** Request body for `updateCollection` (`PATCH /api/v1/collections/{id}`); at least one field is required. */
export interface UpdateCollectionRequest {
    readonly name?: string;
    readonly description?: string;
    readonly visibility?: RecipeVisibility;
}

/**
 * The `Collection` wire shape, widened (W5 Task 5) with the pull-provenance projections the recipe
 * service's collection endpoints now return: `lastPulledAt` (the last successful pull, W5 Task 3) and
 * `sourceOwnerHandle` / `sourceCollectionName` (the source's attribution, FROZEN at clone time — W5 Task
 * 2). All three are absent for a collection that was never cloned (the two source fields) or never pulled
 * (`lastPulledAt`). Widened HERE rather than on `@kitchensink/recipe-core`'s `Collection` because these
 * are recipe-service response-only projections (mirroring the service's own `CollectionResponse`), not
 * part of the domain-core entity every service shares.
 */
export type Collection = CoreCollection & {
    /** The source owner's display handle, frozen at clone time; absent when unresolved or never cloned. */
    readonly sourceOwnerHandle?: string;
    /** The source collection's name, frozen at clone time; absent when never cloned. */
    readonly sourceCollectionName?: string;
    /** When this collection was last refreshed from its source; absent if never pulled. */
    readonly lastPulledAt?: string;
};

/** Provenance of a recipe's membership in a collection (`manual` | `clone_seed` | `pull`). */
export type CollectionRecipeAddedVia = 'manual' | 'clone_seed' | 'pull';

/**
 * A recipe as it appears within a collection embed (W5 Task 4/5): the `Recipe` wire shape plus this
 * member's provenance, so the client can render the source-indicator without a second membership lookup.
 */
export type CollectionMemberRecipe = Recipe & { readonly addedVia: CollectionRecipeAddedVia };

/** Response from `getCollectionById`: a collection plus its member recipes. */
export type CollectionWithRecipes = Collection & { readonly recipes?: readonly CollectionMemberRecipe[] };

/**
 * The three-way pull-from-source diff (W5 Task 5): a three-way partition of `source ∪ clone`, echoed by
 * `previewPullFromSource` (read-only) and re-derived live by `pullCollectionFromSource`'s drift check.
 * Mirrors the recipe service's `PullDiff` (`collections/domain/pull-diff.ts`).
 */
export interface PullDiff {
    /** Recipes in the source but not the clone — the pull WILL add these. */
    readonly added: readonly string[];
    /** Recipes in the clone but not the source — informational; a pull never removes them. */
    readonly removed: readonly string[];
    /** Recipes in both — already present; the pull is a no-op for these. */
    readonly unchanged: readonly string[];
}

/** Response from `addRecipeToCollection`: the created membership join record. */
export interface CollectionRecipeMembership {
    readonly collectionId: string;
    readonly recipeId: string;
    readonly addedVia: CollectionRecipeAddedVia;
    readonly createdAt: string;
}

/** Optional overrides for `cloneCollection` (`POST /api/v1/collections/{id}/clone`). */
export interface CloneCollectionRequest {
    readonly name?: string;
    readonly description?: string;
}

/** Response from `pullCollectionFromSource` (`POST /api/v1/collections/{id}/pull-from-source`). */
export interface PullFromSourceResponse {
    readonly collection: Collection;
    /** Recipe ids added to the collection by this pull. */
    readonly addedRecipeIds: readonly string[];
}

/**
 * Request body for `requestAccountErasure` (`POST /api/v1/account/erasure`) — mirrors the recipe service's
 * `ErasureRequestDto` EXACTLY (CR-002 / U3b). Historically this carried only an OPTIONAL `confirmationPhrase`
 * and no election, which no longer matches the shipped contract: the phrase is REQUIRED (U7 — an irreversible
 * action must never proceed without a deliberate intent gate; a missing/empty/mismatched phrase is a `400`),
 * and the per-recipe donate election travels alongside it.
 */
export interface ErasureRequest {
    /**
     * The exact confirmation phrase gating the irreversible erasure (U7). REQUIRED. The canonical literal and
     * the client-side match predicate live in `@commise/features-account`
     * (`ACCOUNT_ERASURE_CONFIRMATION_PHRASE` / `confirmsErasurePhrase`) so the UI renders ONE authoritative
     * copy; this type only carries the value the caller collected. The server re-validates it.
     */
    readonly confirmationPhrase: string;
    /**
     * The per-recipe DONATE election (CR-002 / U3b): ids of the caller's OWNER-ONLY recipes elected to be
     * PUBLISHED (donated — flipped to `public` + `published`, surviving the erasure attributed to a pseudonym
     * the erased owner no longer controls) instead of removed. Absent/empty ⇒ donate nothing, so every
     * owner-only recipe is removed (the default). The server scopes the publish-flip to `owner_id = caller`,
     * so an id the caller does not own — or one already public — is a harmless no-op, and it is bounded
     * server-side (a payload-size guard).
     */
    readonly publishRecipeIds?: readonly string[];
}

/** Response from `requestAccountErasure`: the (possibly pre-existing, idempotent) erasure job. */
export interface ErasureRequestAcceptedResponse {
    readonly jobId: string;
    readonly status: 'queued' | 'running';
}

/**
 * Ordered facet buckets for a single search facet (an object-per-bucket, extensible per entry).
 *
 * DERIVED from the generated contract rather than declared, so it cannot drift from what the service sends.
 */
export type RecipeSearchFacetCounts = RecipeSearchFacets['tags'];
