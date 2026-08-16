/**
 * `queryOptions` factory module for `@kitchensink/recipe-service-client` (W9/P5 — the Repository read
 * seam). Each factory method returns a plain v5 `queryOptions`/`infiniteQueryOptions` object (key +
 * fetcher + cache policy) built from a {@link RecipeServiceClient}; `hooks.ts` is the ONLY current
 * consumer (`useQuery(recipeQueries(client).detail(id))`), but the object is a self-contained,
 * hook-independent value — a future non-hook caller (`queryClient.prefetchQuery`, a loader) can reuse it
 * without re-deriving the key or re-deciding the cache policy.
 *
 * This module owns two things hooks.ts used to own directly:
 *
 *  - {@link recipeServiceKeys} — the query-key factory. It moved here (not to hooks.ts) because the
 *    factories in THIS file build on it; hooks.ts now imports it (and re-exports it, so every existing
 *    `import { recipeServiceKeys } from '../hooks.js'` / `@kitchensink/recipe-service-client/hooks`
 *    keeps working unchanged). Keeping it here also avoids a hooks.ts ⇄ queries.ts import cycle: this
 *    module has no dependency on hooks.ts, hooks.ts depends on this module.
 *  - {@link recipeProjections} — the invalidation REGISTRY a recipe-row write stales: that recipe's own
 *    subtree, every recipe list, the recipe-search namespace, and (DA2) every collection embed.
 *    `hooks.ts`'s `invalidateRecipeProjections` is now a thin loop over this list, so the registry and the
 *    factories read off the exact same four regions — they cannot drift apart.
 *
 * **Per-domain cache policy — a stated decision, not a library default left by omission.** `staleTime`
 * varies by how often the underlying data actually changes:
 *  - Recipe detail/list/photos (`RECIPE_STANDARD_STALE_TIME_MS`, 30s): a recipe's projected fields (title,
 *    cover, rating) change only on an explicit write (edit/rate/photo), never in the background.
 *  - Recipe search (`RECIPE_SEARCH_STALE_TIME_MS`, 15s): shorter, because a search result also reflects
 *    OTHER users' writes (public recipes), so the client should reconcile more often than for its own data.
 *  - Recipe versions/version snapshot (`RECIPE_VERSIONS_STALE_TIME_MS`, 60s): a version list only grows on
 *    a save, and a single version SNAPSHOT is immutable once created — both are the least likely to change
 *    of anything this module reads, so they get the longest policy.
 *  - Collections (`COLLECTION_STALE_TIME_MS`, 30s): same cadence as recipe detail — a collection's own
 *    fields (name/description) and its `recipes` embed change only on an explicit collection write or a
 *    member recipe's write (both already invalidate it explicitly).
 *  - Ingredient search (`INGREDIENT_SEARCH_STALE_TIME_MS`, 15s): typeahead over a catalog that resolves in
 *    the background (async food resolution), so it shares search's tighter policy.
 *  - Ingredient status / candidates: left at the library default (`staleTime: 0`, no override). `status`
 *    is governed entirely by its `refetchInterval` below — a `staleTime` here would fight that mechanism,
 *    not complement it. `candidates` is read once for an active disambiguation and the screen unmounts on
 *    resolve, so there is no repeat-visit staleness to manage.
 *
 * `gcTime` is left at the library default (5 minutes) for every method: nothing this module reads has a
 * stated eviction-timing requirement, and overriding it without one would be tuning without a target.
 */
import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import type { QueryKey } from '@tanstack/react-query';

import { FoodResolutionStatus } from '@kitchensink/recipe-core';
import type { Ingredient } from '@kitchensink/recipe-core';
import type { RecipeSearchQuery } from '@kitchensink/schema-recipe';

