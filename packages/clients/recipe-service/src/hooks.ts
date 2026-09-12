/**
 * TanStack Query hooks for `@kitchensink/recipe-service-client` (T-095). Same hook style as the app's
 * existing query hooks (`useUserProfile` — `useQuery`/`useMutation` with a query-key factory and
 * `invalidateQueries` on success): read hooks per GET endpoint, mutation hooks per mutating endpoint.
 *
 * The `RecipeServiceClient` (with its base URL + token already injected — see `./client.js`) is
 * supplied once via `RecipeServiceProvider` and read by every hook through
 * `useRecipeServiceClient`, so hooks never deal with URLs or tokens themselves. The provider is
 * built with `createElement` (no JSX) so this stays a `.ts` module alongside the rest of the package.
 *
 * These hooks depend on `react` + `@tanstack/react-query` (both peer-provided by the consuming app,
 * which also owns the `QueryClientProvider`). Import them from the package subpath so a non-React
 * consumer of the plain client never pulls React in.
 *
 * This module is a re-export barrel: each implementation lives in its own file under `./hooks/`.
 */

// Re-exported so every existing `import { recipeServiceKeys } from '../hooks.js'` (and the public
// `@kitchensink/recipe-service-client/hooks` subpath) keeps resolving unchanged — P5 moved the factory's
// SOURCE to `./queries.js` (the module the read-seam factories below build on), not its public location.
export {
    DEFAULT_INGREDIENT_POLL_INTERVAL_MS,
    DEFAULT_PARSE_JOB_POLL_INTERVAL_MS,
    recipeServiceKeys,
} from './queries.js';

// ─── Provider / context ───────────────────────────────────────────────────────────────────────────

export { RecipeServiceProvider, useRecipeServiceClient } from './hooks/recipeServiceProvider.js';
export type { RecipeServiceProviderProps } from './hooks/recipeServiceProvider.js';

// ─── Query-key factory ──────────────────────────────────────────────────────────────────────────
//
// `recipeServiceKeys` is now DEFINED in `./queries.js` (see that module's doc comment for why: the
// read-seam factories below build on it, and defining it there — rather than importing it back from
// here — avoids a hooks.ts ⇄ queries.ts import cycle). It is re-exported above so every existing
// `recipeServiceKeys` import keeps resolving from this module unchanged.

export type { QueryEnableOptions } from './hooks/queryEnableOptions.js';

// ─── Recipe queries ───────────────────────────────────────────────────────────────────────────────
//
// Every read hook below is a one-liner over a `recipeQueries`/`collectionQueries`/`ingredientQueries`
// factory (P5 — the Repository read seam, `./queries.js`): the hook owns ONLY what a hook-specific
// concern actually is — the empty-id/empty-query gate (`enabled`) and, for the ingredient-status poll,
// the caller-configurable cadence. The query key, the fetcher, and the cache policy (`staleTime`) live
// on the factory, so they cannot drift between two hooks that read the same data.

export { useRecipes } from './hooks/useRecipes.js';
export { ALL_OWNER_RECIPES_PAGE_SIZE, useAllOwnerRecipes } from './hooks/useAllOwnerRecipes.js';
export { useRecipe } from './hooks/useRecipe.js';
export { useRecipeVersions } from './hooks/useRecipeVersions.js';
export { useRecipeVersion } from './hooks/useRecipeVersion.js';
export { useRecipeNutrition } from './hooks/useRecipeNutrition.js';
export { useRecipePhotos } from './hooks/useRecipePhotos.js';

// ─── Collection queries ─────────────────────────────────────────────────────────────────────────

export { useCollections } from './hooks/useCollections.js';
export { useCollectionsInfinite } from './hooks/useCollectionsInfinite.js';
export { useCollection } from './hooks/useCollection.js';

// ─── Search queries ─────────────────────────────────────────────────────────────────────────────

export { useSearchRecipes } from './hooks/useSearchRecipes.js';
export { useInfiniteSearchRecipes } from './hooks/useInfiniteSearchRecipes.js';
export { useSearchIngredients } from './hooks/useSearchIngredients.js';
export { useSuggestIngredients } from './hooks/useSuggestIngredients.js';
export { useSearchIngredientsLive } from './hooks/useSearchIngredientsLive.js';
export { useIngredientStatus } from './hooks/useIngredientStatus.js';
export type { IngredientStatusOptions } from './hooks/useIngredientStatus.js';
export { useIngredientCandidates } from './hooks/useIngredientCandidates.js';

