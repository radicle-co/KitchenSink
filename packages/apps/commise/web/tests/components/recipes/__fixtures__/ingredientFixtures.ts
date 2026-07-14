/**
 * Typed `make*` fixture factory for catalog {@link Ingredient} records, used by the ingredient-picker and
 * recipe create/edit container tests. Accepts `Partial<Ingredient>` overrides over sensible defaults
 * (constitution fixture convention). Kept local to the web app's tests so they never depend on another
 * package's (non-exported) fixtures.
 */
import { FoodResolutionStatus, type Ingredient } from '@kitchensink/recipe-core';

/**
 * Build a complete catalog {@link Ingredient} with sensible defaults (a resolved, food-backed item).
 *
 * @param overrides - Fields to override on the default ingredient.
 * @returns A complete `Ingredient`.
 */
export function makeIngredient(overrides: Partial<Ingredient> = {}): Ingredient {
    return {
        id: 'ing_1',
        name: 'Olive oil',
        foodId: 'food_1',
        foodResolutionStatus: FoodResolutionStatus.RESOLVED,
        isUserEntered: false,
        createdAt: '2026-04-01T09:00:00.000Z',
        ...overrides,
    };
}
