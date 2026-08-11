/**
 * TanStack Query hooks for `@kitchensink/recipe-service-client` (T-095). Same hook style as the app's
 * existing query hooks (`useUserProfile` — `useQuery`/`useMutation` with a query-key factory and
 * `invalidateQueries` on success): read hooks per GET endpoint, mutation hooks per mutating endpoint.
 *
 * The {@link RecipeServiceClient} (with its base URL + token already injected — see `./client.js`) is
 * supplied once via {@link RecipeServiceProvider} and read by every hook through
 * {@link useRecipeServiceClient}, so hooks never deal with URLs or tokens themselves. The provider is
 * built with `createElement` (no JSX) so this stays a `.ts` module alongside the rest of the package.
 *
 * These hooks depend on `react` + `@tanstack/react-query` (both peer-provided by the consuming app,
 * which also owns the `QueryClientProvider`). Import them from the package subpath so a non-React
 * consumer of the plain client never pulls React in.
 */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, createElement, useContext, useEffect } from 'react';
import type { ReactElement, ReactNode } from 'react';

import type {
    CreateRecipeInput,
    RecipeDetail,
    RecipeSearchParams,
    RecipeVisibility,
    SetRecipeRatingInput,
    UpdateRecipeInput,
} from '@kitchensink/recipe-core';

import { RecipeServiceClient } from './client.js';
import {
    DEFAULT_INGREDIENT_POLL_INTERVAL_MS,
    collectionQueries,
    ingredientQueries,
    recipeProjections,
    recipeQueries,
    recipeServiceKeys,
} from './queries.js';
import type {
    CloneCollectionRequest,
    CreateCollectionRequest,
    ErasureRequest,
    ListCollectionsParams,
    ListRecipesParams,
    PhotoConfirmRequest,
    PhotoUploadUrlRequest,
    PullDiff,
    UpdateCollectionRequest,
} from './types.js';

// Re-exported so every existing `import { recipeServiceKeys } from '../hooks.js'` (and the public
// `@kitchensink/recipe-service-client/hooks` subpath) keeps resolving unchanged — P5 moved the factory's
// SOURCE to `./queries.js` (the module the read-seam factories below build on), not its public location.
export { DEFAULT_INGREDIENT_POLL_INTERVAL_MS, recipeServiceKeys };

// ─── Provider / context ───────────────────────────────────────────────────────────────────────────

const RecipeServiceClientContext = createContext<RecipeServiceClient | null>(null);

/** Props for {@link RecipeServiceProvider}. */
export interface RecipeServiceProviderProps {
    /** A configured client (base URL + token already injected). */
    readonly client: RecipeServiceClient;
    readonly children: ReactNode;
}

/**
 * Provides a {@link RecipeServiceClient} to the recipe-service hooks. Mount inside the app's
 * `QueryClientProvider`.
 *
 * @param props - The client instance + children.
 */
export function RecipeServiceProvider(props: RecipeServiceProviderProps): ReactElement {
    return createElement(RecipeServiceClientContext.Provider, { value: props.client }, props.children);
}

/**
 * Read the {@link RecipeServiceClient} from context.
 *
 * @returns The provided client.
 * @throws {Error} when called outside a {@link RecipeServiceProvider}.
 */
export function useRecipeServiceClient(): RecipeServiceClient {
    const client = useContext(RecipeServiceClientContext);

    if (client === null) {
        throw new Error('useRecipeServiceClient must be used within a <RecipeServiceProvider>.');
    }

    return client;
}

// ─── Query-key factory ──────────────────────────────────────────────────────────────────────────
//
// `recipeServiceKeys` is now DEFINED in `./queries.js` (see that module's doc comment for why: the
// read-seam factories below build on it, and defining it there — rather than importing it back from
// here — avoids a hooks.ts ⇄ queries.ts import cycle). It is re-exported above so every existing
// `recipeServiceKeys` import keeps resolving from this module unchanged.

/** Optional gate shared by id-addressed read hooks. */
export interface QueryEnableOptions {
    readonly enabled?: boolean;
}

// ─── Recipe queries ───────────────────────────────────────────────────────────────────────────────
//
// Every read hook below is a one-liner over a `recipeQueries`/`collectionQueries`/`ingredientQueries`
// factory (P5 — the Repository read seam, `./queries.js`): the hook owns ONLY what a hook-specific
// concern actually is — the empty-id/empty-query gate (`enabled`) and, for the ingredient-status poll,
// the caller-configurable cadence. The query key, the fetcher, and the cache policy (`staleTime`) live
// on the factory, so they cannot drift between two hooks that read the same data.

/** `GET /api/v1/recipes` — the caller's recipes (paginated). */
export function useRecipes(params: ListRecipesParams = {}) {
    const client = useRecipeServiceClient();

    return useQuery(recipeQueries(client).list(params));
}

