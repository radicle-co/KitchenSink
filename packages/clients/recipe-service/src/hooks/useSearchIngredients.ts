import { useQuery } from '@tanstack/react-query';

import { ingredientQueries } from '../queries.js';
import type { QueryEnableOptions } from './queryEnableOptions.js';
import { useRecipeServiceClient } from './recipeServiceProvider.js';

/** `GET /api/v1/ingredients/search` — ingredient typeahead (disabled for an empty query). */
export function useSearchIngredients(query: string, limit?: number, options: QueryEnableOptions = {}) {
    const client = useRecipeServiceClient();

    return useQuery({
        ...ingredientQueries(client).search(query, limit),
        enabled: (options.enabled ?? true) && query.length > 0,
    });
}
