/**
 * The wire-shape SURFACE of `@kitchensink/recipe-service-client` (T-004 / T-095) — almost entirely ALIASES now.
 *
 * WHAT THIS FILE IS FOR, AFTER §15. The domain types (`Recipe`, `Ingredient`, `RecipePhoto`, `RecipeVersion`,
 * `CreateRecipeInput`, `UpdateRecipeInput`, `RecipeSearchParams`, `PaginatedResponse`) come from
 * `@kitchensink/recipe-core`; every endpoint ENVELOPE comes from `@kitchensink/schema-recipe`, the contract the
 * service itself authors. This module's remaining job is to keep this package's public names stable while the
 * definitions behind them live where they belong: each re-export below is an alias, so a name that differs from
 * the contract's is a rename and never a second definition (§15 Rule 1).
 *
 * It used to hold 276 lines of independently-declared wire types that nothing checked against the server —
 * `typecheck` could not see a backend shape change, so the only place a mismatch surfaced was a ~50-minute
 * emulator run or production (§15.1). What genuinely remains local is listed and justified in place: request
 * OPTION shapes a caller passes before serialization (`ListRecipesParams`, `ListCollectionsParams`), and types
 * DERIVED from a contract type with an indexed access.
 *
 * Dates are ISO-8601 strings (CODING_STANDARDS).
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

/**
 * The COLLECTIONS wire shapes, from the contract. Every name below is an ALIAS of a generated type, never a
 * second declaration (§15 Rule 1) — the client's historical names are kept because this package's public
 * surface and its consumers use them.
 *
 * All four of the drifts these aliases replaced are recorded in the service's `collections.schema.ts`. The two
 * that were the CLIENT's to give up:
 *
 *  - `CollectionWithRecipes.recipes` was OPTIONAL here and required on the server. It is now REQUIRED, which
 *    is what the server has always sent — `getCollectionById` sets it unconditionally. Every reader in web and
 *    mobile already tolerates a present array, so the four surviving `?? []` / `?.length` chains around it are
 *    now merely redundant rather than load-bearing (they are left alone: two of them guard an optional
 *    `query.data`, not `recipes`).
 *  - `Collection` was `CoreCollection & { …three response-only fields }` HERE, and a second zod widening
 *    (`collectionSchema.extend(…)`) lived in `client.ts`. Both are gone: the service authors the widening
 *    once, and the type and the validator now come from the same object. The alias remains structurally
 *    identical to the old intersection, so the fixture pattern the tests depend on — spreading
 *    `@kitchensink/recipe-core/testing`'s `makeCollection()` into a client wire value — keeps working.
 */
export type {
    CollectionMemberRecipe,
    CollectionRecipeMembershipResponse as CollectionRecipeMembership,
    CollectionResponse as Collection,
    CollectionWithRecipesResponse as CollectionWithRecipes,
    CloneCollectionRequest,
    CreateCollectionRequest,
    PullDiff,
    PullFromSourceResponse,
    UpdateCollectionRequest,
} from '@kitchensink/schema-recipe';
// Imported (not merely re-exported) because the two types below are DERIVED from them.
import type { CollectionMemberRecipe, ListCollectionsQuery } from '@kitchensink/schema-recipe';

/** Sort key for `listRecipes` (`GET /api/v1/recipes`). */
export type RecipeListSortBy = 'updatedAt' | 'createdAt' | 'title';

/** Query parameters for `listRecipes`. */
export interface ListRecipesParams {
    readonly page?: number;
    readonly pageSize?: number;
    readonly sortBy?: RecipeListSortBy;
}

/**
 * Query parameters for `listCollections` (`GET /api/v1/collections`).
 *
 * DERIVED from the contract's parsed query type rather than declared, so adding a parameter server-side widens
 * this automatically. `Partial<>` (and not the schema's own INPUT type) because the two ends mean different
 * things: the contract's input is what the coercing schema accepts off a query string — `z.coerce.number()`
 * takes `unknown`, which is useless as a caller-facing type — while a caller passes real numbers or omits
 * them, and the server's `.default()` supplies 1 / 20 for what is omitted. This is a genuinely client-side
 * shape (§15.2.4), which is why it stays in this file.
 */
export type ListCollectionsParams = Readonly<Partial<ListCollectionsQuery>>;

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

/**
 * Provenance of a recipe's membership in a collection (`manual` | `clone_seed` | `pull`).
 *
 * DERIVED from the contract's member shape rather than declared, so it cannot drift from the values the service
 * actually sends — the same pattern as `IngredientSuggestionProvenance` above and `RecipeSearchFacetCounts`
 * below. The three literals it resolves to are `@kitchensink/recipe-core`'s `RecipeCollectionAddedVia`.
 */
export type CollectionRecipeAddedVia = CollectionMemberRecipe['addedVia'];

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
