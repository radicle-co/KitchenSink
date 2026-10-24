import { useQuery } from '@tanstack/react-query';

import type { RecipeSearchQuery } from '@kitchensink/schema-recipe';

import { recipeQueries } from '../queries.js';
import { useRecipeServiceClient } from './recipeServiceProvider.js';

/** `GET /api/v1/search/recipes` — full-text recipe search with facets. */
export function useSearchRecipes(params: RecipeSearchQuery = {}) {
    const client = useRecipeServiceClient();

    return useQuery(recipeQueries(client).search(params));
}
