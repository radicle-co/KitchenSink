'use client';

/**
 * Container for the public-discovery route (orchestration): the shared discovery FRAME around a suspense read of the
 * search, with the curated rails as the body while the viewer is browsing.
 *
 * The frame (heading, source switcher, search field, filter bar, back-to-browse, sort) sits outside the read boundary,
 * so a pending or failed search swaps only the results. `Suspense` renders `RecipeDiscoveryLoading`, the error boundary
 * renders `RecipeDiscoveryLoadError`, and once settled the RESULTS render the rails or the counted grid. TanStack Query is
 * the source of truth for the results; the search term and filters live in the URL (`?query=…&tags=…`), so a filtered
 * view is shareable and survives reload, and are written back with `window.history.replaceState`, which updates
 * `useSearchParams()` without a server round-trip.
 *
 * Three behaviours meet at the criteria:
 * - **Debounced search.** The field echoes every keystroke; the term that SEARCHES waits for
 *   {@link DISCOVERY_SEARCH_DEBOUNCE_MS} of quiet, so typing does not send a request per keystroke.
 * - **Deferred results.** The criteria are deferred (`useDeferredDiscoveryCriteria`), so a new term, filter or sort keeps
 *   the previous results on screen — marked busy, still naming their own query — until the new ones settle, instead of
 *   the skeleton. The boundary resets when the settled criteria change, so a failed search clears once the viewer
 *   changes what they asked for.
 * - **Browsable default.** With nothing searched, the body is the curated rails (Trending/New/Quick + cuisine
 *   shortcuts); a rail's "see all" leaves for the full sorted list, and back-to-browse returns.
 *
 * The frame follows what the viewer asked for NOW (sort appears on the keystroke that starts a search); the results
 * follow what has settled. The filter bar's facets come from a PASSIVE observer of the settled search (`enabled: false`
 * — it reads the cache the suspense read fills and never fetches), so they keep their last settled values while a newer
 * search is pending, and the same observer supplies the count the frame announces.
 *
 * `/discover` is server-prefetched with the URL's criteria, so the boundary is `ClientQueryBoundary` with that key. A
 * retry from the results' refresh notice that succeeds moves focus to the frame's heading, across the boundary, as a
 * `useRecoverySignal` counter.
 *
 * @pattern Layout slot — the persistent frame around a Suspense read boundary, with the criteria, the recent searches
 *     and the recovery counter lifted to the frame's side
 */
import {
    DISCOVERY_SEARCH_DEBOUNCE_MS,
    RECIPE_BROWSE_RAILS,
    RecipeBrowseRailLoadError,
    RecipeBrowseRailLoading,
    RecipeBrowseRailResults,
    RecipeBrowseRails,
    RecipeDiscoveryFrame,
    RecipeDiscoveryLoadError,
    RecipeDiscoveryLoading,
    RecipeDiscoveryResults,
    RecipeFilterBar,
    applyFilterAction,
    browseRailSearchParams,
    discoverySearchParams,
    filtersFromQueryString,
    filtersToQueryString,
    isDiscoveryBrowsing,
    isDiscoverySearching,
    recipeIdPagesOf,
    type RecipeBrowseCuisineShortcut,
    type RecipeBrowseRailId,
    type RecipeBrowseRailView,
    type RecipeDiscoveryResultsSummary,
    type RecipeFacets,
    type RecipeFilterState,
} from '@commise/features-recipes';
import {
    useBrowseRailsRefresh,
    useDebouncedValue,
    useDeferredDiscoveryCriteria,
    useIngredientFilterSearch,
    useRecentSearches,
} from '@commise/features-recipes/hooks';
import { useRecoverySignal } from '@commise/query/recovery-signal';
import { useRefreshNotice } from '@commise/query/refresh-notice';
import { RecipeSearchSortBy } from '@kitchensink/recipe-core';
import { recipeQueries } from '@kitchensink/recipe-service-client';
import { useCloneRecipe, useRecipeServiceClient } from '@kitchensink/recipe-service-client/hooks';
import { useInfiniteQuery, useSuspenseInfiniteQuery } from '@tanstack/react-query';
import type { Route } from 'next';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useState } from 'react';
import type { FC, ReactNode } from 'react';