/** Page size for {@link useAllOwnerRecipes}' underlying list calls — bulk pages, not a render page. */
export const ALL_OWNER_RECIPES_PAGE_SIZE = 100;

/**
 * `GET /api/v1/recipes` — the caller's ENTIRE recipe list, eagerly paged to completion.
 *
 * The account-erasure donate election (CR-002 / U4b) is the input to an IRREVERSIBLE action: any owner-only
 * recipe the user is never shown would be silently destroyed. So the election MUST see every page, not just
 * the first — a fixed `pageSize` cap (the trap this replaces) drops recipe N+1 onward. This drives
 * `recipeQueries().listInfinite` to exhaustion — on each render, if another page exists and none is in
 * flight, it fetches the next — and reports `isLoading` (and withholds `isComplete`) until the final page is
 * in, so a caller never presents a partial set as the full donatable list.
 *
 * The `useEffect` is an external-system sync (driving TanStack Query's pager to completion), not initial
 * data fetch — the query owns the fetch; the effect only advances the cursor.
 *
 * **A FAILURE ends the wait.** `isLoading` ORs in `hasNextPage`, which is derived from pagination metadata,
 * not from fetch state: when a page after the first fails, no page is appended, so `hasNextPage` stays true
 * forever and the composite `isLoading` latched true permanently. Both erasure surfaces branch
 * `recipesLoading ? … : recipesError ? …`, so that made the error branch unreachable and the donate election
 * spun with no retry. `failed` therefore gates BOTH the pager (never re-issue a fetch that just failed) and
 * `isLoading` (a settled failure is not a wait), and it folds `isFetchNextPageError` into `isError` so a
 * mid-pager failure is as visible as an initial one.
 *
 * @param pageSize - Page size for the underlying list calls (default {@link ALL_OWNER_RECIPES_PAGE_SIZE}).
 * @returns The flattened recipes plus `isLoading` (true until fully paged), `isError`, and `isComplete`.
 */
export function useAllOwnerRecipes(pageSize = ALL_OWNER_RECIPES_PAGE_SIZE) {
    const client = useRecipeServiceClient();
    const query = useInfiniteQuery(recipeQueries(client).listInfinite({ pageSize }));
    const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
    const failed = query.isError || query.isFetchNextPageError;

    useEffect(() => {
        if (hasNextPage && !isFetchingNextPage && !failed) {
            void fetchNextPage();
        }
    }, [hasNextPage, isFetchingNextPage, fetchNextPage, failed]);

    const recipes = query.data?.pages.flatMap((page) => page.data) ?? [];

    return {
        recipes,
        // Until the last page lands there is still a page owed → the election is INCOMPLETE. Surface as
        // loading and withhold isComplete so no caller treats a partial set as the full list. A failure is
        // NOT a wait: once the pager has failed, the caller must see the error branch, not a spinner.
        isLoading: !failed && (query.isLoading || isFetchingNextPage || hasNextPage),
        isError: failed,
        isComplete: query.isSuccess && !hasNextPage && !failed,
    };
}

/** `GET /api/v1/recipes/{id}` — a single recipe. */
export function useRecipe(id: string, options: QueryEnableOptions = {}) {
    const client = useRecipeServiceClient();

    return useQuery({
        ...recipeQueries(client).detail(id),
        enabled: (options.enabled ?? true) && id.length > 0,
    });
}

/** `GET /api/v1/recipes/{id}/versions` — a recipe's recent versions. */
export function useRecipeVersions(id: string, options: QueryEnableOptions = {}) {
    const client = useRecipeServiceClient();

    return useQuery({
        ...recipeQueries(client).versions(id),
        enabled: (options.enabled ?? true) && id.length > 0,
    });
}

/** `GET /api/v1/recipes/{id}/versions/{versionNumber}` — a specific version snapshot. */
export function useRecipeVersion(id: string, versionNumber: number, options: QueryEnableOptions = {}) {
    const client = useRecipeServiceClient();

    return useQuery({
        ...recipeQueries(client).version(id, versionNumber),
        enabled: (options.enabled ?? true) && id.length > 0,
    });
}

/** `GET /api/v1/recipes/{id}/photos` — a recipe's photos. */
export function useRecipePhotos(id: string, options: QueryEnableOptions = {}) {
    const client = useRecipeServiceClient();

    return useQuery({
        ...recipeQueries(client).photos(id),
        enabled: (options.enabled ?? true) && id.length > 0,
    });
}

// ─── Collection queries ─────────────────────────────────────────────────────────────────────────

/** `GET /api/v1/collections` — the caller's collections (paginated). */
export function useCollections(params: ListCollectionsParams = {}) {
    const client = useRecipeServiceClient();

    return useQuery(collectionQueries(client).list(params));
}

/**
 * `GET /api/v1/collections` — the same caller's collections as {@link useCollections}, but PAGINATED for a
 * "Load more" flow (W5/C7): each fetched page appends to `data.pages`, and `hasNextPage`/`fetchNextPage`
 * drive the load-more control. The next page is `page + 1` while the last page reported `hasMore`; once it
 * does not, `getNextPageParam` returns `undefined` and the control disappears.
 *
 * @param params - The list params (page/pageSize). The `page` field is managed by the pager.
 */
