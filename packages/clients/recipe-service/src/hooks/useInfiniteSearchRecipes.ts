import { useInfiniteQuery } from '@tanstack/react-query';

import type { RecipeSearchQuery } from '@kitchensink/schema-recipe';

import { recipeQueries } from '../queries.js';
import { useRecipeServiceClient } from './recipeServiceProvider.js';

/**
 * `GET /api/v1/search/recipes` — the same ranked, faceted, visibility-scoped search as `useSearchRecipes`,
 * but PAGINATED for a "Load more" flow (W4/S4): each fetched page appends to `data.pages`, and
 * `hasNextPage`/`fetchNextPage` drive the load-more control. The next page is `page + 1` while the last page
 * reported `hasMore`; once it does not, `getNextPageParam` returns `undefined` and the control disappears.
 * Facets come from the first page (they describe the whole result set, not one page).
 *
 * @param params - The search criteria (query/filters/sort). The `page` field is managed by the pager.
 */
export function useInfiniteSearchRecipes(params: RecipeSearchQuery = {}) {
    const client = useRecipeServiceClient();

    return useInfiniteQuery(recipeQueries(client).searchInfinite(params));
}