import { ClientQueryBoundary } from '@/components/app/ClientQueryBoundary';
import { useHydratedNutrition } from '@/hooks/useHydratedNutrition';
import { webRecentSearchStore } from '@/lib/recentSearchStore';

import { recipeSourceHrefs } from './sourceTabHref';

/** Props for {@link RecipeDiscoveryContainer}. */
export interface RecipeDiscoveryContainerProps {
    /** The active route locale, used to build locale-prefixed navigation targets. */
    readonly locale: string;
}

/** The discovery search the page prefetches and the results render. */
type RecipeSearchRead = ReturnType<ReturnType<typeof recipeQueries>['searchInfinite']>;

/** The selection and clone callbacks every card on the surface shares. */
interface DiscoveryCardActions {
    readonly cloningId: string | null;
    readonly onSelectRecipe: (id: string) => void;
    readonly onClone: (id: string) => void;
}

/** Props for {@link SettledRail}. */
interface SettledRailProps extends DiscoveryCardActions {
    readonly read: RecipeSearchRead;
}

/** One rail's settled read: its cards, with one nutrition batch per fetched page. */
const SettledRail: FC<SettledRailProps> = ({ read, ...actions }) => {
    const rail = useSuspenseInfiniteQuery(read);
    const renderNutrition = useHydratedNutrition(recipeIdPagesOf(rail.data.pages));

    return (
        <RecipeBrowseRailResults
            {...actions}
            results={rail.data.pages.flatMap((page) => page.results)}
            renderNutrition={renderNutrition}
        />
    );
};

/** No rail has been retried yet. */
const NO_RAIL_RETRIES: Readonly<Record<RecipeBrowseRailId, number>> = { trending: 0, new: 0, quick: 0 };

/** Props for {@link BrowseRailsSection}. */
interface BrowseRailsSectionProps extends DiscoveryCardActions {
    readonly cuisines: readonly RecipeBrowseCuisineShortcut[];
    readonly onSeeAll: (sortBy: RecipeSearchSortBy) => void;
}

/**
 * The curated rails, each behind its OWN read boundary, so one rail loads and fails without the others. Mounted only
 * while browsing, so the three rail reads are a browse-time cost. A failed refresh of the rails on screen keeps their
 * rows and is reported once, for the block, through `useBrowseRailsRefresh`'s passive observers.
 */
const BrowseRailsSection: FC<BrowseRailsSectionProps> = ({ cuisines, onSeeAll, ...actions }) => {
    const queries = recipeQueries(useRecipeServiceClient());
    const refreshNotice = useRefreshNotice(useBrowseRailsRefresh());
    // How many times each rail's own Try again was pressed: the rail's heading takes focus when its count moves, because
    // the pressed button unmounts as the rail reloads.
    const [railRetries, setRailRetries] = useState<Readonly<Record<RecipeBrowseRailId, number>>>(NO_RAIL_RETRIES);
    const rails: readonly RecipeBrowseRailView[] = RECIPE_BROWSE_RAILS.map((rail) => {
        const read = queries.searchInfinite(browseRailSearchParams(rail));

        return {
            id: rail.id,
            onSeeAll: () => onSeeAll(rail.sortBy),
            headingFocusSignal: railRetries[rail.id],
            body: (
                <ClientQueryBoundary
                    prefetchedKeys={[read.queryKey]}
                    loading={<RecipeBrowseRailLoading />}
                    renderError={({ resetErrorBoundary }) => (
                        <RecipeBrowseRailLoadError
                            onRetry={() => {
                                setRailRetries((current) => ({ ...current, [rail.id]: current[rail.id] + 1 }));
                                resetErrorBoundary();
                            }}
                        />
                    )}
                >
                    <SettledRail read={read} {...actions} />
                </ClientQueryBoundary>
            ),
        };
    });

    return <RecipeBrowseRails rails={rails} cuisines={cuisines} refreshNotice={refreshNotice} />;
};