export function useCollectionsInfinite(params: ListCollectionsParams = {}) {
    const client = useRecipeServiceClient();

    return useInfiniteQuery(collectionQueries(client).listInfinite(params));
}

/** `GET /api/v1/collections/{id}` — a collection with its member recipes. */
export function useCollection(id: string, options: QueryEnableOptions = {}) {
    const client = useRecipeServiceClient();

    return useQuery({
        ...collectionQueries(client).detail(id),
        enabled: (options.enabled ?? true) && id.length > 0,
    });
}

// ─── Search queries ─────────────────────────────────────────────────────────────────────────────

/** `GET /api/v1/search/recipes` — full-text recipe search with facets. */
export function useSearchRecipes(params: RecipeSearchParams = {}) {
    const client = useRecipeServiceClient();

    return useQuery(recipeQueries(client).search(params));
}

/**
 * `GET /api/v1/search/recipes` — the same ranked, faceted, visibility-scoped search as {@link useSearchRecipes},
 * but PAGINATED for a "Load more" flow (W4/S4): each fetched page appends to `data.pages`, and
 * `hasNextPage`/`fetchNextPage` drive the load-more control. The next page is `page + 1` while the last page
 * reported `hasMore`; once it does not, `getNextPageParam` returns `undefined` and the control disappears.
 * Facets come from the first page (they describe the whole result set, not one page).
 *
 * @param params - The search criteria (query/filters/sort). The `page` field is managed by the pager.
 */
export function useInfiniteSearchRecipes(params: RecipeSearchParams = {}) {
    const client = useRecipeServiceClient();

    return useInfiniteQuery(recipeQueries(client).searchInfinite(params));
}

/** `GET /api/v1/ingredients/search` — ingredient typeahead (disabled for an empty query). */
export function useSearchIngredients(query: string, limit?: number, options: QueryEnableOptions = {}) {
    const client = useRecipeServiceClient();

    return useQuery({
        ...ingredientQueries(client).search(query, limit),
        enabled: (options.enabled ?? true) && query.length > 0,
    });
}

/**
 * `GET /api/v1/ingredients/suggest` — the BLENDED ingredient typeahead (search Stage 2): the local `ingredients`
 * catalog plus the food-service golden catalog, deduped and sectioned by provenance. This is the ingredient
 * PICKER's read; {@link useSearchIngredients} stays the local-only read the recipe-search filter needs.
 *
 * Disabled for an empty query. The endpoint degrades to local-only rather than failing when the food catalog
 * is slow/down, so `isError` here means recipe-service itself failed — a degraded catalog arrives as a
 * successful result whose `catalogAvailability` is `'unavailable'`.
 *
 * @param query - The (already debounced) name query.
 * @param limit - Max results per section.
 * @param options - Enable gate.
 */
export function useSuggestIngredients(query: string, limit?: number, options: QueryEnableOptions = {}) {
    const client = useRecipeServiceClient();

    return useQuery({
        ...ingredientQueries(client).suggest(query, limit),
        enabled: (options.enabled ?? true) && query.length > 0,
    });
}

/** Options for {@link useIngredientStatus}. */
export interface IngredientStatusOptions extends QueryEnableOptions {
    /** Poll cadence (ms) while the food is `PENDING`. Defaults to {@link DEFAULT_INGREDIENT_POLL_INTERVAL_MS}. */
    readonly pollIntervalMs?: number;
}

/**
 * `GET /api/v1/ingredients/{id}/status` — poll a food-backed ingredient's async resolution (data-model R5).
 *
 * The poll is SELF-LIMITING: `refetchInterval` (from {@link ingredientQueries}`.status`) returns a cadence
 * ONLY while the last-seen status is `PENDING`, and `false` for every other state — `RESOLVED`,
 * `UNRESOLVED` (needs user disambiguation, not more polling), the `NOT_FOUND`/`FAILED` terminals, and a
 * freeform ingredient (no status). So it stops the instant nutrition arrives or a terminal/disambiguation
 * state is reached, never spinning on a food that will not change by polling. TanStack keeps a single
 * in-flight refetch per tick, and background refetching is left off, so it cannot storm the endpoint.
 *
 * @param id - The ingredient id (the query is disabled for an empty id).
 * @param options - Enable gate + poll cadence.
 */
export function useIngredientStatus(id: string, options: IngredientStatusOptions = {}) {
    const client = useRecipeServiceClient();
    const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_INGREDIENT_POLL_INTERVAL_MS;

    return useQuery({
        ...ingredientQueries(client).status(id, pollIntervalMs),
        enabled: (options.enabled ?? true) && id.length > 0,
    });
}