import type { RecipeServiceClient } from './client.js';
import type { ListCollectionsParams, ListRecipesParams } from './types.js';

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
    /**
     * One deferred nutrition batch (`POST /api/v1/recipes/nutrition-batch`), keyed by the recipes asked about.
     *
     * ⚠️ THE IDS ARE SORTED INTO THE KEY, and that is the point rather than tidiness: a list page and a
     * search page showing the same recipes in different orders are ONE logical read, and an order-sensitive
     * key would fetch twice, cache twice, and let the two views disagree about the same recipe's calories.
     * It is the client-side twin of the canonicalization food applies to its own nutrition URL.
     *
     * Its own `nutrition` segment under the `recipes` prefix, so `recipeLists`/`recipe(id)` invalidation does
     * NOT stale these figures: they are derived from FOOD's data, which a recipe write does not change.
     */
    recipeNutrition: (recipeIds: readonly string[]) =>
        ['recipe-service', 'recipes', 'nutrition', [...recipeIds].sort()] as const,
    /** Prefix over every `recipeSearch(params)` — the address for "every cached recipe search, whatever the terms". */
    recipeSearches: ['recipe-service', 'search', 'recipes'] as const,
    recipeSearch: (params: RecipeSearchQuery = {}) => ['recipe-service', 'search', 'recipes', params] as const,
    /**
     * Prefix over every `ingredientSearch(query, limit)` AND every `ingredientSuggest(query, limit)` —
     * "every cached ingredient typeahead, whatever the terms or blend". Deliberately the shared parent of
     * both: an ingredient write (add-by-name, add-by-food, resolve) changes the catalog BOTH reads project,
     * so one invalidation must stale both or the blended picker would keep rendering a pre-write section.
     */
    ingredientSearches: ['recipe-service', 'search', 'ingredients'] as const,
    ingredientSearch: (query: string, limit?: number) =>
        ['recipe-service', 'search', 'ingredients', query, limit ?? null] as const,
    /**
     * One blended typeahead read (`GET /api/v1/ingredients/suggest`). Keyed under a `suggest` segment of the
     * SAME `ingredientSearches` prefix so it shares that invalidation region while never colliding with a
     * local-only `/search` entry for the same terms — the two return different shapes, so one cache key
     * serving both would be a type error waiting to happen.
     */
    ingredientSuggest: (query: string, limit?: number) =>
        ['recipe-service', 'search', 'ingredients', 'suggest', query, limit ?? null] as const,
    /** One ingredient's async-resolution poll (`GET /api/v1/ingredients/{id}/status`). */
    ingredientStatus: (id: string) => ['recipe-service', 'ingredients', 'detail', id, 'status'] as const,
    /** One ingredient's disambiguation candidate set (`GET /api/v1/ingredients/{id}/candidates`). */
    ingredientCandidates: (id: string) => ['recipe-service', 'ingredients', 'detail', id, 'candidates'] as const,
} as const;

// ─── Cache policy (per-domain staleTime — see the module doc for the rationale behind each value) ──

const RECIPE_STANDARD_STALE_TIME_MS = 30_000;
const RECIPE_SEARCH_STALE_TIME_MS = 15_000;
const RECIPE_VERSIONS_STALE_TIME_MS = 60_000;
const COLLECTION_STALE_TIME_MS = 30_000;
const INGREDIENT_SEARCH_STALE_TIME_MS = 15_000;

/** Default poll cadence (ms) for {@link ingredientQueries}`.status` — spaced so a `PENDING` food does not hammer. */
export const DEFAULT_INGREDIENT_POLL_INTERVAL_MS = 2500;

/**
 * ⛔ THE OVERALL DEADLINE for one deferred-nutrition read, and the reason the client's own timeout is not
 * enough.
 *
 * `RecipeServiceClient` bounds each ATTEMPT (ky's `timeout`, 10s). It does NOT bound the CALL: `send()` may
 * replay a request up to four times — three identity-sync retries with backoff, plus one expired-token
 * retry — so the worst-case wait is several multiples of the per-attempt bound. Every one of those attempts
 * is individually reasonable, and the sum is not.
 *
 * That matters HERE more than anywhere else in this client, because this is the read a card grid renders a
 * skeleton for. The wire union deliberately has no `pending` member so that no server can pin a spinner
 * forever — but that guarantee is only as good as the promise the spinner waits on settling. This is what
 * makes it settle: 12s, comfortably past one healthy attempt plus a retry, and far inside any human's
 * patience for a figure that is decoration on an already-rendered card.
 *
 * A rejection is the CORRECT outcome, not a regression: the caller falls back to rendering the recipes with
 * their nutrition unaccounted, which is exactly the state the contract already has a name for.
 */
export const NUTRITION_BATCH_DEADLINE_MS = 12_000;

/**
 * Compose a caller's cancellation with a FINITE deadline, returning a signal that is guaranteed to abort.
 *
 * Extracted as its own function rather than inlined for one reason: inlined, its removal is undetectable.
 * A test can only observe that SOME `AbortSignal` reached the transport, which the query's own signal
 * satisfies — so deleting the deadline (the thing that makes the promise settle at all) passes every
 * assertion. As a named function with the deadline as a parameter, the behaviour is directly testable at a
 * millisecond scale, and the factory's use of it is observable by identity.
 *
 * @param signal - TanStack's per-query signal (aborts on unmount / key change), when there is one.
 * @param deadlineMs - The overall bound, after which the request is abandoned regardless.
 * @returns A signal that aborts when EITHER fires. Pure — allocates, performs no I/O.
 */
