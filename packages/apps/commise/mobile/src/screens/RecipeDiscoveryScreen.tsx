/**
 * Public-recipe discovery screen (mobile, T076 / US2 + FR-006, U7 overhaul, orchestration): the shared native discovery
 * FRAME around a suspense read of the search, with the curated rails as the body while the viewer is browsing.
 *
 * The frame (heading, search field, filter bar, back-to-browse, sort) sits outside the read boundary, so a pending or
 * failed search swaps only the results. `Suspense` renders `RecipeDiscoveryLoading`, the error boundary renders
 * `RecipeDiscoveryLoadError`, and once settled the RESULTS render the rails or the counted grid. Unlike web
 * (URL-persisted), the term and filters are component state — the platform edge — fed through the SAME shared pure model
 * (`discoverySearchParams`, `applyFilterAction`, …), so the two platforms cannot drift on what a search is.
 *
 * The same three behaviours as the web container meet at the criteria: the field echoes every keystroke while the term
 * that searches is debounced ({@link DISCOVERY_SEARCH_DEBOUNCE_MS}); the criteria are deferred
 * (`useDeferredDiscoveryCriteria`), so a new term, filter or sort keeps the previous results on screen, busy, until the
 * new ones settle, and the boundary resets when the settled criteria change; and with nothing searched the body is the
 * curated rails. The frame follows what the viewer asked for NOW; the results follow what has settled. The filter bar's
 * facets come from a PASSIVE observer of the settled search (`enabled: false`), so they keep their last settled values
 * while a newer search is pending. Recent searches persist through the injected `nativeRecentSearchStore` port.
 *
 * @pattern Layout slot — the persistent frame around a Suspense read boundary, with the criteria, the recent searches
 *     and the recovery counter lifted to the frame's side
 */
import {
    DISCOVERY_SEARCH_DEBOUNCE_MS,
    EMPTY_RECIPE_FILTERS,
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
    RecipeNutritionSlot,
    applyFilterAction,
    browseRailSearchParams,
    discoverySearchParams,
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
    useRecipeNutritionBatches,
    type RecipeNutritionLookup,
} from '@commise/features-recipes/hooks';
import { QueryBoundary } from '@commise/query/boundary';
import { useRecoverySignal } from '@commise/query/recovery-signal';
import { useRefreshNotice } from '@commise/query/refresh-notice';
import { RecipeSearchSortBy } from '@kitchensink/recipe-core';
import { recipeQueries } from '@kitchensink/recipe-service-client';
import { useCloneRecipe, useRecipeServiceClient } from '@kitchensink/recipe-service-client/hooks';
import { useInfiniteQuery, useSuspenseInfiniteQuery } from '@tanstack/react-query';
import type { FC, JSX, ReactNode } from 'react';
import { useState } from 'react';

import { nativeRecentSearchStore } from '../storage/recentSearchStore.js';

/** Props for {@link RecipeDiscoveryScreen}. */
export interface RecipeDiscoveryScreenProps {
    /** Invoked with a recipe id when a discovery row is activated (the navigator opens its detail). */
    readonly onSelectRecipe: (id: string) => void;
    /**
     * Filters to pre-apply on first mount — e.g. a tag deep-link from a recipe detail (D6). Defaults to no filters. This
     * still runs through the SAME visibility-scoped search, so a deep-linked tag never surfaces a recipe the viewer
     * couldn't otherwise see.
     */
    readonly initialFilters?: RecipeFilterState;
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
}

/**
 * The curated rails, each behind its OWN read boundary, so one rail loads and fails without the others. Mounted only
 * while browsing, so the three rail reads are a browse-time cost. A failed refresh of the rails on screen keeps their
 * rows and is reported once, for the block, through `useBrowseRailsRefresh`'s passive observers.
 */
const BrowseRailsSection: FC<BrowseRailsSectionProps> = ({ cuisines, onSeeAll, ...actions }) => {
    const queries = recipeQueries(useRecipeServiceClient());
    const railsRefresh = useBrowseRailsRefresh();
    const refreshNotice = useRefreshNotice(railsRefresh);
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
            rails={rails}
            cuisines={cuisines}
            refreshNotice={refreshNotice}
            // A pull while browsing refreshes the rails on screen, not the main search behind them.
            refresh={{ refreshing: railsRefresh.isRefetching, onRefresh: () => void railsRefresh.refetch() }}
        />
    );
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
 * The results of a settled search: the suspense read, its pull-to-refresh and refresh notice, and one nutrition batch
 * per fetched page.
 */
