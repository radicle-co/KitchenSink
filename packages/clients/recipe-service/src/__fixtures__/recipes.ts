/**
 * `make*` fixture factories for the {@link RecipeServiceClient} tests (CODING_STANDARDS `__fixtures__`).
 * Each accepts a `Partial<T>` of overrides and returns a fully-defined, JSON-safe value so a fixture can
 * be round-tripped through a fake fetch (`JSON.stringify` → `JSON.parse`) and still `toEqual` the input.
 * Optional domain fields are omitted (not set to `undefined`) so the serialized wire shape is exact.
 */
import type {
    Collection,
    Ingredient,
    PaginatedResponse,
    Recipe,
    RecipeDetail,
    RecipePhoto,
    RecipeSearchResult,
    RecipeVersion,
    RestoreVersionResponse,
} from '@kitchensink/recipe-core';

import type {
    CollectionRecipeMembership,
    CollectionWithRecipes,
    ErasureRequestAcceptedResponse,
    PullFromSourceResponse,
    RecipeSearchResponse,
    UploadUrlResponse,
} from '../types.js';

/** Build a light {@link Recipe} (list/search/collection projection — no cookable content). */
export function makeRecipe(overrides: Partial<Recipe> = {}): Recipe {
    return {
        id: 'rec_1',
        ownerId: 'usr_1',
        title: 'Tomato Soup',
        description: 'A warming bowl.',
        prepTimeMinutes: 10,
        cookTimeMinutes: 20,
        totalTimeMinutes: 30,
        servings: 4,
        visibility: 'private',
        status: 'published',
        sourceType: 'user_created',
        hasSubstantiveEdit: false,
        dietaryFlags: ['vegan'],
        tags: ['soup'],
        hasPartialNutrition: false,
        currentVersion: 1,
        // CR-001 aggregate: an unrated recipe (ratingCount 0, no averageRating). Both are now REQUIRED on
        // the `Recipe` contract (FR-013a); a rating fixture overrides them.
        ratingCount: 0,
        // Derived PRO badge (FR-003a) — REQUIRED on `Recipe`. A private user_created recipe is premium,
        // but this default projection is the non-premium baseline; override per test.
        usesPremiumCapability: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        ...overrides,
    };
}

/** Build a full {@link RecipeDetail} (a {@link Recipe} plus cookable content: ingredients/steps/photos). */
export function makeRecipeDetail(overrides: Partial<RecipeDetail> = {}): RecipeDetail {
    return {
        ...makeRecipe(),
        ingredients: [{ ingredientId: 'ing_1', name: 'Tomato', quantity: 6, isUserEntered: false }],
        steps: [{ stepNumber: 1, instruction: 'Simmer the tomatoes.' }],
        photos: [],
        nutrition: { calories: 120, proteinG: 4, carbsG: 20, fatG: 2, isComplete: true },
        ...overrides,
    };
}

/** Build an {@link Ingredient} (freeform or food-backed depending on overrides). */
export function makeIngredient(overrides: Partial<Ingredient> = {}): Ingredient {
    return {
        id: 'ing_1',
        name: 'Tomato',
        isUserEntered: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        ...overrides,
    };
}

/** Build a {@link Collection} (light projection — no member recipes). */
export function makeCollection(overrides: Partial<Collection> = {}): Collection {
    return {
        id: 'col_1',
        ownerId: 'usr_1',
        name: 'Weeknight dinners',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        ...overrides,
    };
}

/** Build a {@link CollectionWithRecipes} (a collection plus its embedded member recipes). */
export function makeCollectionWithRecipes(overrides: Partial<CollectionWithRecipes> = {}): CollectionWithRecipes {
    return {
        ...makeCollection(),
        recipes: [makeRecipe()],
        ...overrides,
    };
}

