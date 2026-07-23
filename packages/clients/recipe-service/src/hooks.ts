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
import { createContext, createElement, useContext } from 'react';
import type { ReactElement, ReactNode } from 'react';

import { FoodResolutionStatus } from '@kitchensink/recipe-core';
import type {
    CreateRecipeInput,
    Ingredient,
    RecipeSearchParams,
    RecipeVisibility,
    SetRecipeRatingInput,
    UpdateRecipeInput,
} from '@kitchensink/recipe-core';

import { RecipeServiceClient } from './client.js';
import type {
    CloneCollectionRequest,
    CreateCollectionRequest,
    ErasureRequest,
    ListCollectionsParams,
    ListRecipesParams,
    PhotoConfirmRequest,
    PhotoUploadUrlRequest,
    UpdateCollectionRequest,
} from './types.js';

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

/**
 * Stable query-key factory for every recipe-service query (use its prefixes for invalidation).
 *
 * Keys nest so that a prefix names exactly one region of the cache: `recipes` covers every recipe query,
 * `recipe(id)` covers one recipe's whole subtree (its detail, versions, and photos), and `recipeLists` /
 * `recipeSearches` cover the params-addressed families whose individual keys a mutation cannot enumerate
 * (it does not know which filters or search terms a screen has cached). Note that `recipeSearches` is NOT
 * under the `recipes` prefix — search is its own namespace, so staling it always takes an explicit call.
 */
export const recipeServiceKeys = {
    all: ['recipe-service'] as const,
    recipes: ['recipe-service', 'recipes'] as const,
    /** Prefix over every `recipeList(params)` — the address for "every cached recipe list, whatever its filters". */
    recipeLists: ['recipe-service', 'recipes', 'list'] as const,
    recipeList: (params: ListRecipesParams = {}) => ['recipe-service', 'recipes', 'list', params] as const,
    recipe: (id: string) => ['recipe-service', 'recipes', 'detail', id] as const,
    recipeVersions: (id: string) => ['recipe-service', 'recipes', 'detail', id, 'versions'] as const,
    recipeVersion: (id: string, versionNumber: number) =>
        ['recipe-service', 'recipes', 'detail', id, 'versions', versionNumber] as const,
    recipePhotos: (id: string) => ['recipe-service', 'recipes', 'detail', id, 'photos'] as const,
    collections: ['recipe-service', 'collections'] as const,
    collectionList: (params: ListCollectionsParams = {}) => ['recipe-service', 'collections', 'list', params] as const,
    collection: (id: string) => ['recipe-service', 'collections', 'detail', id] as const,
    /** Prefix over every `recipeSearch(params)` — the address for "every cached recipe search, whatever the terms". */
    recipeSearches: ['recipe-service', 'search', 'recipes'] as const,
    recipeSearch: (params: RecipeSearchParams = {}) => ['recipe-service', 'search', 'recipes', params] as const,
    /** Prefix over every `ingredientSearch(query, limit)` — "every cached ingredient search, whatever the terms". */
    ingredientSearches: ['recipe-service', 'search', 'ingredients'] as const,
    ingredientSearch: (query: string, limit?: number) =>
        ['recipe-service', 'search', 'ingredients', query, limit ?? null] as const,
    /** One ingredient's async-resolution poll (`GET /v1/ingredients/{id}/status`). */
    ingredientStatus: (id: string) => ['recipe-service', 'ingredients', 'detail', id, 'status'] as const,
    /** One ingredient's disambiguation candidate set (`GET /v1/ingredients/{id}/candidates`). */
    ingredientCandidates: (id: string) => ['recipe-service', 'ingredients', 'detail', id, 'candidates'] as const,
} as const;

/** Optional gate shared by id-addressed read hooks. */
export interface QueryEnableOptions {
    readonly enabled?: boolean;
}

// ─── Recipe queries ───────────────────────────────────────────────────────────────────────────────

