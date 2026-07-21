'use client';

/**
 * Container for the public-discovery route: binds the shared, presentational `RecipeDiscoveryList` +
 * `RecipeFilterBar` building blocks to live data. It owns NO server data — TanStack Query is the source of
 * truth for the remote search results — and it holds NO filter state of its own either: the search term and
 * the active filters live in the URL (`?query=…&dietaryFlags=…&tags=…&maxTotalTime=…`), so a filtered view is
 * shareable and survives reload/back. It derives `{ filters, query }` from the URL, projects them onto the
 * `useSearchRecipes` params via the shared pure model, and writes changes back with
 * `window.history.replaceState` — the Next-integrated history API that updates `useSearchParams()` WITHOUT a
 * server round-trip (a `router.replace` per keystroke would re-render this `force-dynamic` server page). The
 * search response's `facets` drive the filter chips; per-row clone navigates to the caller's fresh copy.
 */
import { RecipeDiscoveryList, RecipeFilterBar } from '@commise/features-recipes';
import type { FacetDimension, RecipeDiscoveryStatus } from '@commise/features-recipes';
import {
    clearRecipeFilters,
    filtersFromQueryString,
    filtersToQueryString,
    filtersToSearchParams,
    hasActiveFilters,
    setMaxTotalTime,
    toggleFacetValue,
    type RecipeFilterState,
} from '@commise/features-recipes';
import { RecipeSearchSortBy } from '@kitchensink/recipe-core';
import { useCloneRecipe, useInfiniteSearchRecipes } from '@kitchensink/recipe-service-client/hooks';
import type { Route } from 'next';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useState } from 'react';
import type { FC } from 'react';

/** Props for {@link RecipeDiscoveryContainer}. */
export interface RecipeDiscoveryContainerProps {
    /** The active route locale, used to build locale-prefixed navigation targets. */
    readonly locale: string;
}

/** Map a TanStack Query state onto the discovery view's three top-level states. */
function toDiscoveryStatus(isLoading: boolean, isError: boolean): RecipeDiscoveryStatus {
    if (isLoading) {
        return 'loading';
    }

    if (isError) {
        return 'error';
    }

    return 'ready';
}

/**
 * The live public-discovery container.
 *
 * @param props - The active locale.
 * @returns The wired {@link RecipeDiscoveryList} with its {@link RecipeFilterBar}.
 */
export const RecipeDiscoveryContainer: FC<RecipeDiscoveryContainerProps> = ({ locale }) => {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();

    // The URL is the single source of truth for the search criteria. Deriving (never copying into state) keeps
    // the view in lockstep with a shared/reloaded link and the back button.
    const { filters, query } = filtersFromQueryString(searchParams.toString());

    // Sort is a view preference (S3), kept in local state — it re-runs the visibility-scoped search with a new
    // `sortBy` but is not part of the shareable URL criteria (those are the filters + query).
    const [sortBy, setSortBy] = useState<RecipeSearchSortBy>(RecipeSearchSortBy.RELEVANCE);

    const search = useInfiniteSearchRecipes({ ...filtersToSearchParams(filters, query), sortBy });
    const clone = useCloneRecipe();

    const status = toDiscoveryStatus(search.isLoading, search.isError);
    const cloningId = clone.isPending ? clone.variables : null;

    // S4 — flatten the fetched pages into one result list; facets describe the whole set, so read them from
    // the first page. `hasNextPage`/`fetchNextPage` drive the "Load more" control.
    const results = search.data?.pages.flatMap((page) => page.results) ?? [];
    const facets = search.data?.pages[0]?.facets ?? {};

    // Write the next criteria to the URL via the Next-integrated history API (no server round-trip per
    // keystroke, unlike router.replace on this force-dynamic page). `useSearchParams()` re-renders in response.
    const applyCriteria = useCallback(
        (nextFilters: RecipeFilterState, nextQuery: string) => {
            const qs = filtersToQueryString(nextFilters, nextQuery);
            window.history.replaceState(null, '', qs.length > 0 ? `${pathname}?${qs}` : pathname);
        },
        [pathname],
    );

    return (
        <RecipeDiscoveryList
            status={status}
            results={results}
            searchValue={query}
            onSearchChange={(value) => applyCriteria(filters, value)}
            onSelectRecipe={(id) => router.push(`/${locale}/recipes/${id}` as Route)}
            onClone={(id) =>
                clone.mutate(id, {
                    onSuccess: (recipe) => router.push(`/${locale}/recipes/${recipe.id}` as Route),
                })
            }
            onRetry={() => void search.refetch()}
            cloningId={cloningId}
            hasActiveFilters={hasActiveFilters(filters)}
            sort={{ active: sortBy, onChange: setSortBy }}
            loadMore={{
                hasMore: search.hasNextPage,
                loading: search.isFetchingNextPage,
                onLoadMore: () => void search.fetchNextPage(),
            }}
            filterSlot={
                <RecipeFilterBar
                    facets={facets}
                    filters={filters}
                    onToggleFacet={(dimension: FacetDimension, value: string) =>
                        applyCriteria(toggleFacetValue(filters, dimension, value), query)
                    }
                    onSetMaxTotalTime={(minutes) => applyCriteria(setMaxTotalTime(filters, minutes), query)}
                    onClearAll={() => applyCriteria(clearRecipeFilters(), query)}
                />
            }
        />
    );
};
