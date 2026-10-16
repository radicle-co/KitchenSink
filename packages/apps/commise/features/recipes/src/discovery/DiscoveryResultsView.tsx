'use client';

/**
 * @module @commise/features-recipes/discovery/DiscoveryResultsView — (orchestration) the results of one search, from its pages: the rails
 * or the cards, the no-result state, and one nutrition batch per fetched page. Shared by the settled read and by the
 * "previous results" kept under a failed search.
 *
 * The deferred calorie lookup (ADR-0021) is ONE REQUEST PER FETCHED PAGE: "Load more" appends, so a single batch over every
 * accumulated id would change its key on every page and drop the figures already on screen to skeletons. While the rails
 * are the body these cards are not on screen, so nothing is asked about them; and the compact card draws no figure, so a
 * batch for it would have nobody to read the promise (a rejection would go unhandled). The id list is unmemoized on
 * purpose: the lookup keys its batches on the ids' content, never on the array's identity.
 *
 * @pattern Mediator — between the pages, the criteria and the results leaf: it picks the rails or the cards and wires the
 *     no-result Trending slot
 */
import type { ScrollBind } from '@commise/ui/scroll-host';
import type { RecipeSearchResult, RecipeSearchSortBy } from '@kitchensink/recipe-core';
import type { FC } from 'react';

import type { RecipeFacets } from '../filters/model.js';
import type { RefreshNoticeControl } from '../refresh/model.js';
import { DiscoveryBrowseRails } from './DiscoveryBrowseRails.js';
import { useDiscoveryPlatform } from './DiscoveryPlatformProvider.js';
import type { DiscoveryCardActions } from './discoveryScreenModel.js';
import {
    isDiscoveryBrowsing,
    recipeIdPagesOf,
    type RecipeBrowseCuisineShortcut,
    type RecipeDiscoveryCriteria,
    type RecipeDiscoveryResultsProps,
} from './model.js';
import { noResultKindOf, tryTheseTagsOf } from './noResults.js';
import { RecipeDiscoveryResults } from './RecipeDiscoveryResults.js';

/** Props for {@link DiscoveryResultsView}: the pages of one search, and the criteria they belong to. */
export interface DiscoveryResultsViewProps extends DiscoveryCardActions {
    /** The fetched pages, in order; one calorie batch is asked per page. */
    readonly pages: readonly { readonly results: readonly RecipeSearchResult[] }[];
    /** The criteria these pages answer. */
    readonly criteria: RecipeDiscoveryCriteria;
    /** Newer criteria are pending behind these results. */
    readonly stale: boolean;
    /** The cuisine shortcuts under the rails. */
    readonly cuisines: readonly RecipeBrowseCuisineShortcut[];
    /** The settled search's facets, for the "try these" tags. */
    readonly facets: RecipeFacets;
    /** The card variant the results draw. */
    readonly cardVariant: 'grid' | 'compact';
    /** A rail's "see all". */
    readonly onSeeAll: (sortBy: RecipeSearchSortBy) => void;
    /** Clear the typed term. */
    readonly onClearSearch: () => void;
    /** Clear every filter. */
    readonly onClearFilters: () => void;
    /** Apply one suggested tag as a filter. */
    readonly onPickTag: (tag: string) => void;
    /** The notice for a failed refresh of the results on screen. */
    readonly refreshNotice?: RefreshNoticeControl;
    /** Pull-to-refresh (native leaves only). */
    readonly refresh?: RecipeDiscoveryResultsProps['refresh'];
    /** The pager. */
    readonly loadMore?: RecipeDiscoveryResultsProps['loadMore'];
    /** The screen's scroll bind, for whichever of the rails, the cards or the no-result state is the scroller. */
    readonly scrollBind?: ScrollBind;
}

/**
 * The results of one search.
 *
 * @param props - The pages, the criteria they belong to, and the intents to forward.
 * @returns The discovery results.
 */
export const DiscoveryResultsView: FC<DiscoveryResultsViewProps> = ({
    pages,
    criteria,
    stale,
    cuisines,
    facets,
    cardVariant,
    onSeeAll,
    onClearSearch,
    onClearFilters,
    onPickTag,
    refreshNotice,
    refresh,
    loadMore,
    scrollBind,
    ...actions
}) => {
    const browsing = isDiscoveryBrowsing(criteria);
    const renderNutrition = useDiscoveryPlatform().useRenderNutrition(
        browsing || cardVariant === 'compact' ? [] : recipeIdPagesOf(pages),
    );

    return (
        <RecipeDiscoveryResults
            {...actions}
            results={pages.flatMap((page) => page.results)}
            query={criteria.query}
            kind={noResultKindOf(criteria)}
            stale={stale}
            cardVariant={cardVariant}
            renderNutrition={renderNutrition}
            {...(refreshNotice === undefined ? {} : { refreshNotice })}
            {...(refresh === undefined ? {} : { refresh })}
            {...(loadMore === undefined ? {} : { loadMore })}
            {...(scrollBind === undefined ? {} : { scrollBind })}
            noResult={{
                onClearSearch,
                onClearFilters,
                tryTags: tryTheseTagsOf(facets.tags, criteria.filters.tags ?? []),
                onPickTag,
                trendingSlot: <DiscoveryBrowseRails only="trending" cuisines={[]} onSeeAll={onSeeAll} {...actions} />,
            }}
            {...(browsing
                ? {
                      browseSlot: (
                          <DiscoveryBrowseRails
                              cuisines={cuisines}
                              onSeeAll={onSeeAll}
                              {...(scrollBind === undefined ? {} : { scrollBind })}
                              {...actions}
                          />
                      ),
                  }
                : {})}
        />
    );
};
