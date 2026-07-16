/**
 * Typed `make*` fixture factories for the web recipe-container tests. Each accepts `Partial<T>` overrides
 * over sensible defaults (constitution fixture convention). Kept local to the web app's tests so they
 * never depend on another package's (non-exported) fixtures.
 */
import {
    RecipeDifficulty,
    RecipeSourceType,
    RecipeVisibility,
    usesPremiumCapability,
    type PaginatedResponse,
    type Recipe,
    type RecipeDetail,
} from '@kitchensink/recipe-core';

/**
 * Build a complete {@link Recipe} with sensible defaults.
 *
 * @param overrides - Fields to override on the default recipe.
 * @returns A complete `Recipe`.
 */
export function makeRecipe(overrides: Partial<Recipe> = {}): Recipe {
    const base = {
        id: 'rec_1',
        ownerId: 'usr_1',
        title: 'Weeknight Pasta',
        description: 'A fast, comforting weeknight dinner.',
        prepTimeMinutes: 10,
        cookTimeMinutes: 20,
        totalTimeMinutes: 30,
        servings: 4,
        difficulty: RecipeDifficulty.MEDIUM,
        visibility: RecipeVisibility.PRIVATE,
        sourceType: RecipeSourceType.USER_CREATED,
        hasSubstantiveEdit: false,
        dietaryFlags: [],
        tags: [],
        hasPartialNutrition: false,
        currentVersion: 1,
        averageRating: 4.5,
        ratingCount: 12,
        coverPhotoUrl: 'https://cdn.commise.app/recipes/rec_1/cover.jpg',
        createdAt: '2026-04-01T09:00:00.000Z',
        updatedAt: '2026-04-19T09:30:00.000Z',
        ...overrides,
    };

    return {
        ...base,
        // Keep the PRO flag and the average honest: the flag is the materialized badge rule, and an
        // average exists only alongside a non-zero count (recipe-core invariants). Explicit overrides win.
        usesPremiumCapability: overrides.usesPremiumCapability ?? usesPremiumCapability(base),
        averageRating: base.ratingCount > 0 ? base.averageRating : undefined,
    };
}

/**
 * Build a complete {@link RecipeDetail} (a {@link Recipe} plus ingredients, steps, photos, nutrition).
 *
 * @param overrides - Fields to override on the default recipe detail.
 * @returns A complete `RecipeDetail`.
 */
export function makeRecipeDetail(overrides: Partial<RecipeDetail> = {}): RecipeDetail {
    return {
        ...makeRecipe(),
        ingredients: [
            {
                ingredientId: 'ing_1',
                name: 'Olive oil',
                quantity: 2,
                unit: 'tbsp',
                isUserEntered: false,
            },
        ],
        steps: [{ stepNumber: 1, instruction: 'Combine the ingredients.' }],
        photos: [],
        nutrition: { calories: 520, proteinG: 32, carbsG: 18, fatG: 34, isComplete: true },
        ...overrides,
    };
}

/**
 * Build a {@link PaginatedResponse} page of recipes.
 *
 * @param recipes - The recipes on the page.
 * @param overrides - Envelope fields to override.
 * @returns A complete paginated page.
 */
export function makeRecipesPage(
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