/** `GET /v1/recipes` — the caller's recipes (paginated). */
export function useRecipes(params: ListRecipesParams = {}) {
    const client = useRecipeServiceClient();

    return useQuery({
        queryKey: recipeServiceKeys.recipeList(params),
        queryFn: () => client.listRecipes(params),
    });
}

/** `GET /v1/recipes/{id}` — a single recipe. */
export function useRecipe(id: string, options: QueryEnableOptions = {}) {
    const client = useRecipeServiceClient();

    return useQuery({
        queryKey: recipeServiceKeys.recipe(id),
        queryFn: () => client.getRecipeById(id),
        enabled: (options.enabled ?? true) && id.length > 0,
    });
}

/** `GET /v1/recipes/{id}/versions` — a recipe's recent versions. */
export function useRecipeVersions(id: string, options: QueryEnableOptions = {}) {
    const client = useRecipeServiceClient();

    return useQuery({
        queryKey: recipeServiceKeys.recipeVersions(id),
        queryFn: () => client.listRecipeVersions(id),
        enabled: (options.enabled ?? true) && id.length > 0,
    });
}

/** `GET /v1/recipes/{id}/versions/{versionNumber}` — a specific version snapshot. */
export function useRecipeVersion(id: string, versionNumber: number, options: QueryEnableOptions = {}) {
    const client = useRecipeServiceClient();

    return useQuery({
        queryKey: recipeServiceKeys.recipeVersion(id, versionNumber),
        queryFn: () => client.getRecipeVersion(id, versionNumber),
        enabled: (options.enabled ?? true) && id.length > 0,
    });
}

/** `GET /v1/recipes/{id}/photos` — a recipe's photos. */
export function useRecipePhotos(id: string, options: QueryEnableOptions = {}) {
    const client = useRecipeServiceClient();

    return useQuery({
        queryKey: recipeServiceKeys.recipePhotos(id),
        queryFn: () => client.listRecipePhotos(id),
        enabled: (options.enabled ?? true) && id.length > 0,
    });
}

// ─── Collection queries ─────────────────────────────────────────────────────────────────────────

/** `GET /v1/collections` — the caller's collections (paginated). */
export function useCollections(params: ListCollectionsParams = {}) {
    const client = useRecipeServiceClient();

    return useQuery({
        queryKey: recipeServiceKeys.collectionList(params),
        queryFn: () => client.listCollections(params),
    });
}

/** `GET /v1/collections/{id}` — a collection with its member recipes. */
export function useCollection(id: string, options: QueryEnableOptions = {}) {
    const client = useRecipeServiceClient();

    return useQuery({
        queryKey: recipeServiceKeys.collection(id),
        queryFn: () => client.getCollectionById(id),
        enabled: (options.enabled ?? true) && id.length > 0,
    });
}

// ─── Search queries ─────────────────────────────────────────────────────────────────────────────

/** `GET /v1/search/recipes` — full-text recipe search with facets. */
export function useSearchRecipes(params: RecipeSearchParams = {}) {
    const client = useRecipeServiceClient();

    return useQuery({
        queryKey: recipeServiceKeys.recipeSearch(params),
        queryFn: () => client.searchRecipes(params),
    });
}

/**
 * `GET /v1/search/recipes` — the same ranked, faceted, visibility-scoped search as {@link useSearchRecipes},
 * but PAGINATED for a "Load more" flow (W4/S4): each fetched page appends to `data.pages`, and
 * `hasNextPage`/`fetchNextPage` drive the load-more control. The next page is `page + 1` while the last page
 * reported `hasMore`; once it does not, `getNextPageParam` returns `undefined` and the control disappears.
 * Facets come from the first page (they describe the whole result set, not one page).
 *
 * @param params - The search criteria (query/filters/sort). The `page` field is managed by the pager.
 */
export function useInfiniteSearchRecipes(params: RecipeSearchParams = {}) {
    const client = useRecipeServiceClient();

    return useInfiniteQuery({
        queryKey: recipeServiceKeys.recipeSearch(params),
        queryFn: ({ pageParam }) => client.searchRecipes({ ...params, page: pageParam }),
        initialPageParam: 1,
        getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.page + 1 : undefined),
    });
}