const SettledDiscoveryResults: FC<SettledDiscoveryResultsProps> = ({ read, onRecovered, ...results }) => {
    const search = useSuspenseInfiniteQuery(read);
    // A failed pull or background refresh is the notice's; a failed NEXT page is the load-more control's.
    const refreshNotice = useRefreshNotice(search, { onRecovered });
    // The deferred calorie lookup (ADR-0021 §6), ONE BATCH PER FETCHED PAGE: a "load more" grows the flattened results,
    // which would change the batch key and drop every figure on screen back to its skeleton. While the rails are the
    // body these cards are not on screen, so nothing is asked about them.
    const nutritionFor = useRecipeNutritionBatches(
        results.browseSlot === undefined ? recipeIdPagesOf(search.data.pages) : [],
    );

    return (
        <RecipeDiscoveryResults
            {...results}
            results={search.data.pages.flatMap((page) => page.results)}
            renderNutrition={nutritionRenderer(nutritionFor)}
            // Pull-to-refresh (U4/L8): the spinner tracks the in-flight refetch; pulling re-runs the search.
            refresh={{ refreshing: search.isRefetching, onRefresh: () => void search.refetch() }}
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
 * The public-discovery screen.
 *
 * @param props - The selection callback the navigator wires to detail navigation, plus optional preset filters.
 * @returns The discovery frame around the search's read boundary.
 */
export function RecipeDiscoveryScreen({ onSelectRecipe, initialFilters }: RecipeDiscoveryScreenProps): JSX.Element {
    const [searchValue, setSearchValue] = useState('');
    const [filters, setFilters] = useState<RecipeFilterState>(initialFilters ?? EMPTY_RECIPE_FILTERS);
    const [sortBy, setSortBy] = useState<RecipeSearchSortBy>(RecipeSearchSortBy.RELEVANCE);
    const [browseDismissed, setBrowseDismissed] = useState(false);

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
    const clone = useCloneRecipe();
    const ingredientSearch = useIngredientFilterSearch();
    const recovery = useRecoverySignal();

    // Recent searches (U7) are keyed off the DEBOUNCED term — the one that searches — so the history holds searches the
    // viewer ran, never keystrokes.
    const recentSearches = useRecentSearches(debouncedSearch, nativeRecentSearchStore);

    const cloningId = clone.isPending ? (clone.variables ?? null) : null;
    // Annotated with the NARROW view-model: the `?? {}` fallback (nothing settled yet) would otherwise widen it to `{}`.
    const facets: RecipeFacets = settledSearch.data?.pages[0]?.facets ?? {};

    const searchingNow = isDiscoverySearching({ filters, query: searchValue });
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

    const onClone = (id: string): void => clone.mutate(id);
    const cuisines: readonly RecipeBrowseCuisineShortcut[] = (facets.cuisine ?? []).map((facet) => ({
        value: facet.value,
        onSelect: () =>
            setFilters((current) => applyFilterAction(current, { kind: 'setCuisine', cuisine: facet.value })),
    }));

    return (
        <RecipeDiscoveryFrame
            searchValue={searchValue}
            onSearchChange={setSearchValue}
            searching={searchingNow}
            headingFocusSignal={recovery.signal}
            resultsSummary={resultsSummary}
            recentSearches={{
                queries: recentSearches.queries,
                // Selecting one is exactly a search change — the same single code path a keystroke takes.
                onSelect: setSearchValue,
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
                    onFilterAction={(action) => setFilters((current) => applyFilterAction(current, action))}
                />
            }
            sort={!browseDismissed && !searchingNow ? undefined : { active: sortBy, onChange: setSortBy }}
            onExitToBrowse={browseDismissed && !searchingNow ? () => setBrowseDismissed(false) : undefined}
        >
            <QueryBoundary
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
            </QueryBoundary>
        </RecipeDiscoveryFrame>
    );
}
