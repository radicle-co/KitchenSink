import { recipeQueries, type RecipeServiceClient } from '@kitchensink/recipe-service-client';

import { RECENT_RECIPE_LIMIT } from './recentRecipeLimit.js';

/**
 * Home's recent-recipes read, stated once: the widget reads it on both platforms (web resolves a promise from it, mobile
 * suspends on it) and Home's first-run check (`useHomeCreateEntryYields`, `useHomeCreateEntryYields.ts`) finds the same cache entry by its key.
 *
 * @param client - The authenticated recipe-service client.
 * @returns The query options for one page of {@link RECENT_RECIPE_LIMIT} recent recipes. Pure.
 */
export function recentRecipesQuery(client: RecipeServiceClient) {
    return recipeQueries(client).list({ pageSize: RECENT_RECIPE_LIMIT });
}
