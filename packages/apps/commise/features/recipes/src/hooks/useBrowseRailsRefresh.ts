/**
 * Headless-hook seam (U7) — the curated browse rails' ONE refresh read, for the rails block's notice.
 *
 * Each rail reads through its own suspense boundary, so per-rail loading and failure are the boundaries'. What no single
 * rail can report is the BLOCK's refresh: the rails read the same endpoint and fail together, and the block says so once.
 * This hook folds the three rails into the one read shape `useRefreshNotice` takes.
 *
 * Its three observers are PASSIVE (`enabled: false`): they read what the rails' suspense reads cache and never send a
 * search of their own — but `refetch` still refreshes the rail, which is what the notice's Try again does. The three calls
 * are explicit, not a `.map`, so the hook order is statically fixed. Each key comes from `browseRailSearchParams`, the
 * one definition of a rail's search, so the observers watch exactly the entries the rails read.
 *
 * Platform-agnostic: no DOM or React Native imports.
 */
import { recipeQueries } from '@kitchensink/recipe-service-client';
import { useRecipeServiceClient } from '@kitchensink/recipe-service-client/hooks';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useCallback } from 'react';

import { RECIPE_BROWSE_RAILS, browseRailSearchParams } from '../discovery/model.js';

/**
 * The rails' refresh, as ONE read: the shape `useRefreshNotice` takes. The rails read the same endpoint, so a refresh
 * fails for all of them together, and the block reports it once.
 */
export interface BrowseRailsRefresh {
    /** Whether any rail's last refresh failed while its rows were loaded. */
    readonly isRefetchError: boolean;
    /** Whether any rail is refreshing. */
    readonly isRefetching: boolean;
    /** Refresh every rail, settling as a success only when all three succeed. */
    readonly refetch: () => Promise<{ readonly isSuccess: boolean }>;
}

/**
 * Observe the curated rails' refresh.
 *
 * @returns The rails' combined refresh state and a refetch of all three.
 */
export function useBrowseRailsRefresh(): BrowseRailsRefresh {
    const queries = recipeQueries(useRecipeServiceClient());
    const [trending, fresh, quick] = RECIPE_BROWSE_RAILS;

    const trendingRail = useInfiniteQuery({
        ...queries.searchInfinite(browseRailSearchParams(trending)),
        enabled: false,
    });
    const newRail = useInfiniteQuery({ ...queries.searchInfinite(browseRailSearchParams(fresh)), enabled: false });
    const quickRail = useInfiniteQuery({ ...queries.searchInfinite(browseRailSearchParams(quick)), enabled: false });

    const { refetch: refetchTrending } = trendingRail;
    const { refetch: refetchNew } = newRail;
    const { refetch: refetchQuick } = quickRail;
    const refetch = useCallback(async () => {
        const settled = await Promise.all([refetchTrending(), refetchNew(), refetchQuick()]);

        return { isSuccess: settled.every((result) => result.isSuccess) };
    }, [refetchTrending, refetchNew, refetchQuick]);

    return {
        isRefetchError: trendingRail.isRefetchError || newRail.isRefetchError || quickRail.isRefetchError,
        isRefetching: trendingRail.isRefetching || newRail.isRefetching || quickRail.isRefetching,
        refetch,
    };
}
