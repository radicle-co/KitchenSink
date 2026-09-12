import { useQuery } from '@tanstack/react-query';

import { recipeQueries } from '../queries.js';
import type { QueryEnableOptions } from './queryEnableOptions.js';
import { useRecipeServiceClient } from './recipeServiceProvider.js';

/** `GET /api/v1/recipes/{id}/versions/{versionNumber}` — a specific version snapshot. */
export function useRecipeVersion(id: string, versionNumber: number, options: QueryEnableOptions = {}) {
    const client = useRecipeServiceClient();

    return useQuery({
        ...recipeQueries(client).version(id, versionNumber),
        enabled: (options.enabled ?? true) && id.length > 0,
    });
}