/** `GET /v1/ingredients/search` — ingredient typeahead (disabled for an empty query). */
export function useSearchIngredients(query: string, limit?: number, options: QueryEnableOptions = {}) {
    const client = useRecipeServiceClient();

    return useQuery({
        queryKey: recipeServiceKeys.ingredientSearch(query, limit),
        queryFn: () => client.searchIngredients(query, limit),
        enabled: (options.enabled ?? true) && query.length > 0,
    });
}

/** Default poll cadence (ms) for {@link useIngredientStatus} — spaced so a `PENDING` food does not hammer. */
export const DEFAULT_INGREDIENT_POLL_INTERVAL_MS = 2500;

/** Options for {@link useIngredientStatus}. */
export interface IngredientStatusOptions extends QueryEnableOptions {
    /** Poll cadence (ms) while the food is `PENDING`. Defaults to {@link DEFAULT_INGREDIENT_POLL_INTERVAL_MS}. */
    readonly pollIntervalMs?: number;
}

/**
 * `GET /v1/ingredients/{id}/status` — poll a food-backed ingredient's async resolution (data-model R5).
 *
 * The poll is SELF-LIMITING: `refetchInterval` returns a cadence ONLY while the last-seen status is
 * `PENDING`, and `false` for every other state — `RESOLVED`, `UNRESOLVED` (needs user disambiguation, not
 * more polling), the `NOT_FOUND`/`FAILED` terminals, and a freeform ingredient (no status). So it stops the
 * instant nutrition arrives or a terminal/disambiguation state is reached, never spinning on a food that
 * will not change by polling. TanStack keeps a single in-flight refetch per tick, and background refetching
 * is left off, so it cannot storm the endpoint.
 *
 * @param id - The ingredient id (the query is disabled for an empty id).
 * @param options - Enable gate + poll cadence.
 */
export function useIngredientStatus(id: string, options: IngredientStatusOptions = {}) {
    const client = useRecipeServiceClient();
    const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_INGREDIENT_POLL_INTERVAL_MS;

    return useQuery({
        queryKey: recipeServiceKeys.ingredientStatus(id),
        queryFn: () => client.getIngredientStatus(id),
        enabled: (options.enabled ?? true) && id.length > 0,
        refetchInterval: (query) => {
            const data = query.state.data as Ingredient | undefined;

            return data?.foodResolutionStatus === FoodResolutionStatus.PENDING ? pollIntervalMs : false;
        },
    });
}

/**
 * `GET /v1/ingredients/{id}/candidates` — the disambiguation candidate set for an `UNRESOLVED` ingredient.
 * Gate it (`enabled`) on a line actually being `UNRESOLVED` so it never fetches for a resolved/freeform line.
 *
 * @param id - The ingredient id (the query is disabled for an empty id).
 * @param options - Enable gate.
 */
export function useIngredientCandidates(id: string, options: QueryEnableOptions = {}) {
    const client = useRecipeServiceClient();

    return useQuery({
        queryKey: recipeServiceKeys.ingredientCandidates(id),
        queryFn: () => client.getIngredientCandidates(id),
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

/** `POST /v1/recipes` — create a recipe. */
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

/** `PATCH /v1/recipes/{id}` — update a recipe (optimistic concurrency). */
export function useUpdateRecipe() {
    const client = useRecipeServiceClient();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (vars: { id: string; input: UpdateRecipeInput }) => client.updateRecipe(vars.id, vars.input),
        onSuccess: () => {
            invalidateEditedRecipeRows(queryClient);
        },
    });
}

/** `DELETE /v1/recipes/{id}` — soft-delete a recipe. */
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

/** `POST /v1/recipes/{id}/clone` — clone a public recipe. */
export function useCloneRecipe() {
    const client = useRecipeServiceClient();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (id: string) => client.cloneRecipe(id),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.recipes });
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.recipeSearches });
        },
    });
}