export function withDeadline(signal: AbortSignal | undefined, deadlineMs: number): AbortSignal {
    const deadline = AbortSignal.timeout(deadlineMs);

    return signal === undefined ? deadline : AbortSignal.any([signal, deadline]);
}

/**
 * Retries for the deferred nutrition read. ONE, deliberately.
 *
 * The library default (3, with exponential backoff) would stack on top of the transport's own retries and
 * push the worst case past {@link NUTRITION_BATCH_DEADLINE_MS} — at which point the deadline, not the retry
 * policy, decides the outcome, and the retries are pure latency. One retry covers the single dropped
 * connection this is actually worth defending against.
 */
const NUTRITION_BATCH_RETRIES = 1;

/**
 * Cache policy for the nutrition batch. Longer than the recipe list's 30s because the underlying data is
 * FOOD's, not the viewer's: it changes on food's ingest schedule, not on any write this client makes, and
 * the service already serves it through a 5-minute in-process cache of its own.
 */
const NUTRITION_BATCH_STALE_TIME_MS = 120_000;

// ─── Recipe queries ───────────────────────────────────────────────────────────────────────────────

/**
 * `queryOptions` factories for every recipe read. `list`/`listInfinite` and `search`/`searchInfinite` are
 * deliberate pairs: the flat variant renders the current page, the infinite variant backs a "load more"
 * flow — and each pair shares ONE query key (a flat and an infinite read of the same params are the same
 * logical cache entry; TanStack distinguishes their internal page shape by which hook subscribes to them).
 *
 * @param client - The configured client the factories' fetchers call through.
 * @returns One `queryOptions`/`infiniteQueryOptions` builder per recipe read.
 */
