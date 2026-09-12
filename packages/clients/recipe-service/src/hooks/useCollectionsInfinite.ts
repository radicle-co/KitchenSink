import { useInfiniteQuery } from '@tanstack/react-query';

import { collectionQueries } from '../queries.js';
import type { ListCollectionsParams } from '../types.js';
import { useRecipeServiceClient } from './recipeServiceProvider.js';

/**
 * `GET /api/v1/collections` — the same caller's collections as `useCollections`, but PAGINATED for a
 * "Load more" flow (W5/C7): each fetched page appends to `data.pages`, and `hasNextPage`/`fetchNextPage`
 * drive the load-more control. The next page is `page + 1` while the last page reported `hasMore`; once it
 * does not, `getNextPageParam` returns `undefined` and the control disappears.
 *
 * @param params - The list params (page/pageSize). The `page` field is managed by the pager.
 */
export function useCollectionsInfinite(params: ListCollectionsParams = {}) {
    const client = useRecipeServiceClient();

    return useInfiniteQuery(collectionQueries(client).listInfinite(params));
}