// ─── Recipe mutations ─────────────────────────────────────────────────────────────────────────────
//
// Invalidation rule for this section: a write that adds, removes, or edits a recipe row stales BOTH the
// `recipes` prefix AND `recipeSearches`. The second call is not belt-and-braces — search lives under its
// own `search` namespace (outside `recipes`), yet reads the same golden `recipes` table through a
// trigger-maintained `search_vector` updated in the write's own transaction. So the search cache goes
// stale at exactly the same instant as the list, and nothing else invalidates it. Photo writes are
// deliberately excluded: search rows are `Recipe` metadata, which carries no photo data.

// The two recipe WRITE envelopes, from the contract the service authors. They were `recipe-core`'s
// `CreateRecipeInput` / `UpdateRecipeInput` — hand-written twins of these schemas (§15 rule 4 / ADR-0014).
export { useCreateRecipe } from './hooks/useCreateRecipe.js';
export { useUpdateRecipe } from './hooks/useUpdateRecipe.js';
export { useDeleteRecipe } from './hooks/useDeleteRecipe.js';
export { useCloneRecipe } from './hooks/useCloneRecipe.js';
export { useSetRecipeVisibility } from './hooks/useSetRecipeVisibility.js';
export { invalidateCollections } from './hooks/invalidateCollections.js';
export { useRestoreRecipeVersion } from './hooks/useRestoreRecipeVersion.js';

// The two rating writes below stale the same single-recipe projection set (subtree + every list + search):
// a rating changes the trigger-maintained `averageRating` / `ratingCount`, which render on the detail, on
// every list row, AND on every search result.
//
// DA4 — optimistic Command: both hooks below pre-write `recipe(id).viewerRating` in `onMutate` (the ONLY
// field the client can predict — the trigger-maintained `averageRating`/`ratingCount` are server-derived
// aggregates the client has no formula for, so they are deliberately left untouched until settle), roll
// back to the pre-mutation snapshot in `onError`, and reconcile with the server in `onSuccess` ONLY. This
// used to be a hand-rolled `ratingOverride` bridge duplicated in BOTH detail containers (web + mobile); it
// now lives once, in the hook layer, as a real optimistic Command instead of two copies of ad hoc
// `useState`.
//
// Reconciling on failure too (via `onSettled`) was tried and reverted: both detail containers render
// `query.isError` BEFORE `query.data` (`RecipeDetailContainer.tsx`, `RecipeDetailScreen.tsx`), so a rating
// write that fails with a 404 (the rated recipe became unreadable between page-load and tap) would
// invalidate `recipe(id)`, trigger a refetch that ALSO 404s, and discard the entire detail page — ingredients,
// steps, owner actions, version links — for the not-found screen, when the rollback alone already restores
// local truth. `onError` is therefore ROLLBACK-ONLY and invalidates nothing: the snapshot restore does not
// round-trip the network, so it cannot itself fail and cascade. A concurrent write to the same recipe by
// another viewer is a real staleness case this leaves uncovered until the next natural refetch, but that is
// the strictly smaller risk next to nuking a working detail page on every transient/permission failure.

export { useSetRecipeRating } from './hooks/useSetRecipeRating.js';
export { useDeleteRecipeRating } from './hooks/useDeleteRecipeRating.js';

// ─── Ingredient mutations ─────────────────────────────────────────────────────────────────────────

export { useCreateIngredient } from './hooks/useCreateIngredient.js';
export { useAddIngredientByName } from './hooks/useAddIngredientByName.js';
export { useAddIngredientByFood } from './hooks/useAddIngredientByFood.js';
export { useCreateAuthoredFoodViaPicker } from './hooks/useCreateAuthoredFoodViaPicker.js';
export { useResolveIngredient } from './hooks/useResolveIngredient.js';
export { useRecordIngredientCorrection } from './hooks/useRecordIngredientCorrection.js';

// ─── Parse-job query + mutations ──────────────────────────────────────────────────────────────────
//
// DESIGN PATTERN: **Command**, already satisfied by the TanStack mutations these wrap, over the P5 read
// seam in `queries.ts`. What the three mutations add is one shared decision:
//
// ⛔ WRITE-THROUGH, NOT INVALIDATE (DA3 — the `useUpdateRecipe` precedent). All three answer the FULL,
// freshly-persisted job view, which is byte-for-byte the shape the poll reads. Invalidating would throw
// that response away and refetch data already in hand — and on `create` there would be nothing to
// invalidate at all, so the poll would start from an empty cache and show a spinner over a job whose
// first view had already arrived.
//
// ⛔ AND THEY STALE NOTHING ELSE. R19: a parse binds nothing. No recipe row, no collection membership and
// no search row changes, so an invalidation of `recipes`/`collections`/`recipeSearches` here would refetch
// a cook's whole library on every line edit — while they are typing.

