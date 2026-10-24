import { useQuery } from '@tanstack/react-query';

import { recipeQueries } from '../queries.js';
import type { ListRecipesParams } from '../types.js';
import { useRecipeServiceClient } from './recipeServiceProvider.js';

/** `GET /api/v1/recipes` — the caller's recipes (paginated). */
export function useRecipes(params: ListRecipesParams = {}) {
    const client = useRecipeServiceClient();

    return useQuery(recipeQueries(client).list(params));
}
