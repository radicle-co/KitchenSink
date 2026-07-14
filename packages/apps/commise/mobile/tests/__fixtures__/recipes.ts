/**
 * Typed `make*` fixtures for the mobile recipe-screen tests. Overridable defaults (accepting `Partial<T>`)
 * per the constitution's fixture convention, kept local to the mobile app so its tests own their doubles.
 * Mirrors the recipe feature package's factories but lives here to avoid reaching into another package's
 * unexported `__fixtures__`.
 */
import {
    RecipeSourceType,
    RecipeVisibility,
    type Collection,
    type Ingredient,
    type PaginatedResponse,
    type Recipe,
    type RecipeDetail,
    type RecipeIngredientView,
    type RecipeNutrition,
    type RecipeSearchResult,
    type RecipeStepView,
    type RecipeVersion,
} from '@kitchensink/recipe-core';
import type { RecipeSearchResponse } from '@kitchensink/recipe-service-client';

/**
 * Build a full {@link Recipe} with sensible defaults, overridable per field.
 *
 * @param overrides - Fields to override on the default recipe.
 * @returns A complete `Recipe`.
 */
export function makeRecipe(overrides: Partial<Recipe> = {}): Recipe {
    return {
        id: 'rec_1',
        ownerId: 'usr_1',
        title: 'Weeknight Pasta',
        description: 'A fast, comforting weeknight dinner.',
        prepTimeMinutes: 10,
        cookTimeMinutes: 20,
        totalTimeMinutes: 30,
        servings: 4,
        visibility: RecipeVisibility.PRIVATE,
        sourceType: RecipeSourceType.USER_CREATED,
        hasSubstantiveEdit: false,
        dietaryFlags: [],
        tags: [],
        hasPartialNutrition: false,
        currentVersion: 1,
        createdAt: '2026-04-01T09:00:00.000Z',
        updatedAt: '2026-04-19T09:30:00.000Z',
        ...overrides,
    };
}

/**
 * Build an {@link RecipeIngredientView} with sensible defaults, overridable per field.
 *
 * @param overrides - Fields to override on the default ingredient view.
 * @returns A complete `RecipeIngredientView`.
 */
export function makeIngredientView(overrides: Partial<RecipeIngredientView> = {}): RecipeIngredientView {
    return {
        ingredientId: 'ing_1',
        name: 'Olive oil',
        quantity: 2,
        unit: 'tbsp',
        isUserEntered: false,
        ...overrides,
    };
}

/**
 * Build a {@link RecipeStepView} with sensible defaults, overridable per field.
 *
 * @param overrides - Fields to override on the default step view.
 * @returns A complete `RecipeStepView`.
 */
export function makeStepView(overrides: Partial<RecipeStepView> = {}): RecipeStepView {
    return {
        stepNumber: 1,
        instruction: 'Combine the ingredients.',
        ...overrides,
    };
}

/**
 * Build a {@link RecipeNutrition} with sensible defaults, overridable per field.
 *
 * @param overrides - Fields to override on the default nutrition.
 * @returns A complete `RecipeNutrition`.
 */
export function makeNutrition(overrides: Partial<RecipeNutrition> = {}): RecipeNutrition {
    return {
        calories: 520,
        proteinG: 32,
        carbsG: 18,
        fatG: 34,
        isComplete: true,
        ...overrides,
    };
}

/**
 * Build a full {@link RecipeDetail} (a {@link Recipe} plus ingredients, steps, photos, nutrition) with
 * sensible defaults, overridable per field.
 *
 * @param overrides - Fields to override on the default recipe detail.
 * @returns A complete `RecipeDetail`.
 */
export function makeRecipeDetail(overrides: Partial<RecipeDetail> = {}): RecipeDetail {
    return {
        ...makeRecipe(),
        ingredients: [makeIngredientView()],
        steps: [makeStepView()],
        photos: [],
        nutrition: makeNutrition(),
        ...overrides,
    };
}

/**
 * Wrap recipes in the API's {@link PaginatedResponse} envelope with sensible pagination defaults.
 *
 * @param recipes - The page's recipes.
 * @param overrides - Pagination fields to override.
 * @returns A complete `PaginatedResponse<Recipe>`.
 */