/** `PATCH /v1/recipes/{id}/visibility` — set a recipe's visibility. */
export function useSetRecipeVisibility() {
    const client = useRecipeServiceClient();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (vars: { id: string; visibility: RecipeVisibility }) =>
            client.setRecipeVisibility(vars.id, vars.visibility),
        onSuccess: () => {
            invalidateEditedRecipeRows(queryClient);
        },
    });
}

// A write that changes exactly ONE recipe's projected data (not its membership in other rows) stales three
// regions and no more: that recipe's own subtree (`recipe(id)` — detail + versions + photos), every recipe
// LIST (`recipeLists` — its rows render the same projection), and the SEARCH namespace (`recipeSearches` —
// a search row embeds the full `Recipe`). It is keyed off the mutation's variables, so a sibling recipe's
// detail stays cached. `recipeSearches` is ALWAYS a separate, explicit call: search lives under the
// `search` namespace OUTSIDE the `recipes` prefix (a prior class of staleness bugs), so no `recipes`
// invalidation reaches it by accident. Restore, both rating writes, and all three photo writes share this
// exact set — each changes a DIFFERENT projected field (title/`currentVersion`, `averageRating`/
// `ratingCount`, `coverPhotoUrl` respectively), but every one of those fields renders on the detail, on
// every list row, AND on every search result.

/**
 * Invalidate the caches that render a single recipe's projected data: its own subtree (`recipe(id)`), every
 * recipe list (`recipeLists`), and the recipe-search namespace (`recipeSearches`). Sibling recipes stay
 * cached. See the block comment above for why these three — and only these three — go stale together.
 *
 * @param queryClient - The query client whose cache to invalidate.
 * @param recipeId - The recipe whose detail/list/search projections changed.
 * @sideEffect Marks the three regions stale on the query cache.
 */
function invalidateRecipeProjections(queryClient: ReturnType<typeof useQueryClient>, recipeId: string): void {
    void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.recipe(recipeId) });
    void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.recipeLists });
    void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.recipeSearches });
    // DA2 — a `CollectionWithRecipes.recipes` entry embeds the full `Recipe` projection, so a write that
    // changes this recipe's title/cover/rating leaves every cached collection that embeds it stale. The
    // client has no index of which collections embed this recipe, so it stales the whole `collections`
    // prefix. (Direction note: this is recipe-write → embed; the reverse, membership-write narrowness, is
    // deliberately NOT widened — only collection mutations touch a specific `collection(id)`.)
    void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.collections });
}

/**
 * Invalidate the broad set an EDIT to an existing recipe stales: every recipe query (`recipes`), the
 * recipe-search namespace (`recipeSearches`), and — DA2 — every collection embed (`collections`). Used by the
 * library-wide edit writes (update/delete/visibility) that do not know which single recipe id changed a row
 * (delete/visibility target one recipe, but the existing broad-invalidation contract stales all recipe rows;
 * this preserves that and only ADDS the collection embeds). `create`/`clone` mint a NEW recipe that is a
 * member of no collection, so they keep their narrower recipes+search invalidation.
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
 * `POST /v1/recipes/{id}/versions/{versionNumber}/restore` — restore a recipe to a prior version.
 *
 * A restore is server-side a full recipe update off the snapshot: it rewrites the title/description/times,
 * replaces the ingredient and step sets, bumps `currentVersion`, and records a new version. So it stales the
 * standard single-recipe projection set via {@link invalidateRecipeProjections} — list rows render `title`
 * and `currentVersion`, and the snapshot's text rebuilds the row's search vector. Keyed off the mutation's
 * variables: a restore touches exactly one recipe, so no sibling recipe's detail is invalidated.
 */
export function useRestoreRecipeVersion() {
    const client = useRecipeServiceClient();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (vars: { id: string; versionNumber: number }) =>
            client.restoreRecipeVersion(vars.id, vars.versionNumber),
        onSuccess: (_result, vars) => {
            invalidateRecipeProjections(queryClient, vars.id);
        },
    });
}