/**
 * `GET /api/v1/ingredients/{id}/candidates` — the disambiguation candidate set for an `UNRESOLVED` ingredient.
 * Gate it (`enabled`) on a line actually being `UNRESOLVED` so it never fetches for a resolved/freeform line.
 *
 * @param id - The ingredient id (the query is disabled for an empty id).
 * @param options - Enable gate.
 */
export function useIngredientCandidates(id: string, options: QueryEnableOptions = {}) {
    const client = useRecipeServiceClient();

    return useQuery({
        ...ingredientQueries(client).candidates(id),
        enabled: (options.enabled ?? true) && id.length > 0,
    });
}

// ─── Recipe mutations ─────────────────────────────────────────────────────────────────────────────
//
// Invalidation rule for this section: a write that adds, removes, or edits a recipe row stales BOTH the
// `recipes` prefix AND `recipeSearches`. The second call is not belt-and-braces — search lives under its
// own `search` namespace (outside `recipes`), yet reads the same golden `recipes` table through a
// trigger-maintained `search_vector` updated in the write's own transaction. So the search cache goes
// stale at exactly the same instant as the list, and nothing else invalidates it. Photo writes are
// deliberately excluded: search rows are `Recipe` metadata, which carries no photo data.

/** `POST /api/v1/recipes` — create a recipe. */
export function useCreateRecipe() {
    const client = useRecipeServiceClient();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (input: CreateRecipeInput) => client.createRecipe(input),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.recipes });
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.recipeSearches });
        },
    });
}

/**
 * `PATCH /api/v1/recipes/{id}` — update a recipe (optimistic concurrency).
 *
 * DA3 — write-through: the response IS the full, freshly-persisted `RecipeDetail`, so it is written straight
 * into `recipe(id)` (`setQueryData`) instead of invalidating it and forcing a refetch of data the client
 * already has. This is write-AFTER-success only, never an optimistic `onMutate` pre-write — the CAS 409
 * conflict flow (a stale `expectedVersion`) is the entire point of this mutation, and pre-writing the cache
 * would mask a conflict the server is about to reject. The response carries no version-LIST shape to write
 * through, and a PATCH always records a new version row, so `recipeVersions(id)` still takes an explicit
 * invalidation; list/search/collection-embed regions go stale exactly as before.
 */
export function useUpdateRecipe() {
    const client = useRecipeServiceClient();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (vars: { id: string; input: UpdateRecipeInput }) => client.updateRecipe(vars.id, vars.input),
        onSuccess: async (data, vars) => {
            // Cancel any in-flight `recipe(id)` GET before writing through, so a detail fetch that started
            // stale (>staleTime) and settles AFTER this mutation cannot clobber the fresh response with
            // pre-update data (symmetric with the rating hooks' optimistic cancel).
            await queryClient.cancelQueries({ queryKey: recipeServiceKeys.recipe(vars.id) });
            queryClient.setQueryData(recipeServiceKeys.recipe(vars.id), data);
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.recipeVersions(vars.id) });
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.recipeLists });
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.recipeSearches });
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.collections });
        },
    });
}

/** `DELETE /api/v1/recipes/{id}` — soft-delete a recipe. */
export function useDeleteRecipe() {
    const client = useRecipeServiceClient();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (id: string) => client.deleteRecipe(id),
        onSuccess: () => {
            invalidateEditedRecipeRows(queryClient);
        },
    });
}

/**
 * `POST /api/v1/recipes/{id}/clone` — clone a public recipe.
 *
 * DA3 — write-through: the response is the NEW clone's full `RecipeDetail`, so it is written straight into
 * that clone's OWN `recipe(data.id)` (its id, not the source recipe's) instead of forcing a refetch. A fresh
 * clone changes no existing recipe and belongs to no collection, so — unlike update/delete/visibility — only
 * `recipeLists`/`recipeSearches` go stale; `recipes` (broad) and `collections` are deliberately NOT invalidated.
 */
export function useCloneRecipe() {
    const client = useRecipeServiceClient();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (id: string) => client.cloneRecipe(id),
        onSuccess: async (data) => {
            // Cancel any in-flight GET for the clone's own id before writing its detail through (symmetric
            // with the other write-through hooks; a fresh clone rarely has one, but keep the guard uniform).
            await queryClient.cancelQueries({ queryKey: recipeServiceKeys.recipe(data.id) });
            queryClient.setQueryData(recipeServiceKeys.recipe(data.id), data);
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.recipeLists });
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.recipeSearches });
        },
    });
}

