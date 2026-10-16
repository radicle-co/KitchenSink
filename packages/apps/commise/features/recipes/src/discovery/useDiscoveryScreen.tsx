/**
 * @module @commise/features-recipes/discovery/useDiscoveryScreen — the discovery screen's controller: what a search is,
 * when it runs, what stays on screen while a newer one is pending, and every intent the frame and the results raise. One
 * hook for the web container and the mobile screen, so the two cannot disagree about any of it.
 *
 * Three behaviours meet at the criteria:
 * - **Debounced search.** The field echoes every keystroke; the term that SEARCHES waits for
 *   {@link DISCOVERY_SEARCH_DEBOUNCE_MS} of quiet, so typing does not send a request per keystroke.
 * - **Deferred results.** The criteria are deferred (`useDeferredDiscoveryCriteria`), so a new term, filter or sort keeps
 *   the previous results on screen — marked busy, still naming their own query — until the new ones settle. The boundary
 *   resets when the settled criteria change.
 * - **Browsable default.** With nothing searched the body is the curated rails; a rail's "see all" leaves for the full
 *   sorted list, and back-to-browse returns.
 *
 * The shareable criteria (filters and the typed term) live behind the {@link DiscoveryCriteriaStore} port; sort, the
 * browse state, the filter sheet and the typed-term echo are view state and live here.
 *
 * @pattern Ports and Adapters — the criteria store is the one driven port this controller owns
 * @pattern Memento — `lastSettled` / `previousPages` read the previous results back from the query cache
 */
import { RecipeSearchSortBy } from '@kitchensink/recipe-core';
import { recipeQueries } from '@kitchensink/recipe-service-client';
import { useRecipeServiceClient } from '@kitchensink/recipe-service-client/hooks';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { useMessages } from '@commise/i18n/react';

import { cardVariantOf } from '../card/cardVariant.js';
import { AppliedFilters } from '../filters/AppliedFilters.js';
import { filterBarViewOf } from '../filters/filterBarView.js';
import { FilterPanel } from '../filters/FilterPanel.js';
import { FilterSheet } from '../filters/FilterSheet.js';
import { FilterTrigger } from '../filters/FilterTrigger.js';
import { filterMessages } from '../filters/messages.js';
import { applyFilterAction, type FilterAction, type RecipeFacets } from '../filters/model.js';
import { useFilterPresentation } from '../filters/useFilterPresentation.js';
import { useDebouncedValue } from '../hooks/useDebouncedValue.js';
import { useDeferredDiscoveryCriteria } from '../hooks/useDeferredDiscoveryCriteria.js';
import { useIngredientFilterSearch } from '../hooks/useIngredientFilterSearch.js';
import { useLastDefined } from '../hooks/useLastDefined.js';
import { usePreviousPages } from '../hooks/usePreviousPages.js';
import { useRecentSearches } from '../hooks/useRecentSearches.js';
import { useSaveCopy, type SaveCopy } from '../hooks/useSaveCopy.js';
import { useMainContainerClass } from '../layout/useMainContainerClass.js';
import type { DiscoveryResultsViewProps } from './DiscoveryResultsView.js';
import type { DiscoveryCriteriaStore, DiscoveryRecoverySignal } from './discoveryScreenModel.js';
import type { DiscoverySearchRead } from './discoverySearchRead.js';
import {
    DISCOVERY_SEARCH_DEBOUNCE_MS,
    discoverySearchParams,
    isDiscoveryBrowsing,
    isDiscoverySearching,
    type DiscoveryFilterSlots,
    type RecipeDiscoveryCriteria,
    type RecipeDiscoveryFrameProps,
    type RecipeDiscoveryResultsSummary,
} from './model.js';
import { cuisineShortcutsOf, noResultKindOf } from './noResults.js';
import type { RecentSearchStore } from './recentSearches.js';

/** Everything the screen renders from, in the three groups it renders them in. */
export interface DiscoveryScreenState {
    /** The persistent frame's props (every one but its title action and its body). */
    readonly frame: Omit<RecipeDiscoveryFrameProps, 'children' | 'headerAction'>;
    /** The suspense read for the settled criteria, and the criteria it belongs to. */
    readonly read: DiscoverySearchRead;
    readonly settled: RecipeDiscoveryCriteria;
    /** The card variant the results will draw — the loading body sits its placeholders in the same grid. */
    readonly cardVariant: 'grid' | 'compact';
    /** What the results view needs beyond its pages and the card actions. */
    readonly results: Pick<
        DiscoveryResultsViewProps,
        | 'criteria'
        | 'stale'
        | 'cuisines'
        | 'facets'
        | 'cardVariant'
        | 'onSeeAll'
        | 'onClearSearch'
        | 'onClearFilters'
        | 'onPickTag'
    >;
    /** The results a failed search keeps on screen and the criteria they belong to, once a first load has settled. */
    readonly previous:
        | {
              readonly pages: NonNullable<ReturnType<typeof usePreviousPages>>;
              readonly criteria: RecipeDiscoveryCriteria;
          }
        | undefined;
    readonly saveCopy: SaveCopy;
    /** A retry from the results' refresh notice succeeded. */
    readonly onRecovered: () => void;
}

