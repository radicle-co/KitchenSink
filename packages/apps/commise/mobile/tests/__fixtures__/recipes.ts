/**
 * Typed `make*` fixtures for the mobile recipe-screen tests. Overridable defaults (accepting `Partial<T>`)
 * per the constitution's fixture convention, kept local to the mobile app so its tests own their doubles.
 * Mirrors the recipe feature package's factories but lives here to avoid reaching into another package's
 * unexported `__fixtures__`.
 */
import {
    RecipeSourceType,
    RecipeVisibility,
    type PaginatedResponse,
    type Recipe,
    type RecipeDetail,
    type RecipeIngredientView,
    type RecipeNutrition,
    type RecipeStepView,
} from '@kitchensink/recipe-core';

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