/**
 * `PATCH /api/v1/recipes/{id}/visibility` — set a recipe's visibility.
 *
 * DA3 — write-through: the response is the full, freshly-persisted `RecipeDetail`, so it is written straight
 * into `recipe(id)` instead of invalidating it. A visibility flip is confirmed (against the server DAL) to be
 * a pure single-column metadata UPDATE with no `recipe_versions` insert and no `currentVersion` bump — unlike
 * a content edit or a restore — so `recipeVersions(id)` is deliberately NOT invalidated here.
 *
 * DA4 follow-on: this is a genuinely optimistic-worthy write (a toggle the viewer expects to flip instantly),
 * but layering `onMutate`/`onError` on top of DA3's write-through would need its own red→green pass (today's
 * `onSuccess`-only invalidation is a pinned, deliberate contract — see the tests keyed `VISIBILITY_PROBES`,
 * and note the rating hooks below settled on this SAME shape: reconcile on success, rollback-only on error,
 * no invalidation on failure). Deferred out of DA4's required scope (rating) rather than risk a rushed change
 * to that contract; not yet implemented.
 */
export function useSetRecipeVisibility() {
    const client = useRecipeServiceClient();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (vars: { id: string; visibility: RecipeVisibility }) =>
            client.setRecipeVisibility(vars.id, vars.visibility),
        onSuccess: async (data, vars) => {
            // Cancel any in-flight `recipe(id)` GET before writing through, so a stale detail fetch settling
            // after this visibility change cannot clobber the fresh response (symmetric with the other hooks).
            await queryClient.cancelQueries({ queryKey: recipeServiceKeys.recipe(vars.id) });
            queryClient.setQueryData(recipeServiceKeys.recipe(vars.id), data);
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.recipeLists });
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.recipeSearches });
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.collections });
        },
    });
}

// A write that changes exactly ONE recipe's projected data (not its membership in other rows) stales three
// regions and no more: that recipe's own subtree (`recipe(id)` — detail + versions + photos), every recipe
// LIST (`recipeLists` — its rows render the same projection), and the SEARCH namespace (`recipeSearches` —
// a search row embeds the full `Recipe`). It is keyed off the mutation's variables, so a sibling recipe's
// detail stays cached. `recipeSearches` is ALWAYS a separate, explicit call: search lives under the
// `search` namespace OUTSIDE the `recipes` prefix (a prior class of staleness bugs), so no `recipes`
// invalidation reaches it by accident. Both rating writes and all three photo writes share this exact set —
// each changes a DIFFERENT projected field (`averageRating`/`ratingCount`, `coverPhotoUrl` respectively),
// but every one of those fields renders on the detail, on every list row, AND on every search result.
// Restore (below) changes a DIFFERENT projected field too (title/`currentVersion`) but is DA3 write-through:
// its response fully describes the detail, so it writes that through instead of invalidating the subtree,
// and invalidates only `recipeVersions(id)` (not covered by the response) plus lists/search/collections.

/**
 * Invalidate the caches that render a single recipe's projected data: its own subtree (`recipe(id)`), every
 * recipe list (`recipeLists`), the recipe-search namespace (`recipeSearches`), and — DA2 — every collection
 * (`collections`, since a `CollectionWithRecipes.recipes` entry embeds the full `Recipe` projection, and the
 * client has no index of which collections embed this recipe). Sibling recipes stay cached. See the block
 * comment above for why these four — and only these four — go stale together.
 *
 * P5: this is now a thin loop over {@link recipeProjections}, the single registry the factories and this
 * invalidation call site both read off — they cannot drift apart.
 *
 * @param queryClient - The query client whose cache to invalidate.
 * @param recipeId - The recipe whose detail/list/search/collection-embed projections changed.
 * @sideEffect Marks the four regions stale on the query cache.
 */
function invalidateRecipeProjections(queryClient: ReturnType<typeof useQueryClient>, recipeId: string): void {
    for (const queryKey of recipeProjections(recipeId)) {
        void queryClient.invalidateQueries({ queryKey });
    }
}

/**
 * Invalidate every cached collection (DA10-b) — the `collections` prefix (list + every detail). Symmetric
 * with {@link invalidateRecipeProjections}: a single-purpose thin wrapper so every collection-mutation hook
 * that stales ONLY the collections namespace (create/update/delete/clone/pull-from-source) delegates to one
 * call site instead of repeating the literal `invalidateQueries({ queryKey: recipeServiceKeys.collections })`
 * inline. Composite invalidations that stale `collections` ALONGSIDE recipe regions (e.g. `useUpdateRecipe`,
 * `useSetRecipeVisibility`, `useRestoreRecipeVersion`, `invalidateEditedRecipeRows`) are DELIBERATELY left
 * as their own explicit calls — DA2's block comment above documents that specific 3/4-key set as a single
 * reasoned unit, and folding `collections` out of it into this helper would obscure that unit, not DRY it.
 *
 * Exported (unlike {@link invalidateRecipeProjections}) so it is unit-testable directly against a bare
 * `QueryClient`, without rendering a mutation hook — its own contract (which keys go stale) is simple
 * enough to pin on its own, on top of the observable-outcome coverage every delegating hook keeps.
 *
 * @param queryClient - The query client whose cache to invalidate.
 * @sideEffect Marks the `collections` region stale on the query cache.
 */
