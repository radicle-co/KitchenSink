/**
 * Public-recipe discovery screen (mobile, T076 / US2 + FR-006, U7 overhaul). Drives the shared native
 * `RecipeDiscoveryList` + `RecipeFilterBar` + curated `RecipeBrowseRails` building blocks from
 * `useInfiniteSearchRecipes`. Unlike web (URL-persisted), mobile holds the search term and the active
 * filters in component state — the platform edge — but feeds them through the SAME shared pure model
 * (`filtersToSearchParams`, `toggleFacetValue`, …), so the two platforms cannot drift on filter semantics.
 *
 * Two U7 behaviours mirror the web container:
 * - **Debounced search (per-container).** The immediate `searchValue` echoes into the field, while the value
 *   FED TO the query is debounced ({@link DISCOVERY_SEARCH_DEBOUNCE_MS}) so typing does not fire a request
 *   per keystroke.
 * - **Browsable default.** With no active query/filter, the screen shows curated rails (Trending/New/Quick +
 *   cuisine shortcuts) instead of a bare relevance stream; a rail's "see all" reveals the full sorted list.
 * - **Recent searches.** `useRecentSearches` keeps a small, de-duplicated history keyed off the DEBOUNCED
 *   value (so only searches that actually ran are recorded), persisted in `AsyncStorage` via the injected
 *   `nativeRecentSearchStore` port — the platform edge of the same shared hook web uses with `localStorage`.
 */
import {
    RecipeBrowseRails,
    RecipeDiscoveryList,
    RecipeFilterBar,
    DISCOVERY_SEARCH_DEBOUNCE_MS,
    addIngredientFilter,
    clearRecipeFilters,
    filtersToSearchParams,
    hasActiveFilters,
    removeIngredientFilter,
    setCuisine,
    setMaxCookTime,
    setMaxPrepTime,
    setMaxTotalTime,
    toggleFacetValue,
    EMPTY_RECIPE_FILTERS,
    type FacetDimension,
    type RecipeBrowseCuisineShortcut,
    type RecipeBrowseRailView,
    type RecipeDiscoveryStatus,
    type RecipeFilterState,
} from '@commise/features-recipes';
import {
    useBrowseRails,
    useDebouncedValue,
    useIngredientFilterSearch,
    useRecentSearches,
} from '@commise/features-recipes/hooks';
import { RecipeSearchSortBy } from '@kitchensink/recipe-core';
import { useInfiniteSearchRecipes, useCloneRecipe } from '@kitchensink/recipe-service-client/hooks';
import type { FC, JSX } from 'react';
import { useState } from 'react';

import { nativeRecentSearchStore } from '../storage/recentSearchStore.js';

/** Props for {@link RecipeDiscoveryScreen}. */
export interface RecipeDiscoveryScreenProps {
    /** Invoked with a recipe id when a discovery row is activated (the navigator opens its detail). */
    readonly onSelectRecipe: (id: string) => void;
    /**
     * Filters to pre-apply on first mount — e.g. a tag deep-link from a recipe detail (D6). Defaults to no
     * filters. This still runs through the SAME visibility-scoped `useInfiniteSearchRecipes`, so a
     * deep-linked tag never surfaces a recipe the viewer couldn't otherwise see.
     */
    readonly initialFilters?: RecipeFilterState;
}

/** Props for the mount-gated browse-rails section (only rendered while browsing — see the screen). */
interface BrowseRailsSectionProps {
    readonly cuisines: readonly RecipeBrowseCuisineShortcut[];
    readonly cloningId?: string | null;
    readonly onSelectRecipe: (id: string) => void;
    readonly onClone: (id: string) => void;
    readonly onSeeAll: (sortBy: RecipeSearchSortBy) => void;
}

/**
 * The curated rails' data section — its `useBrowseRails` runs ONLY while mounted, and the screen mounts it
 * solely when browsing, so the three rail queries are a browse-time cost, not an always-on one.
 */
const BrowseRailsSection: FC<BrowseRailsSectionProps> = ({
    cuisines,
    cloningId,
    onSelectRecipe,
    onClone,
    onSeeAll,
}) => {
    const { rails } = useBrowseRails();
    const railViews: readonly RecipeBrowseRailView[] = rails.map((rail) => ({
        id: rail.id,
        status: rail.status,
        results: rail.results,
        onSeeAll: () => onSeeAll(rail.sortBy),
    }));

    return (
        <RecipeBrowseRails
            rails={railViews}
            cuisines={cuisines}
            cloningId={cloningId}
            onSelectRecipe={onSelectRecipe}
            onClone={onClone}
        />
    );
};

/**
 * The public-discovery screen.
 *
 * @param props - The selection callback the navigator wires to detail navigation, plus optional preset filters.
 * @returns The discovery browse/search/filter view with per-row clone.
 */