export function recipeQueries(client: RecipeServiceClient) {
    return {
        /** `GET /api/v1/recipes` — the caller's recipes (paginated, flat page). */
        list: (params: ListRecipesParams = {}) =>
            queryOptions({
                queryKey: recipeServiceKeys.recipeList(params),
                queryFn: () => client.listRecipes(params),
                staleTime: RECIPE_STANDARD_STALE_TIME_MS,
            }),
        /** `GET /api/v1/recipes` — the same list, paginated for a "Load more" flow. */
        listInfinite: (params: ListRecipesParams = {}) =>
            infiniteQueryOptions({
                queryKey: recipeServiceKeys.recipeList(params),
                queryFn: ({ pageParam }) => client.listRecipes({ ...params, page: pageParam }),
                initialPageParam: 1,
                getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.page + 1 : undefined),
                staleTime: RECIPE_STANDARD_STALE_TIME_MS,
            }),
        /** `GET /api/v1/recipes/{id}` — a single recipe. */
        detail: (id: string) =>
            queryOptions({
                queryKey: recipeServiceKeys.recipe(id),
                queryFn: () => client.getRecipeById(id),
                staleTime: RECIPE_STANDARD_STALE_TIME_MS,
            }),
        /** `GET /api/v1/recipes/{id}/versions` — a recipe's recent versions. */
        versions: (id: string) =>
            queryOptions({
                queryKey: recipeServiceKeys.recipeVersions(id),
                queryFn: () => client.listRecipeVersions(id),
                staleTime: RECIPE_VERSIONS_STALE_TIME_MS,
            }),
        /** `GET /api/v1/recipes/{id}/versions/{versionNumber}` — a specific version snapshot (immutable once created). */
        version: (id: string, versionNumber: number) =>
            queryOptions({
                queryKey: recipeServiceKeys.recipeVersion(id, versionNumber),
                queryFn: () => client.getRecipeVersion(id, versionNumber),
                staleTime: RECIPE_VERSIONS_STALE_TIME_MS,
            }),
        /** `GET /api/v1/recipes/{id}/photos` — a recipe's photos (embedded on the detail; same cadence). */
        photos: (id: string) =>
            queryOptions({
                queryKey: recipeServiceKeys.recipePhotos(id),
                queryFn: () => client.listRecipePhotos(id),
                staleTime: RECIPE_STANDARD_STALE_TIME_MS,
            }),
        /**
         * `POST /api/v1/recipes/nutrition-batch` — per-serving nutrition for a page of recipes.
         *
         * ⚠️ A POST IN A QUERY FACTORY IS NOT A MISTAKE. This is a READ that has to be a POST: its response
         * varies by caller (a recipe the viewer may not read is omitted, which is how authorization is
         * expressed), and at the published id cap the equivalent query string would exceed the CDN's URL
         * limit. It has no side effect, so it belongs in the cache, not in `useMutation`.
         *
         * ⛔ THE DEADLINE IS THE LOAD-BEARING PART. `signal` composes TanStack's own cancellation (unmount,
         * key change) with a finite {@link NUTRITION_BATCH_DEADLINE_MS} timeout, so this promise ALWAYS
         * settles — which is what makes the `pending` skeleton a card renders temporary. Without it the
         * transport's per-attempt timeout still permits four attempts plus backoff, and the union's
         * deliberate lack of a `pending` wire state would be undone on the client instead of by a server.
         */
        nutritionBatch: (recipeIds: readonly string[]) =>
            queryOptions({
                queryKey: recipeServiceKeys.recipeNutrition(recipeIds),
                queryFn: ({ signal }) =>
                    client.getRecipeNutrition(recipeIds, {
                        signal: withDeadline(signal, NUTRITION_BATCH_DEADLINE_MS),
                    }),
                staleTime: NUTRITION_BATCH_STALE_TIME_MS,
                retry: NUTRITION_BATCH_RETRIES,
                // The service REJECTS an empty list (asking about nothing is a caller bug, not an empty
                // answer), so firing this would be a guaranteed 400 — gate it here instead.
                enabled: recipeIds.length > 0,
            }),
        /** `GET /api/v1/search/recipes` — full-text recipe search with facets (flat page). */
        search: (params: RecipeSearchQuery = {}) =>
            queryOptions({
                queryKey: recipeServiceKeys.recipeSearch(params),
                queryFn: () => client.searchRecipes(params),
                staleTime: RECIPE_SEARCH_STALE_TIME_MS,
            }),
        /**
         * `GET /api/v1/search/recipes` — the same search, paginated for a "Load more" flow (W4/S4). Each
         * fetched page appends to `data.pages`; the next page is `page + 1` while the last page reported
         * `hasMore`, otherwise `getNextPageParam` returns `undefined` and the control disappears.
         */
        searchInfinite: (params: RecipeSearchQuery = {}) =>
            infiniteQueryOptions({
                queryKey: recipeServiceKeys.recipeSearch(params),
                queryFn: ({ pageParam }) => client.searchRecipes({ ...params, page: pageParam }),
                initialPageParam: 1,
                getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.page + 1 : undefined),
                staleTime: RECIPE_SEARCH_STALE_TIME_MS,
            }),
    };
}

// ─── Collection queries ─────────────────────────────────────────────────────────────────────────

/**
 * `queryOptions` factories for every collection read. `list`/`listInfinite` (W5/C7) is the same deliberate
 * pair as `recipeQueries`' `list`/`listInfinite`: the flat variant renders the current page, the infinite
 * variant backs a "load more" flow, and both share ONE query key (a flat and an infinite read of the same
 * params are the same logical cache entry).
 *
 * @param client - The configured client the factories' fetchers call through.
 * @returns One `queryOptions`/`infiniteQueryOptions` builder per collection read.
 */
export function collectionQueries(client: RecipeServiceClient) {
    return {
        /** `GET /api/v1/collections` — the caller's collections (paginated, flat page). */
        list: (params: ListCollectionsParams = {}) =>
            queryOptions({
                queryKey: recipeServiceKeys.collectionList(params),
                queryFn: () => client.listCollections(params),
                staleTime: COLLECTION_STALE_TIME_MS,
            }),
        /**
         * `GET /api/v1/collections` — the same list, paginated for a "Load more" flow (W5/C7). Shares its query
         * key with `list` (same "flat + infinite share one key" contract as `recipeQueries`) — a flat and an
         * infinite read of the same params are the same logical cache entry.
         */
        listInfinite: (params: ListCollectionsParams = {}) =>
            infiniteQueryOptions({
                queryKey: recipeServiceKeys.collectionList(params),
                queryFn: ({ pageParam }) => client.listCollections({ ...params, page: pageParam }),
                initialPageParam: 1,
                getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.page + 1 : undefined),
                staleTime: COLLECTION_STALE_TIME_MS,
            }),
        /** `GET /api/v1/collections/{id}` — a collection with its member recipes. */
        detail: (id: string) =>
            queryOptions({
                queryKey: recipeServiceKeys.collection(id),
                queryFn: () => client.getCollectionById(id),
                staleTime: COLLECTION_STALE_TIME_MS,
            }),
    };
}

