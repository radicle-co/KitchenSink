/**
 * Public-recipe discovery screen (mobile, T076 / US2 + FR-006, U7 overhaul, orchestration): the shared native discovery
 * FRAME around a suspense read of the search, with the curated rails as the body while the viewer is browsing.
 *
 * The frame (heading, search field, filters, back-to-browse, sort, the count line) sits outside the read boundary, so a pending or
 * failed search swaps only the results. `Suspense` renders `RecipeDiscoveryLoading`, the error boundary renders
 * `RecipeDiscoveryLoadError` — over the PREVIOUS results, which stay — and once settled the RESULTS render the rails or the
 * cards. Unlike web
 * (URL-persisted), the term and filters are component state — the platform edge — fed through the SAME shared pure model
 * (`discoverySearchParams`, `applyFilterAction`, …), so the two platforms cannot drift on what a search is.
 *
 * The same three behaviours as the web container meet at the criteria: the field echoes every keystroke while the term
 * that searches is debounced ({@link DISCOVERY_SEARCH_DEBOUNCE_MS}); the criteria are deferred
 * (`useDeferredDiscoveryCriteria`), so a new term, filter or sort keeps the previous results on screen, busy, until the
 * new ones settle, and the boundary resets when the settled criteria change; and with nothing searched the body is the
 * curated rails. The frame follows what the viewer asked for NOW; the results follow what has settled. The facets
 * live in ONE place (`useFilterPresentation`): a panel beside the results on a wide tablet, otherwise the Filters button,
 * the applied-filter chips and the sheet. Their groups come from a PASSIVE observer of the settled search
 * (`enabled: false`), so they keep their last settled values while a newer search is pending. Recent searches persist
 * through the injected `nativeRecentSearchStore` port. Save a copy is `useSaveCopy`: the snackbar's Edit opens the copy.
 *
 * @pattern Layout slot — the persistent frame around a Suspense read boundary, with the criteria, the recent searches
 *     and the recovery counter lifted to the frame's side
 */
import {
    AppliedFilters,
    DISCOVERY_SEARCH_DEBOUNCE_MS,
    EMPTY_RECIPE_FILTERS,
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
    RecipeNutritionSlot,
    applyFilterAction,
    browseRailSearchParams,
    cardVariantOf,
    discoverySearchParams,
    filterBarViewOf,
    filterMessages,
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
    type RecipeFilterState,
} from '@commise/features-recipes';
import {
    useBrowseRailsRefresh,
    useDebouncedValue,
    useDeferredDiscoveryCriteria,
    useIngredientFilterSearch,
    useLastDefined,
    useRecentSearches,
    useRecipeNutritionBatches,
    useSaveCopy,
    type RecipeNutritionLookup,
    type SaveCopy,
} from '@commise/features-recipes/hooks';
import { useMessages } from '@commise/i18n/react';
import { QueryBoundary } from '@commise/query/boundary';
import { useRecoverySignal } from '@commise/query/recovery-signal';
import { useRefreshNotice } from '@commise/query/refresh-notice';
import type { HeaderAction } from '@commise/ui/large-title-header';
import type { ScrollBind } from '@commise/ui/scroll-host';
import { RecipeSearchSortBy, type RecipeSearchResult } from '@kitchensink/recipe-core';
import { recipeQueries, type RecipeServiceClient } from '@kitchensink/recipe-service-client';
import { useRecipeServiceClient } from '@kitchensink/recipe-service-client/hooks';
import { useInfiniteQuery, useSuspenseInfiniteQuery } from '@tanstack/react-query';
import type { FC, JSX } from 'react';
import { useState } from 'react';

import { nativeRecentSearchStore } from '../storage/recentSearchStore.js';

