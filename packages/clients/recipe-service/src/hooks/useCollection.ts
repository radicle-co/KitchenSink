import { useQuery } from '@tanstack/react-query';

import { collectionQueries } from '../queries.js';
import type { QueryEnableOptions } from './queryEnableOptions.js';
import { useRecipeServiceClient } from './recipeServiceProvider.js';

/** `GET /api/v1/collections/{id}` — a collection with its member recipes. */
export function useCollection(id: string, options: QueryEnableOptions = {}) {
    const client = useRecipeServiceClient();

    return useQuery({
        ...collectionQueries(client).detail(id),
        enabled: (options.enabled ?? true) && id.length > 0,
    });
}
