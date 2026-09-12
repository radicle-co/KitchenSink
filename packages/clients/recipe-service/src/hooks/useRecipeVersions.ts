import { useQuery } from '@tanstack/react-query';

import { recipeQueries } from '../queries.js';
import type { QueryEnableOptions } from './queryEnableOptions.js';
import { useRecipeServiceClient } from './recipeServiceProvider.js';

/** `GET /api/v1/recipes/{id}/versions` — a recipe's recent versions. */
export function useRecipeVersions(id: string, options: QueryEnableOptions = {}) {
    const client = useRecipeServiceClient();

    return useQuery({
        ...recipeQueries(client).versions(id),
        enabled: (options.enabled ?? true) && id.length > 0,
    });
}
