'use client';

/**
 * @module @commise/features-recipes/discovery/DiscoveryBrowseRails — (orchestration) the curated rails, each behind its OWN read boundary,
 * so one rail loads and fails without the others. Mounted only while browsing (or under a no-result state, for the one
 * rail), so the rail reads are a browse-time cost. A failed refresh of the rails on screen keeps their rows and is
 * reported once, for the block, through `useBrowseRailsRefresh`'s passive observers.
 *
 * Pull-to-refresh and the scroll bind are handed to the rails leaf unconditionally: the native leaf uses them, the web
 * leaf ignores them (its contract), so this part has no platform branch.
 *
 * @pattern Composite — three rails, each behind its own read boundary, assembled into one block
 */
import type { RecipeSearchSortBy } from '@kitchensink/recipe-core';
import { recipeQueries } from '@kitchensink/recipe-service-client';
import { useRecipeServiceClient } from '@kitchensink/recipe-service-client/hooks';
import type { FC } from 'react';

import { useBrowseRailsRefresh } from '../hooks/useBrowseRailsRefresh.js';
import { useRailRetries } from '../hooks/useRailRetries.js';
import type { ScrollBind } from '@commise/ui/scroll-host';

import { useDiscoveryPlatform } from './DiscoveryPlatformProvider.js';
import type { DiscoveryCardActions } from './discoveryScreenModel.js';
import { DiscoverySettledRail } from './DiscoverySettledRail.js';
import {
    RECIPE_BROWSE_RAILS,
    browseRailSearchParams,
    type RecipeBrowseCuisineShortcut,
    type RecipeBrowseRailId,
    type RecipeBrowseRailView,
} from './model.js';
import { RecipeBrowseRailLoadError } from './RecipeBrowseRailLoadError.js';
import { RecipeBrowseRailLoading } from './RecipeBrowseRailLoading.js';
import { RecipeBrowseRails } from './RecipeBrowseRails.js';

/** Props for {@link DiscoveryBrowseRails}. */
export interface DiscoveryBrowseRailsProps extends DiscoveryCardActions {
    /** The cuisine shortcuts under the rails. */
    readonly cuisines: readonly RecipeBrowseCuisineShortcut[];
    /** A rail's "see all": leave browse for the full list sorted by that rail. */
    readonly onSeeAll: (sortBy: RecipeSearchSortBy) => void;
    /** Draw only this rail, with no cuisine row: the Trending rail every no-result state ends in. */
    readonly only?: RecipeBrowseRailId;
    /** The screen's scroll bind, when the rails ARE the screen's scroller (browsing), never the nested Trending rail. */
    readonly scrollBind?: ScrollBind;
}

/**
 * The curated rails.
 *
 * @param props - The cuisine shortcuts, the "see all" intent, the one rail to draw (if any) and the card actions.
 * @returns The rails block.
 */
export const DiscoveryBrowseRails: FC<DiscoveryBrowseRailsProps> = ({
    cuisines,
    onSeeAll,
    only,
    scrollBind,
    ...actions
}) => {
    const { Boundary, useRefreshNotice } = useDiscoveryPlatform();
    const queries = recipeQueries(useRecipeServiceClient());
    const railsRefresh = useBrowseRailsRefresh();
    const refreshNotice = useRefreshNotice(railsRefresh);
    // How many times each rail's own Try again was pressed: the rail's heading takes focus when its count moves, because
    // the pressed button unmounts as the rail reloads.
    const { retries: railRetries, retry: retryRail } = useRailRetries();
    const rails: readonly RecipeBrowseRailView[] = RECIPE_BROWSE_RAILS.filter(
        (rail) => only === undefined || rail.id === only,
    ).map((rail) => {
        const read = queries.searchInfinite(browseRailSearchParams(rail));

        return {
            id: rail.id,
            onSeeAll: () => onSeeAll(rail.sortBy),
            headingFocusSignal: railRetries[rail.id],
            body: (
                <Boundary
                    prefetchedKeys={[read.queryKey]}
                    loading={<RecipeBrowseRailLoading />}
                    renderError={({ resetErrorBoundary }) => (
                        <RecipeBrowseRailLoadError
                            onRetry={() => {
                                retryRail(rail.id);
                                resetErrorBoundary();
                            }}
                        />
                    )}
                >
                    <DiscoverySettledRail read={read} {...actions} />
                </Boundary>
            ),
        };
    });

    return (
        <RecipeBrowseRails
            {...(scrollBind === undefined ? {} : { scrollBind })}
            rails={rails}
            cuisines={only === undefined ? cuisines : []}
            {...(only === undefined
                ? {
                      refreshNotice,
                      // A pull while browsing refreshes the rails on screen, not the main search behind them.
                      refresh: { refreshing: railsRefresh.isRefetching, onRefresh: () => void railsRefresh.refetch() },
                  }
                : {})}
        />
    );
};
