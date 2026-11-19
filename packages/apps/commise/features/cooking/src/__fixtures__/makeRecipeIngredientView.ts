import { ABSENT_QUANTITY, statedQuantity, type RecipeIngredientView } from '@kitchensink/recipe-core';

/**
 * One ingredient line as the cooking list receives it: one cup of flour, not typed by the cook. A test names only the
 * fields it is about, so a field added to {@link RecipeIngredientView} later changes this one place.
 *
 * @param overrides - The fields the test sets.
 * @returns A complete ingredient line. Pure.
 */
export function makeRecipeIngredientView(overrides: Partial<RecipeIngredientView> = {}): RecipeIngredientView {
    return {
        ingredientId: 'ing_flour',
        name: 'flour',
        quantity: statedQuantity(1) ?? ABSENT_QUANTITY,
        unit: 'cup',
        isUserEntered: false,
        ...overrides,
    };
}