/** Props for {@link SettledDiscoveryResults}. */
interface SettledDiscoveryResultsProps extends DiscoveryCardActions {
    readonly read: RecipeSearchRead;
    readonly query: string;
    readonly searching: boolean;
    readonly stale: boolean;
    readonly browseSlot?: ReactNode;
    readonly onRecovered: () => void;
}

/**
 * The results of a settled search: the suspense read, its refresh notice, and one nutrition batch per fetched page.
 */
const SettledDiscoveryResults: FC<SettledDiscoveryResultsProps> = ({ read, onRecovered, ...results }) => {
    const search = useSuspenseInfiniteQuery(read);
    // A failed refresh of the results on screen is the notice's; a failed NEXT page is the load-more control's.
    const refreshNotice = useRefreshNotice(search, { onRecovered });
    // The deferred calorie lookup (ADR-0021), ONE REQUEST PER FETCHED PAGE: "Load more" appends, so a single batch over
    // every accumulated id would change its key on every page and drop the figures already on screen to skeletons.
    // While the rails are the body these cards are not on screen, so nothing is asked about them.
    // Unmemoized on purpose: the lookup keys its batches on the ids' content, never on this array's identity.
    const renderNutrition = useHydratedNutrition(
        results.browseSlot === undefined ? recipeIdPagesOf(search.data.pages) : [],
    );

    return (
        <RecipeDiscoveryResults
            {...results}
            results={search.data.pages.flatMap((page) => page.results)}
            renderNutrition={renderNutrition}
            refreshNotice={refreshNotice}
            loadMore={{
                hasMore: search.hasNextPage,
                loading: search.isFetchingNextPage,
                failed: search.isFetchNextPageError,
                onLoadMore: () => void search.fetchNextPage(),
            }}
        />
    );
};

/**
 * The live public-discovery container.
 *
 * @param props - The active locale.
 * @returns The discovery frame around the search's read boundary.
 */