// The two rating writes below stale the same single-recipe projection set (subtree + every list + search):
// a rating changes the trigger-maintained `averageRating` / `ratingCount`, which render on the detail, on
// every list row, AND on every search result.

/** `PUT /v1/recipes/{id}/rating` — set the caller's rating (idempotent upsert). */
export function useSetRecipeRating() {
    const client = useRecipeServiceClient();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (vars: { id: string; input: SetRecipeRatingInput }) => client.setRecipeRating(vars.id, vars.input),
        onSuccess: (_result, vars) => {
            invalidateRecipeProjections(queryClient, vars.id);
        },
    });
}

/** `DELETE /v1/recipes/{id}/rating` — remove the caller's rating (idempotent). */
export function useDeleteRecipeRating() {
    const client = useRecipeServiceClient();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (id: string) => client.deleteRecipeRating(id),
        onSuccess: (_result, id) => {
            invalidateRecipeProjections(queryClient, id);
        },
    });
}

// ─── Ingredient mutations ─────────────────────────────────────────────────────────────────────────

/** `POST /v1/ingredients` — create a freeform ingredient. */
export function useCreateIngredient() {
    const client = useRecipeServiceClient();

    return useMutation({
        mutationFn: (name: string) => client.createIngredient(name),
    });
}

/**
 * `POST /v1/ingredients/by-name` — add an unknown food by name through the food service (data-model R5).
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
 * `POST /v1/ingredients/{id}/resolve` — resolve an `UNRESOLVED` ingredient from a candidate pick.
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

/** `POST /v1/recipes/{id}/photos/upload-url` — mint a presigned upload URL (no cache to invalidate). */
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

/** `POST /v1/recipes/{id}/photos/confirm` — confirm an uploaded photo. */
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

/** `DELETE /v1/recipes/{id}/photos/{photoId}` — delete a photo. */
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

/** `PATCH /v1/recipes/{id}/photos/reorder` — reorder a recipe's photos. */
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

/** `POST /v1/collections` — create a collection. */
export function useCreateCollection() {
    const client = useRecipeServiceClient();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (request: CreateCollectionRequest) => client.createCollection(request),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.collections });
        },
    });
}

/** `PATCH /v1/collections/{id}` — update a collection. */
export function useUpdateCollection() {
    const client = useRecipeServiceClient();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (vars: { id: string; request: UpdateCollectionRequest }) =>
            client.updateCollection(vars.id, vars.request),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.collections });
        },
    });
}

/** `DELETE /v1/collections/{id}` — delete a collection. */
export function useDeleteCollection() {
    const client = useRecipeServiceClient();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (id: string) => client.deleteCollection(id),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.collections });
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

/** `POST /v1/collections/{id}/recipes` — add a recipe to a collection. */
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

/** `DELETE /v1/collections/{id}/recipes/{recipeId}` — remove a recipe from a collection. */
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

/** `POST /v1/collections/{id}/clone` — clone a collection. */
export function useCloneCollection() {
    const client = useRecipeServiceClient();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (vars: { id: string; request?: CloneCollectionRequest }) =>
            client.cloneCollection(vars.id, vars.request),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.collections });
        },
    });
}

/** `POST /v1/collections/{id}/pull-from-source` — pull new recipes from a cloned collection's source. */
export function usePullCollectionFromSource() {
    const client = useRecipeServiceClient();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (id: string) => client.pullCollectionFromSource(id),
        // A pull only adds MEMBERSHIP rows (`added_via = 'pull'`) — it creates no recipes and edits no
        // recipe row, so no recipe or search query is stale. Only the collection namespace is.
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.collections });
        },
    });
}

// ─── Account mutations ────────────────────────────────────────────────────────────────────────────

/** `POST /v1/account/erasure` — request GDPR account erasure. */
export function useRequestAccountErasure() {
    const client = useRecipeServiceClient();

    return useMutation({
        mutationFn: (request?: ErasureRequest) => client.requestAccountErasure(request),
    });
}
