/**
 * @module @commise/features-recipes/hooks — the results a failed discovery search keeps on screen. One hook for the web
 * container and the mobile screen, so the two cannot disagree about what a failed search leaves behind.
 *
 * @pattern Memento — the last settled search, read back from the query cache rather than held in component state
 */
import { RecipeSearchSortBy } from '@kitchensink/recipe-core';
import { recipeQueries, type RecipeServiceClient } from '@kitchensink/recipe-service-client';
import { useInfiniteQuery } from '@tanstack/react-query';

import { discoverySearchParams, type RecipeDiscoveryCriteria } from '../discovery/model.js';

/** The criteria read while nothing has settled; its answer is discarded, so only the query key's shape matters. */
const NOTHING_SETTLED: RecipeDiscoveryCriteria = {
    filters: {},
    query: '',
    sortBy: RecipeSearchSortBy.RELEVANCE,
    browseDismissed: false,
};

/**
 * The previous results kept under a failed search: the last criteria whose read settled, read PASSIVELY (`enabled: false`)
 * from the cache — it never fetches, so a failed search cannot trigger a second request.
 *
 * @param client - The recipe-service client.
 * @param criteria - The last criteria that settled, if any.
 * @returns The pages that were on screen, or `undefined` on a first load.
 */
export function usePreviousPages(client: RecipeServiceClient, criteria: RecipeDiscoveryCriteria | undefined) {
    const read = recipeQueries(client).searchInfinite(discoverySearchParams(criteria ?? NOTHING_SETTLED));
    const previous = useInfiniteQuery({ ...read, enabled: false });

    return criteria === undefined ? undefined : previous.data?.pages;
}
