/**
 * @module @commise/features-recipes/__fixtures__ — typed `make*` factories for the recipe feature's
 * tests. Overridable defaults (accepting `Partial<T>`) per the constitution's fixture convention, kept
 * local to this package so its tests never depend on a service/client package's fixtures.
 */
import { RecipeSourceType, RecipeVisibility, type Recipe } from '@kitchensink/recipe-core';

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
