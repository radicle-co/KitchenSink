'use client';

/**
 * Container for the public-discovery route (orchestration): the shared discovery FRAME around a suspense read of the
 * search, with the curated rails as the body while the viewer is browsing (`docs/design/uiOverhaul/buildSpec.md` §4.4–§4.6).
 *
 * The frame (heading, search field, filters, back-to-browse, sort, the count line) sits outside the read boundary, so a
 * pending or failed search swaps only the results. `Suspense` renders `RecipeDiscoveryLoading`, the error boundary
 * renders `RecipeDiscoveryLoadError` — over the PREVIOUS results, which stay — and once settled the RESULTS render the
 * rails or the counted grid. TanStack Query is the source of truth for the results; the search term and filters live in
 * the URL (`?query=…&tags=…`), so a filtered view is shareable and survives reload, and are written back with
 * `window.history.replaceState`, which updates `useSearchParams()` without a server round-trip.
 *
 * Three behaviours meet at the criteria:
 * - **Debounced search.** The field echoes every keystroke; the term that SEARCHES waits for
 *   {@link DISCOVERY_SEARCH_DEBOUNCE_MS} of quiet, so typing does not send a request per keystroke.
 * - **Deferred results.** The criteria are deferred (`useDeferredDiscoveryCriteria`), so a new term, filter or sort keeps
 *   the previous results on screen — marked busy, still naming their own query — until the new ones settle, instead of
 *   the skeleton. The boundary resets when the settled criteria change, so a failed search clears once the viewer
 *   changes what they asked for.
 * - **Browsable default.** With nothing searched, the body is the curated rails (Trending/New/Quick + cuisine
 *   shortcuts, once three cuisines hold three recipes each); a rail's "see all" leaves for the full sorted list, and
 *   back-to-browse returns.
 *
 * The facets live in ONE place (`useFilterPresentation`): a sticky panel beside the results at a 960 container, otherwise
 * the Filters button, the applied-filter chips and the sheet. Their groups come from a PASSIVE observer of the settled
 * search (`enabled: false` — it reads the cache the suspense read fills and never fetches), so they keep their last settled
 * values while a newer search is pending, and the same observer supplies the count the frame announces and the sheet's
 * "Show {n} recipes".
 *
 * Save a copy is `useSaveCopy`: each card derives its control from the clone mutation, the snackbar's Edit opens the copy.
 *
 * `/discover` is server-prefetched with the URL's criteria, so the boundary is `ClientQueryBoundary` with that key. A
 * retry from the results' refresh notice that succeeds moves focus to the frame's heading, across the boundary, as a
 * `useRecoverySignal` counter.
 *
 * @pattern Layout slot — the persistent frame around a Suspense read boundary, with the criteria, the recent searches
 *     and the recovery counter lifted to the frame's side
 */
import {
    AppliedFilters,
    DISCOVERY_SEARCH_DEBOUNCE_MS,
    FilterPanel,
    FilterSheet,
    FilterTrigger,
    RECIPE_BROWSE_RAILS,
    RecipeBrowseRailLoadError,
    RecipeBrowseRailLoading,
    RecipeBrowseRailResults,
    RecipeBrowseRails,
    RecipeDiscoveryFrame,
    RecipeDiscoveryLoadError,
    RecipeDiscoveryLoading,
    RecipeDiscoveryResults,
    applyFilterAction,
    browseRailSearchParams,
    cardVariantOf,
    discoverySearchParams,
    filterBarViewOf,
    filterMessages,
    filtersFromQueryString,
    filtersToQueryString,
    isDiscoveryBrowsing,
    isDiscoverySearching,
    noResultKindOf,
    recipeIdPagesOf,
    showsCuisineShortcuts,
    tryTheseTagsOf,
    useFilterPresentation,
    useMainContainerClass,
    type DiscoveryFilterSlots,
    type RecipeBrowseCuisineShortcut,
    type RecipeBrowseRailId,
    type RecipeBrowseRailView,
    type RecipeDiscoveryCriteria,
    type RecipeDiscoveryResultsSummary,
    type RecipeFacets,
} from '@commise/features-recipes';
import {
    useBrowseRailsRefresh,
    useDebouncedValue,
    useDeferredDiscoveryCriteria,
    useIngredientFilterSearch,
    useLastDefined,
    useRecentSearches,
    useSaveCopy,
    type SaveCopy,
} from '@commise/features-recipes/hooks';
import { useMessages } from '@commise/i18n/react';
import { useRecoverySignal } from '@commise/query/recovery-signal';
import { useRefreshNotice } from '@commise/query/refresh-notice';
import { RecipeSearchSortBy, type RecipeSearchResult } from '@kitchensink/recipe-core';
import { recipeQueries, type RecipeServiceClient } from '@kitchensink/recipe-service-client';
import { useRecipeServiceClient } from '@kitchensink/recipe-service-client/hooks';
import { useInfiniteQuery, useSuspenseInfiniteQuery } from '@tanstack/react-query';
import type { Route } from 'next';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useState } from 'react';
import type { FC, ReactNode } from 'react';