export function invalidateCollections(queryClient: ReturnType<typeof useQueryClient>): void {
    void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.collections });
}

/**
 * Invalidate the broad set an EDIT to an existing recipe stales, for a mutation whose response does NOT
 * fully describe the entity (`deleteRecipe` resolves `void`, so there is nothing to write through): every
 * recipe query (`recipes`), the recipe-search namespace (`recipeSearches`), and — DA2 — every collection
 * embed (`collections`). Used ONLY by {@link useDeleteRecipe} now — DA3 moved update/visibility/restore to
 * explicit write-through + narrower invalidation (see each hook's doc comment) once their responses proved
 * to fully describe the changed detail.
 *
 * @param queryClient - The query client whose cache to invalidate.
 * @sideEffect Marks the three regions stale on the query cache.
 */
function invalidateEditedRecipeRows(queryClient: ReturnType<typeof useQueryClient>): void {
    void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.recipes });
    void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.recipeSearches });
    void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.collections });
}

/**
 * `POST /api/v1/recipes/{id}/versions/{versionNumber}/restore` — restore a recipe to a prior version.
 *
 * A restore is server-side a full recipe update off the snapshot: it rewrites the title/description/times,
 * replaces the ingredient and step sets, bumps `currentVersion`, and records a new version.
 *
 * DA3 — write-through: `data.recipe` is the full, freshly-persisted `RecipeDetail`, so it is written straight
 * into `recipe(id)` instead of invalidating the subtree and forcing a refetch. The response carries no
 * version-LIST shape (only the number it restored from/to), and a restore always records a new version row,
 * so `recipeVersions(id)` still takes an explicit invalidation, alongside lists/search/collection-embeds —
 * list rows render `title` and `currentVersion`, and the snapshot's text rebuilds the row's search vector.
 * Keyed off the mutation's variables: a restore touches exactly one recipe, so a sibling recipe's detail is
 * untouched.
 */
export function useRestoreRecipeVersion() {
    const client = useRecipeServiceClient();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (vars: { id: string; versionNumber: number }) =>
            client.restoreRecipeVersion(vars.id, vars.versionNumber),
        onSuccess: async (data, vars) => {
            // Cancel any in-flight `recipe(id)` GET before writing through, so a stale detail fetch settling
            // after this restore cannot clobber the restored detail (symmetric with the other hooks).
            await queryClient.cancelQueries({ queryKey: recipeServiceKeys.recipe(vars.id) });
            queryClient.setQueryData(recipeServiceKeys.recipe(vars.id), data.recipe);
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.recipeVersions(vars.id) });
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.recipeLists });
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.recipeSearches });
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.collections });
        },
    });
}

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

/** The `onMutate` context for a rating write: the pre-mutation `recipe(id)` snapshot to roll back to. */
interface RatingMutationContext {
    readonly previous: RecipeDetail | undefined;
}

/** `PUT /api/v1/recipes/{id}/rating` — set the caller's rating (idempotent upsert), optimistically (DA4). */
export function useSetRecipeRating() {
    const client = useRecipeServiceClient();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (vars: { id: string; input: SetRecipeRatingInput }) => client.setRecipeRating(vars.id, vars.input),
        onMutate: async (vars): Promise<RatingMutationContext> => {
            await queryClient.cancelQueries({ queryKey: recipeServiceKeys.recipe(vars.id) });
            const previous = queryClient.getQueryData<RecipeDetail>(recipeServiceKeys.recipe(vars.id));
            queryClient.setQueryData<RecipeDetail>(recipeServiceKeys.recipe(vars.id), (old) =>
                old ? { ...old, viewerRating: vars.input.stars } : old,
            );

            return { previous };
        },
        onError: (_error, vars, context) => {
            if (context?.previous !== undefined) {
                queryClient.setQueryData(recipeServiceKeys.recipe(vars.id), context.previous);
            }
        },
        onSuccess: (_data, vars) => {
            invalidateRecipeProjections(queryClient, vars.id);
        },
    });
}

/** `DELETE /api/v1/recipes/{id}/rating` — remove the caller's rating (idempotent), optimistically (DA4). */
export function useDeleteRecipeRating() {
    const client = useRecipeServiceClient();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (id: string) => client.deleteRecipeRating(id),
        onMutate: async (id): Promise<RatingMutationContext> => {
            await queryClient.cancelQueries({ queryKey: recipeServiceKeys.recipe(id) });
            const previous = queryClient.getQueryData<RecipeDetail>(recipeServiceKeys.recipe(id));
            queryClient.setQueryData<RecipeDetail>(recipeServiceKeys.recipe(id), (old) =>
                old ? { ...old, viewerRating: undefined } : old,
            );

            return { previous };
        },
        onError: (_error, id, context) => {
            if (context?.previous !== undefined) {
                queryClient.setQueryData(recipeServiceKeys.recipe(id), context.previous);
            }
        },
        onSuccess: (_data, id) => {
            invalidateRecipeProjections(queryClient, id);
        },
    });
}