/** Props for {@link RecipeDiscoveryScreen}. */
export interface RecipeDiscoveryScreenProps {
    /** Invoked with a recipe id when a discovery row is activated (the navigator opens its detail). */
    readonly onSelectRecipe: (id: string) => void;
    /** Opens a saved copy in the editor: the Save a copy snackbar's Edit action. */
    readonly onEditRecipe: (id: string) => void;
    /**
     * Filters to pre-apply on first mount — e.g. a tag deep-link from a recipe detail (D6). Defaults to no filters. This
     * still runs through the SAME visibility-scoped search, so a deep-linked tag never surfaces a recipe the viewer
     * couldn't otherwise see.
     */
    readonly initialFilters?: RecipeFilterState;
    /** The large title's action: the avatar, which pushes Profile (slice 3). The route supplies it. */
    readonly headerAction?: HeaderAction;
    /** The bind for this screen's one vertical scroller, from its `ScrollHost` (`TabRootScreen`). */
    readonly scrollBind?: ScrollBind;
}

/** The discovery search the results render. */
type RecipeSearchRead = ReturnType<ReturnType<typeof recipeQueries>['searchInfinite']>;

/**
 * The host closure every wired surface writes: one slot per card, all reading the SAME batch promise.
 *
 * `null` from the lookup means no batch covers this recipe — render nothing, rather than mounting a boundary with no
 * promise to settle (a skeleton that would never come down).
 *
 * @param nutritionFor - The screen's batch lookup.
 * @returns The `renderNutrition` render prop the presentational views call once per card.
 */
const nutritionRenderer = (nutritionFor: RecipeNutritionLookup) => (recipeId: string) => {
    const batch = nutritionFor(recipeId);

    return batch === null ? null : <RecipeNutritionSlot nutritionBatchPromise={batch} recipeId={recipeId} />;
};

/** What every card on the surface shares: its Save a copy control and how it is opened. */
interface DiscoveryCardActions {
    readonly saveCopy: SaveCopy;
    readonly onSelectRecipe: (id: string) => void;
}

/** Props for {@link SettledRail}. */
interface SettledRailProps extends DiscoveryCardActions {
    readonly read: RecipeSearchRead;
}

/**
 * One rail's settled read: its cards, with ONE batch for this rail — the rails settle at different moments, so a batch
 * spanning all three would change as each landed and re-batch the rails already showing figures.
 */