import { ClientQueryBoundary } from '@/components/app/ClientQueryBoundary';
import { useHydratedNutrition } from '@/hooks/useHydratedNutrition';
import { webRecentSearchStore } from '@/lib/recentSearchStore';

/** Props for {@link RecipeDiscoveryContainer}. */
export interface RecipeDiscoveryContainerProps {
    /** The active route locale, used to build locale-prefixed navigation targets. */
    readonly locale: string;
    /**
     * The large title's avatar (slice 3): the page hands in the app's `ProfileAvatarEntry`, so the profile read stays
     * where data enters the chrome and this container does not depend on the auth session.
     */
    readonly avatar?: ReactNode;
}

/** The discovery search the page prefetches and the results render. */
type RecipeSearchRead = ReturnType<ReturnType<typeof recipeQueries>['searchInfinite']>;

/** What every card on the surface shares: its Save a copy control, where it leads, and how it is opened. */
interface DiscoveryCardActions {
    readonly saveCopy: SaveCopy;
    readonly hrefOf: (recipeId: string) => string;
    readonly onSelectRecipe: (id: string) => void;
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
    /** Draw only this rail, with no cuisine row: the Trending rail every no-result state ends in. */
    readonly only?: RecipeBrowseRailId;
}

/**
 * The curated rails, each behind its OWN read boundary, so one rail loads and fails without the others. Mounted only
 * while browsing (or under a no-result state, for the one rail), so the rail reads are a browse-time cost. A failed refresh
 * of the rails on screen keeps their rows and is reported once, for the block, through `useBrowseRailsRefresh`'s passive
 * observers.
 */
