import { useQuery } from '@tanstack/react-query';

import { collectionQueries } from '../queries.js';
import type { ListCollectionsParams } from '../types.js';
import { useRecipeServiceClient } from './recipeServiceProvider.js';

/** `GET /api/v1/collections` — the caller's collections (paginated). */
export function useCollections(params: ListCollectionsParams = {}) {
    const client = useRecipeServiceClient();

    return useQuery(collectionQueries(client).list(params));
}