const SettledRail: FC<SettledRailProps> = ({ read, ...actions }) => {
    const rail = useSuspenseInfiniteQuery(read);
    const nutritionFor = useRecipeNutritionBatches(recipeIdPagesOf(rail.data.pages));

    return (
        <RecipeBrowseRailResults
            {...actions}
            results={rail.data.pages.flatMap((page) => page.results)}
            renderNutrition={nutritionRenderer(nutritionFor)}
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
    /** The screen's scroll bind, when the rails ARE the screen's scroller (browsing), never the nested Trending rail. */
    readonly scrollBind?: ScrollBind;
}

/**
 * The curated rails, each behind its OWN read boundary, so one rail loads and fails without the others. Mounted only
 * while browsing (or under a no-result state, for the one rail). A failed refresh of the rails on screen keeps their
 * rows and is reported once, for the block, through `useBrowseRailsRefresh`'s passive observers.
 */
const BrowseRailsSection: FC<BrowseRailsSectionProps> = ({ cuisines, onSeeAll, only, scrollBind, ...actions }) => {
    const queries = recipeQueries(useRecipeServiceClient());
    const railsRefresh = useBrowseRailsRefresh();
    const refreshNotice = useRefreshNotice(railsRefresh);
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
                <QueryBoundary
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
                </QueryBoundary>
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
    readonly refresh?: Parameters<typeof RecipeDiscoveryResults>[0]['refresh'];
    readonly loadMore?: Parameters<typeof RecipeDiscoveryResults>[0]['loadMore'];
    /** The screen's scroll bind, for whichever of the rails, the cards or the no-result state is the scroller. */
    readonly scrollBind?: ScrollBind;
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
    refresh,
    loadMore,
    scrollBind,
    ...actions
}) => {
    const browsing = isDiscoveryBrowsing(criteria);
    // The deferred calorie lookup (ADR-0021 §6), ONE BATCH PER FETCHED PAGE: a "load more" grows the flattened results,
    // which would change the batch key and drop every figure on screen back to its skeleton. While the rails are the
    // body these cards are not on screen, so nothing is asked about them; and the compact card draws no figure, so a batch
    // for it would have nobody to read the promise (a rejection would go unhandled).
    const nutritionFor = useRecipeNutritionBatches(browsing || cardVariant === 'compact' ? [] : recipeIdPagesOf(pages));

    return (
        <RecipeDiscoveryResults
            {...actions}
            results={pages.flatMap((page) => page.results)}
            query={criteria.query}
            kind={noResultKindOf(criteria)}
            stale={stale}
            cardVariant={cardVariant}
            renderNutrition={nutritionRenderer(nutritionFor)}
            {...(refreshNotice === undefined ? {} : { refreshNotice })}
            {...(refresh === undefined ? {} : { refresh })}
            {...(loadMore === undefined ? {} : { loadMore })}
            {...(scrollBind === undefined ? {} : { scrollBind })}
            noResult={{
                onClearSearch,
                onClearFilters,
                tryTags: tryTheseTagsOf(facets.tags, criteria.filters.tags ?? []),
                onPickTag,
                trendingSlot: <BrowseRailsSection only="trending" cuisines={[]} onSeeAll={onSeeAll} {...actions} />,
            }}
            {...(browsing
                ? {
                      browseSlot: (
                          <BrowseRailsSection
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

/** Props for {@link SettledDiscoveryResults}. */
interface SettledDiscoveryResultsProps extends Omit<
    ResultsViewProps,
    'pages' | 'refreshNotice' | 'refresh' | 'loadMore'
> {
    readonly read: RecipeSearchRead;
    readonly onRecovered: () => void;
}

/**
 * The results of a settled search: the suspense read, its pull-to-refresh and refresh notice, and the pager.
 */
const SettledDiscoveryResults: FC<SettledDiscoveryResultsProps> = ({ read, onRecovered, ...results }) => {
    const search = useSuspenseInfiniteQuery(read);
    // A failed pull or background refresh is the notice's; a failed NEXT page is the load-more control's.
    const refreshNotice = useRefreshNotice(search, { onRecovered });

    return (
        <ResultsView
            {...results}
            pages={search.data.pages}
            refreshNotice={refreshNotice}
            // Pull-to-refresh (U4/L8): the spinner tracks the in-flight refetch; pulling re-runs the search.
            refresh={{ refreshing: search.isRefetching, onRefresh: () => void search.refetch() }}
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
 * The public-discovery screen.
 *
 * @param props - The selection callback the navigator wires to detail navigation, plus optional preset filters.
 * @returns The discovery frame around the search's read boundary.
 */
export function RecipeDiscoveryScreen({
    onSelectRecipe,
    onEditRecipe,
    initialFilters,
    headerAction,
    scrollBind,
}: RecipeDiscoveryScreenProps): JSX.Element {
    const filterCopy = useMessages(filterMessages);
    const [searchValue, setSearchValue] = useState('');
    const [filters, setFilters] = useState<RecipeFilterState>(initialFilters ?? EMPTY_RECIPE_FILTERS);
    const [sortBy, setSortBy] = useState<RecipeSearchSortBy>(RecipeSearchSortBy.RELEVANCE);
    const [browseDismissed, setBrowseDismissed] = useState(false);
    const [sheetOpen, setSheetOpen] = useState(false);

    // The debounced term — not the immediate `searchValue` — searches, so typing does not send a request per keystroke.
    const debouncedSearch = useDebouncedValue(searchValue, DISCOVERY_SEARCH_DEBOUNCE_MS);
    const { settled, stale } = useDeferredDiscoveryCriteria({
        filters,
        query: debouncedSearch,
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
    const saveCopy = useSaveCopy(onEditRecipe);
    const ingredientSearch = useIngredientFilterSearch(filters.ingredients?.length ?? 0);
    const recovery = useRecoverySignal();
    const container = useMainContainerClass();
    const presentation = useFilterPresentation();

    // Recent searches (U7) are keyed off the DEBOUNCED term — the one that searches — so the history holds searches the
    // viewer ran, never keystrokes.
    const recentSearches = useRecentSearches(debouncedSearch, nativeRecentSearchStore);

    // Annotated with the NARROW view-model: the `?? {}` fallback (nothing settled yet) would otherwise widen it to `{}`.
    const facets: RecipeFacets = settledSearch.data?.pages[0]?.facets ?? {};
    const total = settledSearch.data?.pages[0]?.total;

    const searchingNow = isDiscoverySearching({ filters, query: searchValue });
    const browsing = isDiscoveryBrowsing(settled);
    // The announced sentence describes results on screen, so nothing is announced while the rails are the body.
    const resultsSummary: RecipeDiscoveryResultsSummary | undefined =
        total === undefined || browsing
            ? undefined
            : { count: total, query: settled.query, kind: noResultKindOf(settled) };

    const onFilterAction = (action: Parameters<typeof applyFilterAction>[1]): void =>
        setFilters((current) => applyFilterAction(current, action));

    const onSeeAll = (railSort: RecipeSearchSortBy): void => {
        setSortBy(railSort);
        setBrowseDismissed(true);
    };

    const cuisines: readonly RecipeBrowseCuisineShortcut[] = showsCuisineShortcuts(facets.cuisine)
        ? (facets.cuisine ?? []).map((facet) => ({
              value: facet.value,
              onSelect: () => onFilterAction({ kind: 'setCuisine', cuisine: facet.value }),
          }))
        : [];

    const view = filterBarViewOf({ facets, filters, viewState: ingredientSearch.viewState }, filterCopy);
    const ingredients = {
        query: ingredientSearch.query,
        onQueryChange: ingredientSearch.setQuery,
        viewState: ingredientSearch.viewState,
    };
    const filterSlots: DiscoveryFilterSlots =
        presentation === 'panel'
            ? {
                  presentation: 'panel',
                  panel: <FilterPanel view={view} ingredientSearch={ingredients} onFilterAction={onFilterAction} />,
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
                          ingredientSearch={ingredients}
                          onFilterAction={onFilterAction}
                          resultCount={total}
                      />
                  ),
              };

    const resultsProps = {
        saveCopy,
        onSelectRecipe,
        criteria: settled,
        stale,
        cuisines,
        facets,
        cardVariant:
            cardVariantOf(container, 'list', 'discover') === 'compact' ? ('compact' as const) : ('grid' as const),
        onSeeAll,
        onClearSearch: () => setSearchValue(''),
        onClearFilters: () => onFilterAction({ kind: 'clearAll' }),
        onPickTag: (tag: string) => onFilterAction({ kind: 'toggleFacet', dimension: 'tags', value: tag }),
        ...(scrollBind === undefined ? {} : { scrollBind }),
    };

    return (
        <RecipeDiscoveryFrame
            searchValue={searchValue}
            onSearchChange={setSearchValue}
            searching={searchingNow}
            headingFocusSignal={recovery.signal}
            resultsSummary={resultsSummary}
            {...(headerAction === undefined ? {} : { headerAction })}
            recentSearches={{
                queries: recentSearches.queries,
                // Selecting one is exactly a search change — the same single code path a keystroke takes.
                onSelect: setSearchValue,
                onClear: recentSearches.clear,
            }}
            filters={filterSlots}
            sort={!browseDismissed && !searchingNow ? undefined : { active: sortBy, onChange: setSortBy }}
            onExitToBrowse={browseDismissed && !searchingNow ? () => setBrowseDismissed(false) : undefined}
        >
            <QueryBoundary
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
            </QueryBoundary>
        </RecipeDiscoveryFrame>
    );
}