export { useParseJob } from './hooks/useParseJob.js';
export type { ParseJobOptions } from './hooks/useParseJob.js';
export { useCreateParseJob } from './hooks/useCreateParseJob.js';
export type { CreateParseJobOptions } from './hooks/useCreateParseJob.js';
export { useRetryParseJob } from './hooks/useRetryParseJob.js';
export { useEditParseJobLine } from './hooks/useEditParseJobLine.js';

// ─── Photo mutations ──────────────────────────────────────────────────────────────────────────────

export { useCreatePhotoUploadUrl } from './hooks/useCreatePhotoUploadUrl.js';

// Invalidation rule for the three photo writes below: each stales the standard single-recipe projection set
// (subtree + every list + search) via `invalidateRecipeProjections`. Two reasons the subtree alone is not
// enough. (1) `RecipeDetail.photos` is EMBEDDED (it ships with the detail for a one-round-trip read), so an
// open detail would keep rendering a deleted photo or a stale order — covered because `recipe(id)` is a
// prefix of `recipePhotos(id)`. (2) A photo write changes `coverPhotoUrl` (the lowest-sort-order photo,
// resolved on projection), and that cover renders on every recipe LIST row (the list projection resolves it
// so a card paints without an N+1 fetch) AND on every SEARCH result (a search row embeds the full `Recipe`).
// Leaving those valid strands the grid/search on a stale-or-deleted cover URL — a broken, CDN-404 image.
// Confirming can add the first/lower-sorted photo (cover appears/changes), deleting can drop the cover (the
// next photo promotes), and a reorder IS choosing the cover — none of which the client can cheaply predict,
// so all three invalidate uniformly. This is NOT over-invalidation: it is exactly the queries whose rendered
// data can change, and a photo write is a single, infrequent user action (no refetch storm).

export { useConfirmPhotoUpload } from './hooks/useConfirmPhotoUpload.js';
export { useDeleteRecipePhoto } from './hooks/useDeleteRecipePhoto.js';
export { useReorderRecipePhotos } from './hooks/useReorderRecipePhotos.js';

// ─── Collection mutations ─────────────────────────────────────────────────────────────────────────

export { useCreateCollection } from './hooks/useCreateCollection.js';
export { useUpdateCollection } from './hooks/useUpdateCollection.js';
export { useDeleteCollection } from './hooks/useDeleteCollection.js';

// Membership writes (add/remove below) stale ONLY that one collection's detail — deliberately NOT the
// collection list, and this narrowness is confirmed correct against the actual DTOs. The list returns the
// core `Collection` type (id/ownerId/name/description/sourceCollectionId/timestamps): it carries NO
// member-derived data — no recipe count, no membership array, no cover (the service deliberately omits
// `coverPhotoUrl` on the collection projection). Membership lives ONLY on the detail,
// `CollectionWithRecipes.recipes`, which `collection(id)` already stales. The list is also unsorted by
// activity (`ListCollectionsParams` is page/pageSize only) and a membership insert does not touch the
// collection row's `updatedAt`, so its order cannot drift either. So a membership change alters nothing the
// list renders; invalidating `collections` would refetch every cached collection to redraw identical rows.
// Widen this ONLY if a list row starts rendering a count or a cover.
//
// DA4 follow-on: add/remove are candidates for the same optimistic Command shape as the rating hooks above
// (the membership toggle is a UI action a viewer expects to reflect instantly), but an optimistic patch here
// would need to fabricate a plausible `CollectionWithRecipes.recipes` entry (add) or splice one out (remove)
// from server-shaped data the client does not have pre-write (add's embedded `Recipe`/`CollectionRecipeMembership`
// row is server-generated). Deferred out of DA4's required scope (rating) rather than risk a rushed, under-tested
// fabrication of that shape; not yet implemented.

export { useAddRecipeToCollection } from './hooks/useAddRecipeToCollection.js';
export { useRemoveRecipeFromCollection } from './hooks/useRemoveRecipeFromCollection.js';
export { useCloneCollection } from './hooks/useCloneCollection.js';
export { usePreviewPull } from './hooks/usePreviewPull.js';
export { usePullCollectionFromSource } from './hooks/usePullCollectionFromSource.js';

// ─── Account mutations ────────────────────────────────────────────────────────────────────────────

export { useRequestAccountErasure } from './hooks/useRequestAccountErasure.js';
