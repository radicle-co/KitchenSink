/**
 * @module @commise/features-recipes/__fixtures__ — typed `make*` factories for the recipe feature's
 * tests. Overridable defaults (accepting `Partial<T>`) per the constitution's fixture convention, kept
 * local to this package so its tests never depend on a service/client package's fixtures.
 */
import {
    RecipeDifficulty,
    RecipeSourceType,
    RecipeStatus,
    RecipeVisibility,
    usesPremiumCapability,
    type Recipe,
    type RecipeDetail,
    type RecipeIngredientView,
    type RecipeNutrition,
    type RecipePhoto,
    type RecipeStepView,
} from '@kitchensink/recipe-core';

import { toRecipeCardModel } from '../card/model.js';
import type { RecipeFormValues } from '../form/model.js';
import type { RecipeListItem } from '../list/model.js';

/**
 * Build a full {@link Recipe} with sensible defaults, overridable per field.
 *
 * The default is a RATED, PRO recipe with a stated difficulty and a cover photo, so a card test exercises
 * every enriched field out of the box; overrides narrow to the other states (unrated, no difficulty, free
 * tier, no image). Two fields are DERIVED rather than stored as literals so the fixture can never fabricate
 * a state the domain forbids:
 *
 * - `usesPremiumCapability` is the materialized projection of the badge rule (recipe-core), so flipping
 *   `visibility`/`sourceType` yields the correct badge without restating it. An explicit override still wins.
 * - `averageRating` is present exactly when `ratingCount > 0` (the recipe-core invariant: an unrated recipe
 *   has NO average, never `0`), so `makeRecipe({ ratingCount: 0 })` drops the average instead of leaving a
 *   fake score behind.
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
        status: RecipeStatus.PUBLISHED,
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
        usesPremiumCapability: overrides.usesPremiumCapability ?? usesPremiumCapability(base),
        // Enforce the recipe-core invariant: an average exists only alongside a non-zero count.
        averageRating: base.ratingCount > 0 ? base.averageRating : undefined,
    };
}

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
