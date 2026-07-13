/**
 * @module @commise/features-recipes/__fixtures__ — typed `make*` factories for the recipe feature's
 * tests. Overridable defaults (accepting `Partial<T>`) per the constitution's fixture convention, kept
 * local to this package so its tests never depend on a service/client package's fixtures.
 */
import {
    RecipeSourceType,
    RecipeVisibility,
    type Recipe,
    type RecipeDetail,
    type RecipeIngredientView,
    type RecipeNutrition,
    type RecipePhoto,
    type RecipeStepView,
} from '@kitchensink/recipe-core';

import type { RecipeListItem } from '../list/model.js';

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
 * Build a {@link RecipeListItem} view-model with sensible defaults, overridable per field.
 *
 * @param overrides - Fields to override on the default item.
 * @returns A complete `RecipeListItem`.
 */
export function makeRecipeListItem(overrides: Partial<RecipeListItem> = {}): RecipeListItem {
    return {
        id: 'rec_1',
        title: 'Weeknight Pasta',
        totalTimeMinutes: 30,
        updatedAt: '2026-04-19T09:30:00.000Z',
        ...overrides,
    };
}

/**
 * Build a {@link RecipeIngredientView} with sensible defaults, overridable per field.
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
 * Build a {@link RecipePhoto} with sensible defaults, overridable per field.
 *
 * @param overrides - Fields to override on the default photo.
 * @returns A complete `RecipePhoto`.
 */
export function makePhoto(overrides: Partial<RecipePhoto> = {}): RecipePhoto {
    return {
        id: 'pho_1',
        recipeId: 'rec_1',
        key: 'recipes/rec_1/pho_1.jpg',
        url: 'https://cdn.commise.app/recipes/rec_1/pho_1.jpg',
        contentType: 'image/jpeg',
        order: 1,
        createdAt: '2026-04-19T09:30:00.000Z',
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
