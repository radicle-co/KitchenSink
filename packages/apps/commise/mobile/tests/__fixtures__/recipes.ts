/**
 * Typed `make*` fixtures for the mobile recipe-screen tests. `makeRecipe`, `makeRecipeDetail`,
 * `makeRecipeVersion`, `makeCollection`, and `makeIngredient` are the shared, invariant-deriving Object
 * Mother from `@kitchensink/recipe-core/testing` (T1) — re-exported here so consuming tests keep importing
 * from this local module. Everything else (view-model fixtures, envelope wrappers, mobile-only
 * compositions) stays local to the mobile app so its tests own their doubles.
 */
import {
    makeCollection,
    makeIngredient,
    makeRecipe,
    makeRecipeDetail,
    makeRecipeVersion,
} from '@kitchensink/recipe-core/testing';
import {
    RecipeVisibility,
    type Collection,
    type PaginatedResponse,
    type Recipe,
    type RecipeIngredientView,
    type RecipeNutrition,
    type RecipeSearchResult,
    type RecipeStepView,
} from '@kitchensink/recipe-core';
import type {
    CollectionRecipeAddedVia,
    CollectionWithRecipes,
    RecipeSearchResponse,
} from '@kitchensink/recipe-service-client';

export { makeCollection, makeIngredient, makeRecipe, makeRecipeDetail, makeRecipeVersion };

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
 * Build a collection with its member recipes (the `getCollectionById` response shape, W5 Task 5's
 * `CollectionWithRecipes` — each member is required to carry its provenance; callers pass plain `Recipe`s
 * and this fixture defaults every one to `addedVia: 'manual'`, overridable per recipe by the caller).
 *
 * @param recipes - The member recipes (plain `Recipe`, or already `{ ...recipe, addedVia }`).
 * @param overrides - Collection fields to override.
 * @returns A complete `CollectionWithRecipes`.
 */
export function makeCollectionWithRecipes(
    recipes: readonly (Recipe & { readonly addedVia?: CollectionRecipeAddedVia })[] = [],
    overrides: Partial<Collection> = {},
): CollectionWithRecipes {
    return {
        ...makeCollection(overrides),
        recipes: recipes.map((recipe) => ({ addedVia: 'manual' as const, ...recipe })),
    };
}

/**
 * Wrap collections in the API's {@link PaginatedResponse} envelope with sensible pagination defaults.
 *
 * @param collections - The page's collections.
 * @param overrides - Envelope fields to override.
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