export const RecipeDiscoveryContainer: FC<RecipeDiscoveryContainerProps> = ({ locale }) => {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();

    // The URL is the single source of truth for the shareable criteria (filters + query). The FIELD is driven by
    // immediate local state so a keystroke never waits on the debounce or a re-render.
    const { filters, query } = filtersFromQueryString(searchParams.toString());
    const [searchInput, setSearchInput] = useState(query);
    const debouncedQuery = useDebouncedValue(searchInput, DISCOVERY_SEARCH_DEBOUNCE_MS);

    // Sort is a view preference (S3), kept in local state; a rail's "see all" sets it AND dismisses browse.
    const [sortBy, setSortBy] = useState<RecipeSearchSortBy>(RecipeSearchSortBy.RELEVANCE);
    const [browseDismissed, setBrowseDismissed] = useState(false);
    const { settled, stale } = useDeferredDiscoveryCriteria({
        filters,
        query: debouncedQuery,
        sortBy,
        browseDismissed,
    });

    const client = useRecipeServiceClient();
    const read = recipeQueries(client).searchInfinite(discoverySearchParams(settled));
    // PASSIVE: reads what the suspense read below caches for the settled criteria, and never fetches on its own.
    const settledSearch = useInfiniteQuery({ ...read, enabled: false });
    const clone = useCloneRecipe();
    const ingredientSearch = useIngredientFilterSearch();
    const recovery = useRecoverySignal();

    // Recent searches (U7) are keyed off the DEBOUNCED term — the one that searches — so history records searches the
    // viewer ran, never keystrokes. Persisted in `localStorage` through the injected port.
    const recentSearches = useRecentSearches(debouncedQuery, webRecentSearchStore);

    const cloningId = clone.isPending ? clone.variables : null;
    // Annotated with the NARROW view-model: the `?? {}` fallback (nothing settled yet) would otherwise widen it to `{}`.
    const facets: RecipeFacets = settledSearch.data?.pages[0]?.facets ?? {};

    const searchingNow = isDiscoverySearching({ filters, query: searchInput });
    const browsing = isDiscoveryBrowsing(settled);
    const searching = isDiscoverySearching(settled);
    // The announced sentence describes results on screen, so nothing is announced while the rails are the body.
    const resultsSummary: RecipeDiscoveryResultsSummary | undefined =
        settledSearch.data === undefined || browsing
            ? undefined
            : {
                  count: settledSearch.data.pages.reduce((total, page) => total + page.results.length, 0),
                  query: settled.query,
                  searching,
              };

    // Write the next criteria to the URL via the Next-integrated history API (no server round-trip per keystroke).
    const applyCriteria = useCallback(
        (nextFilters: RecipeFilterState, nextQuery: string) => {
            const qs = filtersToQueryString(nextFilters, nextQuery);
            window.history.replaceState(null, '', qs.length > 0 ? `${pathname}?${qs}` : pathname);
        },
        [pathname],
    );

    // Not memoized: `filters` is re-parsed from the URL on every render, so a `useCallback` keyed on it would rebuild
    // every render anyway.
    const onSearchChange = (value: string): void => {
        setSearchInput(value);
        applyCriteria(filters, value);
    };

    const onSelectRecipe = (id: string): void => router.push(`/${locale}/recipes/${id}` as Route);
    const onClone = (id: string): void =>
        clone.mutate(id, { onSuccess: (recipe) => router.push(`/${locale}/recipes/${recipe.id}` as Route) });

    const cuisines: readonly RecipeBrowseCuisineShortcut[] = (facets.cuisine ?? []).map((facet) => ({
        value: facet.value,
        onSelect: () =>
            applyCriteria(applyFilterAction(filters, { kind: 'setCuisine', cuisine: facet.value }), searchInput),
    }));

    return (
        <RecipeDiscoveryFrame
            searchValue={searchInput}
            onSearchChange={onSearchChange}
            searching={searchingNow}
            headingFocusSignal={recovery.signal}
            resultsSummary={resultsSummary}
            // L5: this surface IS the "Community" source, so it mounts the SAME switcher the library does.
            tab={{ active: 'community', href: recipeSourceHrefs(locale) }}
            recentSearches={{
                queries: recentSearches.queries,
                // Selecting one is exactly a search change: the field echoes it, the URL is updated, and the debounce
                // feeds it to the search — no second code path.
                onSelect: onSearchChange,
                onClear: recentSearches.clear,
            }}
            filterSlot={
                <RecipeFilterBar
                    facets={facets}
                    filters={filters}
                    ingredientSearch={{
                        query: ingredientSearch.query,
                        onQueryChange: ingredientSearch.setQuery,
                        viewState: ingredientSearch.viewState,
                    }}
                    onFilterAction={(action) => applyCriteria(applyFilterAction(filters, action), searchInput)}
                />
            }
            sort={!browseDismissed && !searchingNow ? undefined : { active: sortBy, onChange: setSortBy }}
            onExitToBrowse={browseDismissed && !searchingNow ? () => setBrowseDismissed(false) : undefined}
        >
            <ClientQueryBoundary
                prefetchedKeys={[read.queryKey]}
                resetKeys={[settled]}
                loading={<RecipeDiscoveryLoading />}
                renderError={({ resetErrorBoundary }) => <RecipeDiscoveryLoadError onRetry={resetErrorBoundary} />}
            >
                <SettledDiscoveryResults
                    read={read}
                    query={settled.query}
                    searching={searching}
                    stale={stale}
                    cloningId={cloningId}
                    onSelectRecipe={onSelectRecipe}
                    onClone={onClone}
                    onRecovered={recovery.onRecovered}
                    browseSlot={
                        browsing ? (
                            <BrowseRailsSection
                                cuisines={cuisines}
                                cloningId={cloningId}
                                onSelectRecipe={onSelectRecipe}
                                onClone={onClone}
                                onSeeAll={(railSort) => {
                                    setSortBy(railSort);
                                    setBrowseDismissed(true);
                                }}
                            />
                        ) : undefined
                    }
                />
            </ClientQueryBoundary>
        </RecipeDiscoveryFrame>
    );
};
