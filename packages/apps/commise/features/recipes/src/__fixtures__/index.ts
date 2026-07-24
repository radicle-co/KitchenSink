/**
 * @module @commise/features-recipes/__fixtures__ — typed `make*` factories for the recipe feature's
 * tests. `makeRecipe`/`makeRecipeDetail` are the shared, invariant-deriving Object Mother from
 * `@kitchensink/recipe-core/testing` (T1) — re-exported here so consuming tests keep importing from this
 * local module. The feature-specific factories below (card/form view-models) stay local to this package
 * so its tests never depend on a service/client package's fixtures.
 */
import { makeRecipe, makeRecipeDetail } from '@kitchensink/recipe-core/testing';
import {
    RecipeVisibility,
    type RecipeIngredientView,
    type RecipeNutrition,
    type RecipePhoto,
    type RecipeStepView,
} from '@kitchensink/recipe-core';

import { toRecipeCardModel } from '../card/model.js';
import type { RecipeFormValues } from '../form/model.js';
import type { RecipePhotoQueueItem } from '../hooks/useRecipePhotoUploadQueue.js';
import type { RecipeListItem } from '../list/model.js';

export { makeRecipe, makeRecipeDetail };

/**
 * Build a {@link RecipeListItem} card view-model with sensible defaults, overridable per field. Since the
 * list item is now the SHARED card model, this is simply the card projection of {@link makeRecipe} with the
 * overrides applied — so it inherits the same invariant-safe defaults (rated PRO recipe with a stated
 * difficulty and a cover) and its `Partial` overrides accept every card field.
 *
 * @param overrides - Fields to override on the default item.
 * @returns A complete `RecipeListItem`.
 */
export function makeRecipeListItem(overrides: Partial<RecipeListItem> = {}): RecipeListItem {
    return { ...toRecipeCardModel(makeRecipe()), ...overrides };
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
 * Build a {@link RecipePhotoQueueItem} with sensible defaults, overridable per field (w3/e4 photo grid).
 *
 * @param overrides - Fields to override on the default queue item.
 * @returns A complete `RecipePhotoQueueItem`.
 */
export function makeQueueItem(overrides: Partial<RecipePhotoQueueItem> = {}): RecipePhotoQueueItem {
    return {
        fileId: 1,
        fileName: 'dinner.png',
        status: 'queued',
        ...overrides,
    };
}

/**
 * Build an editable {@link RecipeFormValues} draft with sensible defaults, overridable per field. Mirrors
 * the shape `defaultRecipeFormValues` produces (title/times/servings/visibility plus one resolved ingredient
 * and one step), so conflict-merge and form tests exercise a submittable draft, not an empty one.
 *
 * @param overrides - Fields to override on the default draft.
 * @returns A complete `RecipeFormValues`.
 */
export function makeRecipeFormValues(overrides: Partial<RecipeFormValues> = {}): RecipeFormValues {
    return {
        title: 'Weeknight Pasta',
        description: 'A fast, comforting weeknight dinner.',
        cuisine: 'Italian',
        tags: ['dinner'],
        dietaryFlags: ['vegetarian'],
        servings: 4,
        prepTimeMinutes: 10,
        cookTimeMinutes: 20,
        visibility: RecipeVisibility.PRIVATE,
        ingredients: [{ ingredientId: 'ing_1', name: 'Olive oil', quantity: 2, unit: 'tbsp' }],
        steps: [{ instruction: 'Combine the ingredients.' }],
        ...overrides,
    };
}