/**
 * The discovery screen's controller.
 *
 * @param input - The criteria port, the recent-search persistence port, the recovery counter hook, and what Edit does once a copy exists.
 * @returns The frame's props, the read, and the results' props.
 * @sideEffect Reads the recipe-service query cache and the recent-search store; the store's `commit` writes the criteria.
 */
export function useDiscoveryScreen({
    criteria,
    recentSearchStore,
    useRecoverySignal,
    onEditCopy,
}: {
    readonly criteria: DiscoveryCriteriaStore;
    readonly recentSearchStore: RecentSearchStore;
    /** The platform's recovery counter hook (a module constant, so its hook order is stable). */
    readonly useRecoverySignal: () => DiscoveryRecoverySignal;
    readonly onEditCopy: (copyId: string) => void;
}): DiscoveryScreenState {
    const { filters } = criteria;
    const filterCopy = useMessages(filterMessages);
    // The FIELD is driven by immediate local state so a keystroke never waits on the debounce, a re-render or the store.
    const [searchInput, setSearchInput] = useState(criteria.query);
    const debouncedQuery = useDebouncedValue(searchInput, DISCOVERY_SEARCH_DEBOUNCE_MS);
    // Sort is a view preference (S3); a rail's "see all" sets it AND dismisses browse.
    const [sortBy, setSortBy] = useState<RecipeSearchSortBy>(RecipeSearchSortBy.RELEVANCE);
    const [browseDismissed, setBrowseDismissed] = useState(false);
    const [sheetOpen, setSheetOpen] = useState(false);
    const { settled, stale } = useDeferredDiscoveryCriteria({
        filters,
        query: debouncedQuery,
        sortBy,
        browseDismissed,
    });

    const client = useRecipeServiceClient();
    const read = recipeQueries(client).searchInfinite(discoverySearchParams(settled));
    // PASSIVE: reads what the suspense read caches for the settled criteria, and never fetches on its own.
    const settledSearch = useInfiniteQuery({ ...read, enabled: false });
    // The last criteria whose read settled: when the next search fails, its results stay under the message.
    const lastSettled = useLastDefined(settledSearch.data === undefined ? undefined : settled);
    const previousPages = usePreviousPages(client, lastSettled);
    const ingredientSearch = useIngredientFilterSearch(filters.ingredients?.length ?? 0);
    const recovery = useRecoverySignal();
    const saveCopy = useSaveCopy(onEditCopy);
    const container = useMainContainerClass();
    const presentation = useFilterPresentation();
    // Recent searches (U7) are keyed off the DEBOUNCED term — the one that searches — so history records searches the
    // viewer ran, never keystrokes.
    const recentSearches = useRecentSearches(debouncedQuery, recentSearchStore);

    // Annotated with the NARROW view-model: the `?? {}` fallback (nothing settled yet) would otherwise widen it to `{}`.
    const facets: RecipeFacets = settledSearch.data?.pages[0]?.facets ?? {};
    const total = settledSearch.data?.pages[0]?.total;
    const cardVariant = cardVariantOf(container, 'list', 'discover') === 'compact' ? 'compact' : 'grid';

    const searchingNow = isDiscoverySearching({ filters, query: searchInput });
    const browsing = isDiscoveryBrowsing(settled);
    // The announced sentence describes results on screen, so nothing is announced while the rails are the body.
    const resultsSummary: RecipeDiscoveryResultsSummary | undefined =
        total === undefined || browsing
            ? undefined
            : { count: total, query: settled.query, kind: noResultKindOf(settled) };

    // Selecting a recent search, clearing the search and typing are all this one path: the field echoes, the store is
    // told, and the debounce feeds the search.
    const onSearchChange = (value: string): void => {
        setSearchInput(value);
        criteria.commit((current) => ({ filters: current.filters, query: value }));
    };

    const onFilterAction = (action: FilterAction): void =>
        criteria.commit((current) => ({ filters: applyFilterAction(current.filters, action), query: current.query }));

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

    const previous: DiscoveryScreenState['previous'] =
        previousPages === undefined || lastSettled === undefined
            ? undefined
            : { pages: previousPages, criteria: lastSettled };

    return {
        frame: {
            searchValue: searchInput,
            onSearchChange,
            searching: searchingNow,
            headingFocusSignal: recovery.signal,
            resultsSummary,
            recentSearches: {
                queries: recentSearches.queries,
                onSelect: onSearchChange,
                onClear: recentSearches.clear,
            },
            filters: filterSlots,
            sort: !browseDismissed && !searchingNow ? undefined : { active: sortBy, onChange: setSortBy },
            onExitToBrowse: browseDismissed && !searchingNow ? () => setBrowseDismissed(false) : undefined,
        },
        read,
        settled,
        cardVariant,
        results: {
            criteria: settled,
            stale,
            cuisines: cuisineShortcutsOf(facets.cuisine).map((cuisine) => ({
                value: cuisine,
                onSelect: () => onFilterAction({ kind: 'setCuisine', cuisine }),
            })),
            facets,
            cardVariant,
            onSeeAll: (railSort) => {
                setSortBy(railSort);
                setBrowseDismissed(true);
            },
            onClearSearch: () => onSearchChange(''),
            onClearFilters: () => onFilterAction({ kind: 'clearAll' }),
            onPickTag: (tag) => onFilterAction({ kind: 'toggleFacet', dimension: 'tags', value: tag }),
        },
        previous,
        saveCopy,
        onRecovered: recovery.onRecovered,
    };
}
