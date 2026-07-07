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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, createElement, useContext } from 'react';
import type { ReactElement, ReactNode } from 'react';

import type {
    CreateRecipeInput,
    RecipeSearchParams,
    RecipeVisibility,
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

/** Stable query-key factory for every recipe-service query (use its prefixes for invalidation). */
export const recipeServiceKeys = {
    all: ['recipe-service'] as const,
    recipes: ['recipe-service', 'recipes'] as const,
    recipeList: (params: ListRecipesParams = {}) => ['recipe-service', 'recipes', 'list', params] as const,
    recipe: (id: string) => ['recipe-service', 'recipes', 'detail', id] as const,
    recipeVersions: (id: string) => ['recipe-service', 'recipes', 'detail', id, 'versions'] as const,
    recipeVersion: (id: string, versionNumber: number) =>
        ['recipe-service', 'recipes', 'detail', id, 'versions', versionNumber] as const,
    recipePhotos: (id: string) => ['recipe-service', 'recipes', 'detail', id, 'photos'] as const,
    collections: ['recipe-service', 'collections'] as const,
    collectionList: (params: ListCollectionsParams = {}) => ['recipe-service', 'collections', 'list', params] as const,
    collection: (id: string) => ['recipe-service', 'collections', 'detail', id] as const,
    recipeSearch: (params: RecipeSearchParams = {}) => ['recipe-service', 'search', 'recipes', params] as const,
    ingredientSearch: (query: string, limit?: number) =>
        ['recipe-service', 'search', 'ingredients', query, limit ?? null] as const,
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

/** `GET /v1/ingredients/search` — ingredient typeahead (disabled for an empty query). */
export function useSearchIngredients(query: string, limit?: number, options: QueryEnableOptions = {}) {
    const client = useRecipeServiceClient();

    return useQuery({
        queryKey: recipeServiceKeys.ingredientSearch(query, limit),
        queryFn: () => client.searchIngredients(query, limit),
        enabled: (options.enabled ?? true) && query.length > 0,
    });
}

// ─── Recipe mutations ─────────────────────────────────────────────────────────────────────────────

/** `POST /v1/recipes` — create a recipe. */
export function useCreateRecipe() {
    const client = useRecipeServiceClient();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (input: CreateRecipeInput) => client.createRecipe(input),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.recipes });
        },
    });
}

/** `PATCH /v1/recipes/{id}` — update a recipe (optimistic concurrency). */
export function useUpdateRecipe() {
    const client = useRecipeServiceClient();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (vars: { id: string; input: UpdateRecipeInput }) => client.updateRecipe(vars.id, vars.input),
        onSuccess: (recipe) => {
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.recipe(recipe.id) });
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.recipes });
        },
    });
}

/** `DELETE /v1/recipes/{id}` — soft-delete a recipe. */
export function useDeleteRecipe() {
    const client = useRecipeServiceClient();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (id: string) => client.deleteRecipe(id),
        onSuccess: (_result, id) => {
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.recipe(id) });
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.recipes });
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
        onSuccess: (recipe) => {
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.recipe(recipe.id) });
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.recipes });
        },
    });
}

/** `POST /v1/recipes/{id}/versions/{versionNumber}/restore` — restore a recipe to a prior version. */
export function useRestoreRecipeVersion() {
    const client = useRecipeServiceClient();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (vars: { id: string; versionNumber: number }) =>
            client.restoreRecipeVersion(vars.id, vars.versionNumber),
        onSuccess: (_result, vars) => {
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.recipe(vars.id) });
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.recipeVersions(vars.id) });
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

// ─── Photo mutations ──────────────────────────────────────────────────────────────────────────────

/** `POST /v1/recipes/{id}/photos/upload-url` — mint a presigned upload URL (no cache to invalidate). */
export function useCreatePhotoUploadUrl() {
    const client = useRecipeServiceClient();

    return useMutation({
        mutationFn: (vars: { id: string; request: PhotoUploadUrlRequest }) =>
            client.createPhotoUploadUrl(vars.id, vars.request),
    });
}

/** `POST /v1/recipes/{id}/photos/confirm` — confirm an uploaded photo. */
export function useConfirmPhotoUpload() {
    const client = useRecipeServiceClient();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (vars: { id: string; request: PhotoConfirmRequest }) =>
            client.confirmPhotoUpload(vars.id, vars.request),
        onSuccess: (_result, vars) => {
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.recipePhotos(vars.id) });
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.recipe(vars.id) });
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
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.recipePhotos(vars.id) });
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
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.recipePhotos(vars.id) });
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
        onSuccess: (collection) => {
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.collection(collection.id) });
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
        onSuccess: (_result, id) => {
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.collection(id) });
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.collections });
        },
    });
}

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
        onSuccess: (_result, id) => {
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.collection(id) });
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