export function RecipeDiscoveryScreen({ onSelectRecipe, initialFilters }: RecipeDiscoveryScreenProps): JSX.Element {
    const [searchValue, setSearchValue] = useState('');
    const [filters, setFilters] = useState<RecipeFilterState>(initialFilters ?? EMPTY_RECIPE_FILTERS);
    const [sortBy, setSortBy] = useState<RecipeSearchSortBy>(RecipeSearchSortBy.RELEVANCE);
    const [browseDismissed, setBrowseDismissed] = useState(false);

    // The debounced value — not the immediate `searchValue` — feeds the fetch, so typing does not fire a
    // request per keystroke; the field still echoes `searchValue` immediately.
    const debouncedSearch = useDebouncedValue(searchValue, DISCOVERY_SEARCH_DEBOUNCE_MS);

    const search = useInfiniteSearchRecipes({ ...filtersToSearchParams(filters, debouncedSearch), sortBy });
    const clone = useCloneRecipe();
    const ingredientSearch = useIngredientFilterSearch();

    // Recent searches (U7) are keyed off the DEBOUNCED value — the one that actually fed the fetch above — so
    // the history holds searches the user ran, never keystrokes. Persisted via `AsyncStorage` (the injected
    // port), mirroring web's `localStorage`.
    const recentSearches = useRecentSearches(debouncedSearch, nativeRecentSearchStore);

    const status: RecipeDiscoveryStatus = search.isError ? 'error' : search.isLoading ? 'loading' : 'ready';
    const cloningId = clone.isPending ? (clone.variables ?? null) : null;

    const results = search.data?.pages.flatMap((page) => page.results) ?? [];
    const facets = search.data?.pages[0]?.facets ?? {};

    const searching = searchValue.trim().length > 0 || hasActiveFilters(filters);
    const browsing = !searching && !browseDismissed;

    const cuisines: readonly RecipeBrowseCuisineShortcut[] = (facets.cuisine ?? []).map((facet) => ({
        value: facet.value,
        onSelect: () => setFilters((current) => setCuisine(current, facet.value)),
    }));

    return (
        <RecipeDiscoveryList
            status={status}
            results={results}
            searchValue={searchValue}
            onSearchChange={setSearchValue}
            onSelectRecipe={onSelectRecipe}
            onClone={(id) => clone.mutate(id)}
            onRetry={() => void search.refetch()}
            // Pull-to-refresh (U4/L8): the spinner tracks the in-flight refetch; pulling re-runs the search.
            refresh={{ refreshing: search.isRefetching, onRefresh: () => void search.refetch() }}
            cloningId={cloningId}
            hasActiveFilters={hasActiveFilters(filters)}
            sort={{ active: sortBy, onChange: setSortBy }}
            recentSearches={{
                queries: recentSearches.queries,
                // Selecting one is exactly a search change — the same single code path a keystroke takes.
                onSelect: setSearchValue,
                onClear: recentSearches.clear,
            }}
            loadMore={{
                hasMore: search.hasNextPage,
                loading: search.isFetchingNextPage,
                onLoadMore: () => void search.fetchNextPage(),
            }}
            onExitToBrowse={browseDismissed && !searching ? () => setBrowseDismissed(false) : undefined}
            browseSlot={
                browsing ? (
                    <BrowseRailsSection
                        cuisines={cuisines}
                        cloningId={cloningId}
                        onSelectRecipe={onSelectRecipe}
                        onClone={(id) => clone.mutate(id)}
                        onSeeAll={(railSort) => {
                            setSortBy(railSort);
                            setBrowseDismissed(true);
                        }}
                    />
                ) : undefined
            }
            filterSlot={
                <RecipeFilterBar
                    facets={facets}
                    filters={filters}
                    onToggleFacet={(dimension: FacetDimension, value: string) =>
                        setFilters((current) => toggleFacetValue(current, dimension, value))
                    }
                    onSetCuisine={(cuisine) => setFilters((current) => setCuisine(current, cuisine))}
                    onSetMaxPrepTime={(minutes) => setFilters((current) => setMaxPrepTime(current, minutes))}
                    onSetMaxCookTime={(minutes) => setFilters((current) => setMaxCookTime(current, minutes))}
                    onSetMaxTotalTime={(minutes) => setFilters((current) => setMaxTotalTime(current, minutes))}
                    ingredientSearch={{
                        query: ingredientSearch.query,
                        onQueryChange: ingredientSearch.setQuery,
                        viewState: ingredientSearch.viewState,
                    }}
                    onAddIngredientFilter={(ingredient) =>
                        setFilters((current) => addIngredientFilter(current, ingredient))
                    }
                    onRemoveIngredientFilter={(id) => setFilters((current) => removeIngredientFilter(current, id))}
                    onClearAll={() => setFilters(clearRecipeFilters())}
                />
            }
        />
    );
}