export function makeRecipePage(
    recipes: readonly Recipe[],
    overrides: Partial<Omit<PaginatedResponse<Recipe>, 'data'>> = {},
): PaginatedResponse<Recipe> {
    return {
        data: [...recipes],
        total: recipes.length,
        page: 1,
        pageSize: 20,
        hasMore: false,
        ...overrides,
    };
}

/**
 * Build a catalog {@link Ingredient} with sensible defaults, overridable per field.
 *
 * @param overrides - Fields to override on the default ingredient.
 * @returns A complete `Ingredient`.
 */
export function makeIngredient(overrides: Partial<Ingredient> = {}): Ingredient {
    return {
        id: 'ing_1',
        name: 'Olive oil',
        isUserEntered: false,
        createdAt: '2026-04-01T09:00:00.000Z',
        ...overrides,
    };
}

/**
 * Build a {@link RecipeVersion} with sensible defaults, overridable per field. The snapshot carries only the
 * required scalars (the version-history view reads the version number, timestamp, and summary, not the
 * snapshot body), so its `steps`/`ingredients` default to empty.
 *
 * @param overrides - Fields to override on the default version.
 * @returns A complete `RecipeVersion`.
 */
export function makeRecipeVersion(overrides: Partial<RecipeVersion> = {}): RecipeVersion {
    return {
        id: 'ver_1',
        recipeId: 'rec_1',
        versionNumber: 1,
        snapshot: {
            version: 1,
            title: 'Weeknight Pasta',
            description: '',
            steps: [],
            ingredients: [],
            servings: 4,
            prepTimeMinutes: 10,
            cookTimeMinutes: 20,
        },
        createdBy: 'usr_1',
        createdAt: '2026-04-01T09:00:00.000Z',
        ...overrides,
    };
}

/**
 * Build a {@link Collection} with sensible defaults, overridable per field.
 *
 * @param overrides - Fields to override on the default collection.
 * @returns A complete `Collection`.
 */
export function makeCollection(overrides: Partial<Collection> = {}): Collection {
    return {
        id: 'col_1',
        ownerId: 'usr_1',
        name: 'Weeknight favourites',
        createdAt: '2026-04-01T09:00:00.000Z',
        updatedAt: '2026-04-19T09:30:00.000Z',
        ...overrides,
    };
}

/**
 * Build a collection with its member recipes (the `getCollectionById` response shape).
 *
 * @param recipes - The member recipes.
 * @param overrides - Collection fields to override.
 * @returns A `Collection` with a `recipes` member list.
 */
export function makeCollectionWithRecipes(
    recipes: readonly Recipe[] = [],
    overrides: Partial<Collection> = {},
): Collection & { readonly recipes: readonly Recipe[] } {
    return {
        ...makeCollection(overrides),
        recipes: [...recipes],
    };
}

/**
 * Wrap collections in the API's {@link PaginatedResponse} envelope with sensible pagination defaults.
 *
 * @param collections - The page's collections.
 * @param overrides - Pagination fields to override.
 * @returns A complete `PaginatedResponse<Collection>`.
 */
export function makeCollectionPage(
    collections: readonly Collection[],
    overrides: Partial<Omit<PaginatedResponse<Collection>, 'data'>> = {},
): PaginatedResponse<Collection> {
    return {
        data: [...collections],
        total: collections.length,
        page: 1,
        pageSize: 20,
        hasMore: false,
        ...overrides,
    };
}

/**
 * Build a {@link RecipeSearchResult} envelope around a recipe, overridable per field.
 *
 * @param overrides - Recipe fields to override on the wrapped recipe.
 * @returns A complete `RecipeSearchResult`.
 */
export function makeRecipeSearchResult(overrides: Partial<Recipe> = {}): RecipeSearchResult {
    return {
        recipe: makeRecipe({ visibility: RecipeVisibility.PUBLIC, ...overrides }),
    };
}

/**
 * Wrap search results in the `searchRecipes` response envelope with sensible defaults.
 *
 * @param results - The search-result hits.
 * @param overrides - Envelope fields to override.
 * @returns A complete `RecipeSearchResponse`.
 */
export function makeSearchResponse(
    results: readonly RecipeSearchResult[] = [],
    overrides: Partial<Omit<RecipeSearchResponse, 'results'>> = {},
): RecipeSearchResponse {
    return {
        results: [...results],
        total: results.length,
        page: 1,
        pageSize: 20,
        hasMore: false,
        facets: {},
        ...overrides,
    };
}