// ─── Ingredient mutations ─────────────────────────────────────────────────────────────────────────

/** `POST /api/v1/ingredients` — create a freeform ingredient. */
export function useCreateIngredient() {
    const client = useRecipeServiceClient();

    return useMutation({
        mutationFn: (name: string) => client.createIngredient(name),
    });
}

/**
 * `POST /api/v1/ingredients/by-name` — add an unknown food by name through the food service (data-model R5).
 *
 * The ENTRY POINT of the async-resolution vertical: it persists a food-backed catalog row and returns it
 * with a NON-terminal status (`PENDING` / `UNRESOLVED`), which the picker then polls ({@link useIngredientStatus})
 * or disambiguates. On success it stales every cached ingredient search (`ingredientSearches`) — a search
 * hit embeds `foodResolutionStatus`, and the newly added/deduped catalog row is now a candidate hit whose
 * badge a cached typeahead would otherwise render stale. It does NOT touch the recipe projections: the row
 * is a shared-catalog entry and changes no recipe/list/search row until a recipe is saved.
 */
export function useAddIngredientByName() {
    const client = useRecipeServiceClient();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (name: string) => client.addIngredientByName(name),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.ingredientSearches });
        },
    });
}

/**
 * `POST /api/v1/ingredients/by-food` — admit a `catalog` typeahead suggestion as a food-backed ingredient
 * (search Stage 2's pick path).
 *
 * The server creates the row AND backfills its golden-record nutrition in one round-trip, so the ingredient
 * this resolves with is immediately usable on a recipe line — no poll. On success it stales every cached
 * ingredient typeahead (`ingredientSearches`, the shared prefix over `/search` AND `/suggest`): the food now
 * HAS a catalog row, so the very suggestion just picked must move from the `catalog` section to the familiar
 * `local` one. Without this, re-typing the same query would re-offer it as a catalog hit and cost another
 * pointless admit round-trip. It does NOT touch the recipe projections — a shared-catalog row changes no
 * recipe/list/search row until a recipe is saved.
 */
export function useAddIngredientByFood() {
    const client = useRecipeServiceClient();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (foodId: string) => client.addIngredientByFood(foodId),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.ingredientSearches });
        },
    });
}

/**
 * `POST /api/v1/ingredients/{id}/resolve` — resolve an `UNRESOLVED` ingredient from a candidate pick.
 *
 * On success the ingredient is now `RESOLVED` with nutrition, so this stales exactly the caches that
 * rendered its pre-resolution state: its own poll (`ingredientStatus(id)`), its now-stale candidate set
 * (`ingredientCandidates(id)`), and every cached ingredient search (`ingredientSearches` — a catalog hit
 * embeds `foodResolutionStatus`, which a search list badges). It does NOT touch the recipe projections:
 * resolving nutrition on the shared catalog row changes no recipe/list/search row until a recipe is saved.
 */
export function useResolveIngredient() {
    const client = useRecipeServiceClient();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (vars: { id: string; candidateIds: readonly string[] }) =>
            client.resolveIngredient(vars.id, vars.candidateIds),
        onSuccess: (_result, vars) => {
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.ingredientStatus(vars.id) });
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.ingredientCandidates(vars.id) });
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.ingredientSearches });
        },
    });
}

// ─── Photo mutations ──────────────────────────────────────────────────────────────────────────────

/** `POST /api/v1/recipes/{id}/photos/upload-url` — mint a presigned upload URL (no cache to invalidate). */
export function useCreatePhotoUploadUrl() {
    const client = useRecipeServiceClient();

    return useMutation({
        mutationFn: (vars: { id: string; request: PhotoUploadUrlRequest }) =>
            client.createPhotoUploadUrl(vars.id, vars.request),
    });
}

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

/** `POST /api/v1/recipes/{id}/photos/confirm` — confirm an uploaded photo. */
export function useConfirmPhotoUpload() {
    const client = useRecipeServiceClient();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (vars: { id: string; request: PhotoConfirmRequest }) =>
            client.confirmPhotoUpload(vars.id, vars.request),
        onSuccess: (_result, vars) => {
            invalidateRecipeProjections(queryClient, vars.id);
        },
    });
}

/** `DELETE /api/v1/recipes/{id}/photos/{photoId}` — delete a photo. */
export function useDeleteRecipePhoto() {
    const client = useRecipeServiceClient();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (vars: { id: string; photoId: string }) => client.deleteRecipePhoto(vars.id, vars.photoId),
        onSuccess: (_result, vars) => {
            invalidateRecipeProjections(queryClient, vars.id);
        },
    });
}

/** `PATCH /api/v1/recipes/{id}/photos/reorder` — reorder a recipe's photos. */
export function useReorderRecipePhotos() {
    const client = useRecipeServiceClient();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (vars: { id: string; photoIds: readonly string[] }) =>
            client.reorderRecipePhotos(vars.id, vars.photoIds),
        onSuccess: (_result, vars) => {
            invalidateRecipeProjections(queryClient, vars.id);
        },
    });
}

