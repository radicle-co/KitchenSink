/**
 * Domain + wire types for the Collections vertical (T039–T041, T140). These mirror the
 * `Collection` / `CollectionWithRecipes` / `CollectionRecipeMembership` schemas in
 * `specs/001-commise-recipe-app/contracts/api.openapi.yaml`.
 *
 * The shared `@kitchensink/recipe-core` `Collection` interface intentionally omits `visibility` and
 * `recipeCount` (they are surfaced only at the service boundary), so the API response shapes are
 * defined here, close to the controller that emits them. `visibility` reuses the single source of
 * truth from the Drizzle schema (`COLLECTION_VISIBILITIES`).
 */
import type { IsoDateTimeString, Recipe, RecipeCollectionAddedVia } from '@kitchensink/recipe-core';

import type { CollectionVisibility } from '../database/schema/collections.js';

/** Input to create a collection (owner comes from the verified principal, never the body). */
export interface CreateCollectionInput {
    readonly name: string;
    readonly description?: string;
    readonly visibility?: CollectionVisibility;
}

/**
 * Input to update a collection. Every field is optional (PATCH semantics); `visibility` is typed as a
 * raw `string` on purpose so the service is the enforcement point for an invalid value (FR-010 / T140)
 * rather than relying solely on the controller's request validation.
 */
export interface UpdateCollectionInput {
    readonly name?: string;
    readonly description?: string;
    readonly visibility?: string;
}

/** Pagination window (1-based page → limit/offset is computed by the service). */
export interface PageParams {
    readonly page: number;
    readonly pageSize: number;
}

/** The `Collection` wire schema (owner-visible; `recipeCount` present on single-collection reads). */
export interface CollectionResponse {
    readonly id: string;
    readonly ownerId: string;
    readonly name: string;
    readonly description?: string;
    readonly visibility: CollectionVisibility;
    readonly recipeCount?: number;
    readonly sourceCollectionId?: string;
    /** The source owner's display handle, FROZEN at clone time (W5 Task 2); absent when unresolved. */
    readonly sourceOwnerHandle?: string;
    /** The source collection's name, FROZEN at clone time (W5 Task 2). */
    readonly sourceCollectionName?: string;
    /** When this collection was last refreshed from its source (W5 Task 3); absent if never pulled. */
    readonly lastPulledAt?: IsoDateTimeString;
    readonly createdAt: IsoDateTimeString;
    readonly updatedAt: IsoDateTimeString;
}

/** The `CollectionWithRecipes` wire schema — a collection plus its (non-tombstoned) recipes. */
export interface CollectionWithRecipesResponse extends CollectionResponse {
    readonly recipes: Recipe[];
}

/**
 * The `PullFromSourceResponse` wire schema — the result of an opt-in pull-from-source (FR-011).
 *
 * Shape is fixed by `contracts/api.openapi.yaml` (`required: [collection, addedRecipeIds]`), so it
 * returns the resulting collection plus exactly which recipes this pull added — an empty
 * `addedRecipeIds` is the ordinary "source had nothing new" outcome, not an error. There is
 * deliberately no `removed` field: a pull is additive, and recipes the caller can no longer access are
 * filtered at read time rather than deleted here.
 */
export interface PullFromSourceResult {
    readonly collection: CollectionResponse;
    readonly addedRecipeIds: string[];
}

/** Optional overrides for a clone's own name/description (`CloneCollectionRequest`, FR-011). */
export interface CloneCollectionInput {
    readonly name?: string;
    readonly description?: string;
}

/** The `CollectionRecipeMembership` wire schema returned when a recipe is added to a collection. */
export interface CollectionRecipeMembershipResponse {
    readonly collectionId: string;
    readonly recipeId: string;
    readonly addedVia: RecipeCollectionAddedVia;
    readonly createdAt: IsoDateTimeString;
}