// ─── Ingredient queries ─────────────────────────────────────────────────────────────────────────

/**
 * `queryOptions` factories for every ingredient read.
 *
 * @param client - The configured client the factories' fetchers call through.
 * @returns One `queryOptions` builder per ingredient read.
 */
export function ingredientQueries(client: RecipeServiceClient) {
    return {
        /** `GET /api/v1/ingredients/search` — LOCAL-only ingredient typeahead (the recipe-search filter's read). */
        search: (query: string, limit?: number) =>
            queryOptions({
                queryKey: recipeServiceKeys.ingredientSearch(query, limit),
                queryFn: () => client.searchIngredients(query, limit),
                staleTime: INGREDIENT_SEARCH_STALE_TIME_MS,
            }),
        /**
         * `GET /api/v1/ingredients/suggest` — the BLENDED typeahead (search Stage 2), the picker's read.
         *
         * Same short `staleTime` as the local search: a keystroke-driven typeahead over a catalog that
         * changes as users add ingredients. Deliberately NO `retry` override — the endpoint already degrades
         * to local-only when the food catalog is unavailable (it answers `200` with
         * `catalogAvailability: 'unavailable'` rather than failing), so a retry policy here would only cover
         * recipe-service itself, which the library default already handles.
         */
        suggest: (query: string, limit?: number) =>
            queryOptions({
                queryKey: recipeServiceKeys.ingredientSuggest(query, limit),
                queryFn: () => client.suggestIngredients(query, limit),
                staleTime: INGREDIENT_SEARCH_STALE_TIME_MS,
            }),
        /**
         * `GET /api/v1/ingredients/{id}/status` — poll a food-backed ingredient's async resolution (data-model
         * R5). The poll is SELF-LIMITING: `refetchInterval` returns a cadence ONLY while the last-seen
         * status is `PENDING`, and `false` for every other state — `RESOLVED`, `UNRESOLVED` (needs user
         * disambiguation, not more polling), the `NOT_FOUND`/`FAILED` terminals, and a freeform ingredient
         * (no status). `staleTime` is deliberately left at the library default: this mechanism, not a
         * staleness window, is what governs when the query re-fetches.
         *
         * @param id - The ingredient id.
         * @param pollIntervalMs - Poll cadence (ms) while `PENDING`. Defaults to {@link DEFAULT_INGREDIENT_POLL_INTERVAL_MS}.
         */
        status: (id: string, pollIntervalMs: number = DEFAULT_INGREDIENT_POLL_INTERVAL_MS) =>
            queryOptions({
                queryKey: recipeServiceKeys.ingredientStatus(id),
                queryFn: () => client.getIngredientStatus(id),
                refetchInterval: (query) => {
                    const data = query.state.data as Ingredient | undefined;

                    return data?.foodResolutionStatus === FoodResolutionStatus.PENDING ? pollIntervalMs : false;
                },
            }),
        /** `GET /api/v1/ingredients/{id}/candidates` — the disambiguation candidate set for an `UNRESOLVED` ingredient. */
        candidates: (id: string) =>
            queryOptions({
                queryKey: recipeServiceKeys.ingredientCandidates(id),
                queryFn: () => client.getIngredientCandidates(id),
            }),
    };
}

// ─── Invalidation registry ──────────────────────────────────────────────────────────────────────

/**
 * The cache regions a write that changes a single recipe's PROJECTED data must stale: that recipe's own
 * subtree (`recipe(id)` — detail + versions + photos), every recipe list (`recipeLists` — its rows render
 * the same projection), the recipe-search namespace (`recipeSearches` — a search row embeds the full
 * `Recipe`), and — DA2 — every collection (`collections`, because a `CollectionWithRecipes.recipes` entry
 * embeds the full `Recipe` projection too, and the client has no index of which collections embed this
 * recipe). `hooks.ts`'s `invalidateRecipeProjections` loops over exactly this list, so the registry and
 * the invalidation call site cannot drift apart.
 *
 * @param recipeId - The recipe whose detail/list/search/collection-embed projections changed.
 * @returns The four query-key regions to invalidate, in registry order.
 */
export function recipeProjections(recipeId: string): readonly QueryKey[] {
    return [
        recipeServiceKeys.recipe(recipeId),
        recipeServiceKeys.recipeLists,
        recipeServiceKeys.recipeSearches,
        recipeServiceKeys.collections,
    ];
}