// ─── Collection mutations ─────────────────────────────────────────────────────────────────────────

/** `POST /api/v1/collections` — create a collection. */
export function useCreateCollection() {
    const client = useRecipeServiceClient();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (request: CreateCollectionRequest) => client.createCollection(request),
        onSuccess: () => {
            invalidateCollections(queryClient);
        },
    });
}

/** `PATCH /api/v1/collections/{id}` — update a collection. */
export function useUpdateCollection() {
    const client = useRecipeServiceClient();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (vars: { id: string; request: UpdateCollectionRequest }) =>
            client.updateCollection(vars.id, vars.request),
        onSuccess: () => {
            invalidateCollections(queryClient);
        },
    });
}

/** `DELETE /api/v1/collections/{id}` — delete a collection. */
export function useDeleteCollection() {
    const client = useRecipeServiceClient();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (id: string) => client.deleteCollection(id),
        onSuccess: () => {
            invalidateCollections(queryClient);
        },
    });
}

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

/** `POST /api/v1/collections/{id}/recipes` — add a recipe to a collection. */
export function useAddRecipeToCollection() {
    const client = useRecipeServiceClient();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (vars: { id: string; recipeId: string }) => client.addRecipeToCollection(vars.id, vars.recipeId),
        onSuccess: (_result, vars) => {
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.collection(vars.id) });
        },
    });
}

/** `DELETE /api/v1/collections/{id}/recipes/{recipeId}` — remove a recipe from a collection. */
export function useRemoveRecipeFromCollection() {
    const client = useRecipeServiceClient();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (vars: { id: string; recipeId: string }) =>
            client.removeRecipeFromCollection(vars.id, vars.recipeId),
        onSuccess: (_result, vars) => {
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.collection(vars.id) });
        },
    });
}

/** `POST /api/v1/collections/{id}/clone` — clone a collection. */
export function useCloneCollection() {
    const client = useRecipeServiceClient();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (vars: { id: string; request?: CloneCollectionRequest }) =>
            client.cloneCollection(vars.id, vars.request),
        onSuccess: () => {
            invalidateCollections(queryClient);
        },
    });
}

/**
 * `POST /api/v1/collections/{id}/pull-from-source/preview` — PREVIEW a pull without mutating (W5 Task 5).
 *
 * An IMPERATIVE trigger (`mutateAsync`), not a query: the preview is read-only server-side but is invoked
 * on demand (e.g. opening the pull-updates dialog), not kept warm/refetched like a `useQuery` cache entry.
 * It touches no cache — nothing about the collection changed — so there is no invalidation to perform; the
 * caller echoes the resolved {@link PullDiff} back as `previewedDiff` to {@link usePullCollectionFromSource}.
 */
export function usePreviewPull() {
    const client = useRecipeServiceClient();

    return useMutation({
        mutationFn: (id: string) => client.previewPullFromSource(id),
    });
}

/**
 * `POST /api/v1/collections/{id}/pull-from-source` — pull new recipes from a cloned collection's source.
 *
 * `previewedDiff` (from {@link usePreviewPull}) is optional and, when supplied, lets the server detect
 * DRIFT between what the caller previewed and what it would apply now — a rejection surfaces as a typed
 * {@link PullDriftError} (never swallowed) carrying the fresh diff for the caller to re-present.
 *
 * No write-through: the response's `collection` is the NARROW `Collection` projection (no `recipes`
 * embed), so writing it into `collection(id)` would clobber that cache's `.recipes` array with an entry
 * that lacks it entirely. Invalidating is therefore the correct — not merely simpler — choice here.
 */
export function usePullCollectionFromSource() {
    const client = useRecipeServiceClient();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (vars: { id: string; previewedDiff?: PullDiff }) =>
            client.pullCollectionFromSource(vars.id, { previewedDiff: vars.previewedDiff }),
        // A pull only adds MEMBERSHIP rows (`added_via = 'pull'`) — it creates no recipes and edits no
        // recipe row, so no recipe or search query is stale. Only the collection namespace is.
        onSuccess: () => {
            invalidateCollections(queryClient);
        },
    });
}

// ─── Account mutations ────────────────────────────────────────────────────────────────────────────

/**
 * `POST /api/v1/account/erasure` — request IRREVERSIBLE GDPR account erasure.
 *
 * The variables argument is REQUIRED (it was optional): `confirmationPhrase` is the intent gate, so a
 * `mutate()` with nothing to confirm could only ever have produced a `400`. Both call sites — web's
 * `AccountEraseForm` and mobile's `AccountDangerZone` — already pass the collected phrase and donate election.
 */
export function useRequestAccountErasure() {
    const client = useRecipeServiceClient();

    return useMutation({
        mutationFn: (request: ErasureRequest) => client.requestAccountErasure(request),
    });
}
