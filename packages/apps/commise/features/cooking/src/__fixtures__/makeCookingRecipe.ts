import { RecipeStatus } from '@kitchensink/recipe-core';

import type { CookingRecipe } from '../cookingViewProps.js';

/**
 * A recipe as the cooking screen holds it: published, one short step, no ingredients, four servings. A test names only
 * the fields it is about, so a field added to {@link CookingRecipe} later changes this one place.
 *
 * @param overrides - The fields the test sets.
 * @returns A complete cooking recipe. Pure.
 */
export function makeCookingRecipe(overrides: Partial<CookingRecipe> = {}): CookingRecipe {
    return {
        id: 'r1',
        title: 'Soup',
        status: RecipeStatus.PUBLISHED,
        steps: [{ stepNumber: 1, instruction: 'Simmer the soup.' }],
        ingredients: [],
        servings: 4,
        ...overrides,
    };
}
