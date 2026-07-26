/**
 * Headless-hook seam (U7) — the discovery browse rails' data layer. Runs ONE infinite search per curated
 * rail ({@link RECIPE_BROWSE_RAILS}: Trending/New/Quick), each pinned to a fixed sort and a small teaser
 * page ({@link RECIPE_BROWSE_RAIL_PAGE_SIZE}), over the SAME visibility-scoped `useInfiniteSearchRecipes`
 * the result list uses — so a rail never surfaces a recipe the viewer couldn't otherwise see, and the two
 * platforms share exactly one wiring instead of hand-rolling three queries each.
 *
 * The three `useInfiniteSearchRecipes` calls are unconditional (rules-of-hooks): this hook is meant to be
 * mounted ONLY while browsing (the container renders the rails block, and hence this hook's host, solely
 * when no query/filter is active), so the calls are the mount-gated cost, not an always-on one.
 *
 * Platform-agnostic: no DOM/React Native imports.
 */
import { useInfiniteSearchRecipes } from '@kitchensink/recipe-service-client/hooks';
import type { RecipeSearchResult, RecipeSearchSortBy } from '@kitchensink/recipe-core';

import {
    RECIPE_BROWSE_RAILS,
    RECIPE_BROWSE_RAIL_PAGE_SIZE,
    type RecipeBrowseRailId,
    type RecipeDiscoveryStatus,
} from '../discovery/model.js';

/** One rail's fetched state, before the container attaches its `onSeeAll` navigation. */
export interface BrowseRailQuery {
    readonly id: RecipeBrowseRailId;
    readonly sortBy: RecipeSearchSortBy;
    readonly status: RecipeDiscoveryStatus;
    readonly results: readonly RecipeSearchResult[];
}

/** The browse rails' fetched state (one entry per {@link RECIPE_BROWSE_RAILS} rail, in the same order). */
export interface UseBrowseRailsResult {
    readonly rails: readonly BrowseRailQuery[];
}

type InfiniteSearch = ReturnType<typeof useInfiniteSearchRecipes>;

/** Map a rail's infinite-search state onto the discovery view's three top-level states. */
function railStatus(search: InfiniteSearch): RecipeDiscoveryStatus {
    if (search.isLoading) {
        return 'loading';
    }

    if (search.isError) {
        return 'error';
    }

    return 'ready';
}

/** Flatten a rail's fetched pages into a single teaser result list. */
function railResults(search: InfiniteSearch): readonly RecipeSearchResult[] {
    return search.data?.pages.flatMap((page) => page.results) ?? [];
}

/**
 * Fetch the curated browse rails. Each rail is one fixed-sort, small-page search; the caller attaches the
 * `onSeeAll` handler and the selection/clone callbacks when it projects these onto `RecipeBrowseRailsProps`.
 *
 * @returns One {@link BrowseRailQuery} per curated rail, in {@link RECIPE_BROWSE_RAILS} order.
 */
export function useBrowseRails(): UseBrowseRailsResult {
    const [trending, fresh, quick] = RECIPE_BROWSE_RAILS;

    // Three explicit calls (not a `.map`) so the hook order is statically fixed — see module doc.
    const trendingSearch = useInfiniteSearchRecipes({
        sortBy: trending.sortBy,
        pageSize: RECIPE_BROWSE_RAIL_PAGE_SIZE,
    });
    const newSearch = useInfiniteSearchRecipes({ sortBy: fresh.sortBy, pageSize: RECIPE_BROWSE_RAIL_PAGE_SIZE });
    const quickSearch = useInfiniteSearchRecipes({ sortBy: quick.sortBy, pageSize: RECIPE_BROWSE_RAIL_PAGE_SIZE });

    return {
        rails: [
            {
                id: trending.id,
                sortBy: trending.sortBy,
                status: railStatus(trendingSearch),
                results: railResults(trendingSearch),
            },
            { id: fresh.id, sortBy: fresh.sortBy, status: railStatus(newSearch), results: railResults(newSearch) },
            { id: quick.id, sortBy: quick.sortBy, status: railStatus(quickSearch), results: railResults(quickSearch) },
        ],
    };
}
