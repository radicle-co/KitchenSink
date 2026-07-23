/**
 * Typed `make*` fixture factories for the web recipe-container tests. `makeRecipe`/`makeRecipeDetail` are
 * the shared, invariant-deriving Object Mother from `@kitchensink/recipe-core/testing` (T1) — re-exported
 * here so consuming tests keep importing from this local module. `makeRecipesPage` stays web-local: it is
 * a pagination-envelope helper, not a pure-domain wire-contract fixture.
 */
import { makeRecipe, makeRecipeDetail } from '@kitchensink/recipe-core/testing';
import type { PaginatedResponse, Recipe } from '@kitchensink/recipe-core';

export { makeRecipe, makeRecipeDetail };

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