const BrowseRailsSection: FC<BrowseRailsSectionProps> = ({ cuisines, onSeeAll, only, ...actions }) => {
    const queries = recipeQueries(useRecipeServiceClient());
    const refreshNotice = useRefreshNotice(useBrowseRailsRefresh());
    // How many times each rail's own Try again was pressed: the rail's heading takes focus when its count moves, because
    // the pressed button unmounts as the rail reloads.
    const [railRetries, setRailRetries] = useState<Readonly<Record<RecipeBrowseRailId, number>>>(NO_RAIL_RETRIES);
    const rails: readonly RecipeBrowseRailView[] = RECIPE_BROWSE_RAILS.filter(
        (rail) => only === undefined || rail.id === only,
    ).map((rail) => {
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

    return (
        <RecipeBrowseRails
            rails={rails}
            cuisines={only === undefined ? cuisines : []}
            {...(only === undefined ? { refreshNotice } : {})}
        />
    );
};

/** What the results are drawn from: the pages of one search, and the criteria they belong to. */
interface ResultsViewProps extends DiscoveryCardActions {
    readonly pages: readonly { readonly results: readonly RecipeSearchResult[] }[];
    readonly criteria: RecipeDiscoveryCriteria;
    readonly stale: boolean;
    readonly cuisines: readonly RecipeBrowseCuisineShortcut[];
    readonly facets: RecipeFacets;
    readonly cardVariant: 'grid' | 'compact';
    readonly onSeeAll: (sortBy: RecipeSearchSortBy) => void;
    readonly onClearSearch: () => void;
    readonly onClearFilters: () => void;
    readonly onPickTag: (tag: string) => void;
    readonly refreshNotice?: ReturnType<typeof useRefreshNotice>;
    readonly loadMore?: Parameters<typeof RecipeDiscoveryResults>[0]['loadMore'];
}

/**
 * The results of one search, from its pages: the rails or the cards, the no-result state, and one nutrition batch per
 * fetched page. Shared by the settled read and by the "previous results" kept under a failed search.
 *
 * @param props - The pages, the criteria they belong to, and the intents to forward.
 * @returns The discovery results.
 */
const ResultsView: FC<ResultsViewProps> = ({
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
    loadMore,
    ...actions
}) => {
    const browsing = isDiscoveryBrowsing(criteria);
    // The deferred calorie lookup (ADR-0021), ONE REQUEST PER FETCHED PAGE: "Load more" appends, so a single batch over
    // every accumulated id would change its key on every page and drop the figures already on screen to skeletons.
    // While the rails are the body these cards are not on screen, so nothing is asked about them; and the compact card draws
    // no figure, so a batch for it would have nobody to read the promise (a rejection would go unhandled).
    // Unmemoized on purpose: the lookup keys its batches on the ids' content, never on this array's identity.
    const renderNutrition = useHydratedNutrition(browsing || cardVariant === 'compact' ? [] : recipeIdPagesOf(pages));
    const kind = noResultKindOf(criteria);

    return (
        <RecipeDiscoveryResults
            {...actions}
            results={pages.flatMap((page) => page.results)}
            query={criteria.query}
            kind={kind}
            stale={stale}
            cardVariant={cardVariant}
            renderNutrition={renderNutrition}
            {...(refreshNotice === undefined ? {} : { refreshNotice })}
            {...(loadMore === undefined ? {} : { loadMore })}
            noResult={{
                onClearSearch,
                onClearFilters,
                tryTags: tryTheseTagsOf(facets.tags, criteria.filters.tags ?? []),
                onPickTag,
                trendingSlot: <BrowseRailsSection only="trending" cuisines={[]} onSeeAll={onSeeAll} {...actions} />,
            }}
            {...(browsing
                ? {
                      browseSlot: <BrowseRailsSection cuisines={cuisines} onSeeAll={onSeeAll} {...actions} />,
                  }
                : {})}
        />
    );
};

/** Props for {@link SettledDiscoveryResults}. */
interface SettledDiscoveryResultsProps extends Omit<ResultsViewProps, 'pages' | 'refreshNotice' | 'loadMore'> {
    readonly read: RecipeSearchRead;
    readonly onRecovered: () => void;
}

/**
 * The results of a settled search: the suspense read, its refresh notice, and the pager.
 */
const SettledDiscoveryResults: FC<SettledDiscoveryResultsProps> = ({ read, onRecovered, ...results }) => {
    const search = useSuspenseInfiniteQuery(read);
    // A failed refresh of the results on screen is the notice's; a failed NEXT page is the load-more control's.
    const refreshNotice = useRefreshNotice(search, { onRecovered });

    return (
        <ResultsView
            {...results}
            pages={search.data.pages}
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
 * The previous results kept under a failed search: the last criteria whose read settled, read PASSIVELY (`enabled: false`)
 * from the cache — it never fetches, so a failed search cannot trigger a second request.
 *
 * @param client - The recipe-service client.
 * @param criteria - The last criteria that settled, if any.
 * @returns The pages that were on screen, or `undefined` on a first load.
 */
function usePreviousPages(client: RecipeServiceClient, criteria: RecipeDiscoveryCriteria | undefined) {
    const read = recipeQueries(client).searchInfinite(
        discoverySearchParams(
            criteria ?? { filters: {}, query: '', sortBy: RecipeSearchSortBy.RELEVANCE, browseDismissed: false },
        ),
    );
    const previous = useInfiniteQuery({ ...read, enabled: false });

    return criteria === undefined ? undefined : previous.data?.pages;
}

/**
 * The live public-discovery container.
 *
 * @param props - The active locale.
 * @returns The discovery frame around the search's read boundary.
 */
export const RecipeDiscoveryContainer: FC<RecipeDiscoveryContainerProps> = ({ locale, avatar }) => {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const filterCopy = useMessages(filterMessages);

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
    // The last criteria whose read settled: when the next search fails, its results stay under the message.
    const lastSettled = useLastDefined(settledSearch.data === undefined ? undefined : settled);
    const previousPages = usePreviousPages(client, lastSettled);
    const ingredientSearch = useIngredientFilterSearch(filters.ingredients?.length ?? 0);
    const recovery = useRecoverySignal();
    const saveCopy = useSaveCopy((copyId) => router.push(`/${locale}/recipes/${copyId}/edit` as Route));
    const container = useMainContainerClass();
    const presentation = useFilterPresentation();
    const [sheetOpen, setSheetOpen] = useState(false);

    // Recent searches (U7) are keyed off the DEBOUNCED term — the one that searches — so history records searches the
    // viewer ran, never keystrokes. Persisted in `localStorage` through the injected port.
    const recentSearches = useRecentSearches(debouncedQuery, webRecentSearchStore);

    // Annotated with the NARROW view-model: the `?? {}` fallback (nothing settled yet) would otherwise widen it to `{}`.
    const facets: RecipeFacets = settledSearch.data?.pages[0]?.facets ?? {};
    const total = settledSearch.data?.pages[0]?.total;

    const searchingNow = isDiscoverySearching({ filters, query: searchInput });
    const browsing = isDiscoveryBrowsing(settled);
    // The announced sentence describes results on screen, so nothing is announced while the rails are the body.
    const resultsSummary: RecipeDiscoveryResultsSummary | undefined =
        total === undefined || browsing
            ? undefined
            : { count: total, query: settled.query, kind: noResultKindOf(settled) };

    // Write the next criteria to the URL via the Next-integrated history API (no server round-trip per keystroke).
    const applyCriteria = useCallback(
        (nextFilters: typeof filters, nextQuery: string) => {
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

    const onFilterAction = (action: Parameters<typeof applyFilterAction>[1]): void =>
        applyCriteria(applyFilterAction(filters, action), searchInput);

    const cards: DiscoveryCardActions = {
        saveCopy,
        hrefOf: (recipeId) => `/${locale}/recipes/${recipeId}`,
        onSelectRecipe: (id) => router.push(`/${locale}/recipes/${id}` as Route),
    };

    const onSeeAll = (railSort: RecipeSearchSortBy): void => {
        setSortBy(railSort);
        setBrowseDismissed(true);
    };

    const cuisines: readonly RecipeBrowseCuisineShortcut[] = showsCuisineShortcuts(facets.cuisine)
        ? (facets.cuisine ?? []).map((facet) => ({
              value: facet.value,
              onSelect: () =>
                  applyCriteria(applyFilterAction(filters, { kind: 'setCuisine', cuisine: facet.value }), searchInput),
          }))
        : [];

    const view = filterBarViewOf({ facets, filters, viewState: ingredientSearch.viewState }, filterCopy);
    const search = {
        query: ingredientSearch.query,
        onQueryChange: ingredientSearch.setQuery,
        viewState: ingredientSearch.viewState,
    };
    const filterSlots: DiscoveryFilterSlots =
        presentation === 'panel'
            ? {
                  presentation: 'panel',
                  panel: <FilterPanel view={view} ingredientSearch={search} onFilterAction={onFilterAction} />,
              }
            : {
                  presentation: 'sheet',
                  trigger: <FilterTrigger view={view} onPress={() => setSheetOpen(true)} />,
                  applied: <AppliedFilters view={view} chipOverflow="scroll" onFilterAction={onFilterAction} />,
                  sheet: (
                      <FilterSheet
                          open={sheetOpen}
                          onOpenChange={setSheetOpen}
                          view={view}
                          chipOverflow={container === 'narrow' ? 'scroll' : 'wrap'}
                          ingredientSearch={search}
                          onFilterAction={onFilterAction}
                          resultCount={total}
                      />
                  ),
              };

    const resultsProps = {
        ...cards,
        criteria: settled,
        stale,
        cuisines,
        facets,
        cardVariant:
            cardVariantOf(container, 'list', 'discover') === 'compact' ? ('compact' as const) : ('grid' as const),
        onSeeAll,
        onClearSearch: () => onSearchChange(''),
        onClearFilters: () => onFilterAction({ kind: 'clearAll' }),
        onPickTag: (tag: string) => onFilterAction({ kind: 'toggleFacet', dimension: 'tags', value: tag }),
    };

    return (
        <RecipeDiscoveryFrame
            searchValue={searchInput}
            onSearchChange={onSearchChange}
            searching={searchingNow}
            headingFocusSignal={recovery.signal}
            resultsSummary={resultsSummary}
            // Slice 3: Discover is its own tab, with the avatar as its large title's action below 840.
            {...(avatar === undefined ? {} : { headerAction: { kind: 'avatar', avatar } })}
            recentSearches={{
                queries: recentSearches.queries,
                // Selecting one is exactly a search change: the field echoes it, the URL is updated, and the debounce
                // feeds it to the search — no second code path.
                onSelect: onSearchChange,
                onClear: recentSearches.clear,
            }}
            filters={filterSlots}
            sort={!browseDismissed && !searchingNow ? undefined : { active: sortBy, onChange: setSortBy }}
            onExitToBrowse={browseDismissed && !searchingNow ? () => setBrowseDismissed(false) : undefined}
        >
            <ClientQueryBoundary
                prefetchedKeys={[read.queryKey]}
                resetKeys={[settled]}
                loading={<RecipeDiscoveryLoading />}
                renderError={({ resetErrorBoundary }) => (
                    <RecipeDiscoveryLoadError
                        onRetry={resetErrorBoundary}
                        {...(previousPages === undefined || lastSettled === undefined
                            ? {}
                            : {
                                  previous: (
                                      <ResultsView
                                          {...resultsProps}
                                          pages={previousPages}
                                          criteria={lastSettled}
                                          stale={false}
                                      />
                                  ),
                              })}
                    />
                )}
            >
                <SettledDiscoveryResults read={read} onRecovered={recovery.onRecovered} {...resultsProps} />
            </ClientQueryBoundary>
        </RecipeDiscoveryFrame>
    );
};