/** Build a {@link RecipePhoto}. */
export function makeRecipePhoto(overrides: Partial<RecipePhoto> = {}): RecipePhoto {
    return {
        id: 'pho_1',
        recipeId: 'rec_1',
        key: 'recipes/rec_1/pho_1.jpg',
        url: 'https://cdn.example.test/recipes/rec_1/pho_1.jpg',
        contentType: 'image/jpeg',
        order: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        ...overrides,
    };
}

/** Build a {@link RecipeVersion} (snapshot carries empty step/ingredient arrays for a minimal fixture). */
export function makeRecipeVersion(overrides: Partial<RecipeVersion> = {}): RecipeVersion {
    return {
        id: 'ver_1',
        recipeId: 'rec_1',
        versionNumber: 1,
        snapshot: {
            version: 1,
            title: 'Tomato Soup',
            description: 'A warming bowl.',
            steps: [],
            ingredients: [],
            servings: 4,
            prepTimeMinutes: 10,
            cookTimeMinutes: 20,
        },
        createdBy: 'usr_1',
        createdAt: '2026-01-01T00:00:00.000Z',
        ...overrides,
    };
}

/** Build a {@link RestoreVersionResponse}. */
export function makeRestoreVersionResponse(overrides: Partial<RestoreVersionResponse> = {}): RestoreVersionResponse {
    return {
        recipe: makeRecipeDetail(),
        restoredFromVersion: 2,
        currentVersion: 5,
        ...overrides,
    };
}

/** Build an {@link UploadUrlResponse} (a presigned S3 upload URL). */
export function makeUploadUrlResponse(overrides: Partial<UploadUrlResponse> = {}): UploadUrlResponse {
    return {
        uploadUrl: 'https://s3.example.test/upload?sig=abc',
        key: 'recipes/rec_1/pending/pho_new.jpg',
        expiresIn: 900,
        maxBytes: 5_242_880,
        ...overrides,
    };
}

/** Build a {@link CollectionRecipeMembership} join record. */
export function makeCollectionRecipeMembership(
    overrides: Partial<CollectionRecipeMembership> = {},
): CollectionRecipeMembership {
    return {
        collectionId: 'col_1',
        recipeId: 'rec_1',
        addedVia: 'manual',
        createdAt: '2026-01-01T00:00:00.000Z',
        ...overrides,
    };
}

/** Build a {@link PullFromSourceResponse}. */
export function makePullFromSourceResponse(overrides: Partial<PullFromSourceResponse> = {}): PullFromSourceResponse {
    return {
        collection: makeCollection(),
        addedRecipeIds: ['rec_2', 'rec_3'],
        ...overrides,
    };
}

/** Build an {@link ErasureRequestAcceptedResponse}. */
export function makeErasureAccepted(
    overrides: Partial<ErasureRequestAcceptedResponse> = {},
): ErasureRequestAcceptedResponse {
    return {
        jobId: 'job_1',
        status: 'queued',
        ...overrides,
    };
}

/** Build a {@link RecipeSearchResult} (an object-per-hit envelope). */
export function makeRecipeSearchResult(overrides: Partial<RecipeSearchResult> = {}): RecipeSearchResult {
    return {
        recipe: makeRecipe(),
        rank: 0.87,
        ...overrides,
    };
}

/** Build a {@link RecipeSearchResponse} (ranked hits + facet counts). */
export function makeRecipeSearchResponse(overrides: Partial<RecipeSearchResponse> = {}): RecipeSearchResponse {
    return {
        results: [makeRecipeSearchResult()],
        total: 1,
        page: 1,
        pageSize: 20,
        hasMore: false,
        facets: { dietaryFlags: [{ value: 'vegan', count: 1 }], tags: [{ value: 'soup', count: 1 }] },
        ...overrides,
    };
}

/** Build a generic {@link PaginatedResponse} page around the given items. */
export function makePaginatedResponse<T>(
    data: readonly T[],
    overrides: Partial<Omit<PaginatedResponse<T>, 'data'>> = {},
): PaginatedResponse<T> {
    return {
        data: [...data],
        total: data.length,
        page: 1,
        pageSize: 20,
        hasMore: false,
        ...overrides,
    };
}
