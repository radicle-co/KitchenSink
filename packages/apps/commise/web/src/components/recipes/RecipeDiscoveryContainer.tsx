'use client';

/**
 * Container for the public-discovery route: binds the shared, presentational `RecipeDiscoveryList` +
 * `RecipeFilterBar` + curated `RecipeBrowseRails` building blocks to live data. It owns NO server data —
 * TanStack Query is the source of truth for the remote search results — and it holds NO filter state of its
 * own either: the search term and the active filters live in the URL (`?query=…&dietaryFlags=…&tags=…`), so
 * a filtered view is shareable and survives reload/back. It derives `{ filters, query }` from the URL,
 * projects them onto the `useInfiniteSearchRecipes` params via the shared pure model, and writes changes
 * back with `window.history.replaceState` — the Next-integrated history API that updates
 * `useSearchParams()` WITHOUT a server round-trip.
 *
 * Two U7 behaviours layer on top:
 * - **Debounced search (per-container).** The per-keystroke cost is the FETCH, not the URL write. The input
 *   is echoed immediately from local state, while the value FED TO the query is debounced
 *   ({@link DISCOVERY_SEARCH_DEBOUNCE_MS}); the URL push stays immediate (shareable) and does not gate
 *   keystrokes.
 * - **Browsable default.** With no active query/filter, discovery shows curated rails (Trending/New/Quick +
 *   cuisine shortcuts) instead of a bare relevance stream; a rail's "see all" reveals the full sorted list.
 * - **Recent searches.** `useRecentSearches` keeps a small, de-duplicated history keyed off the DEBOUNCED
 *   query (so only searches that actually ran are recorded), persisted in `localStorage` via the injected
 *   `webRecentSearchStore` port. Choosing one routes through the SAME `onSearchChange` a keystroke does.
 */
import { RecipeBrowseRails, RecipeDiscoveryList, RecipeFilterBar } from '@commise/features-recipes';
import type {
    FacetDimension,
    RecipeBrowseCuisineShortcut,
    RecipeBrowseRailView,
    RecipeDiscoveryStatus,
} from '@commise/features-recipes';
import {
    DISCOVERY_SEARCH_DEBOUNCE_MS,
    addIngredientFilter,
    clearRecipeFilters,
    filtersFromQueryString,
    filtersToQueryString,
    filtersToSearchParams,
    hasActiveFilters,
    removeIngredientFilter,
    setCuisine,
    setMaxCookTime,
    setMaxPrepTime,
    setMaxTotalTime,
    toggleFacetValue,
    type RecipeFilterState,
} from '@commise/features-recipes';
import {
    useBrowseRails,
    useDebouncedValue,
    useIngredientFilterSearch,
    useRecentSearches,
} from '@commise/features-recipes/hooks';
import { RecipeSearchSortBy } from '@kitchensink/recipe-core';
import { useCloneRecipe, useInfiniteSearchRecipes } from '@kitchensink/recipe-service-client/hooks';
import type { Route } from 'next';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useState } from 'react';
import type { FC } from 'react';

import { webRecentSearchStore } from '@/lib/recentSearchStore';

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

/** Props for the mount-gated browse-rails section (only rendered while browsing — see the container). */
interface BrowseRailsSectionProps {
    readonly cuisines: readonly RecipeBrowseCuisineShortcut[];
    readonly cloningId?: string | null;
    readonly onSelectRecipe: (id: string) => void;
    readonly onClone: (id: string) => void;
    readonly onSeeAll: (sortBy: RecipeSearchSortBy) => void;
}

/**
 * The curated rails' data section — its `useBrowseRails` runs ONLY while mounted, and the container mounts
 * it solely when browsing, so the three rail queries are a browse-time cost, not an always-on one.
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
 * The live public-discovery container.
 *
 * @param props - The active locale.
 * @returns The wired {@link RecipeDiscoveryList} with its {@link RecipeFilterBar} and curated rails.
 */
export const RecipeDiscoveryContainer: FC<RecipeDiscoveryContainerProps> = ({ locale }) => {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();

    // The URL is the single source of truth for the shareable criteria (filters + query). The FIELD, though,
    // is driven by immediate local state so a keystroke never waits on the debounce or a re-render.
    const { filters, query } = filtersFromQueryString(searchParams.toString());
    const [searchInput, setSearchInput] = useState(query);
    const debouncedQuery = useDebouncedValue(searchInput, DISCOVERY_SEARCH_DEBOUNCE_MS);

    // Sort is a view preference (S3), kept in local state; a rail's "see all" sets it AND dismisses browse.
    const [sortBy, setSortBy] = useState<RecipeSearchSortBy>(RecipeSearchSortBy.RELEVANCE);
    const [browseDismissed, setBrowseDismissed] = useState(false);

    // The debounced query — not the immediate `searchInput` — feeds the fetch, so typing does not fire a
    // request per keystroke.
    const search = useInfiniteSearchRecipes({ ...filtersToSearchParams(filters, debouncedQuery), sortBy });
    const clone = useCloneRecipe();
    const ingredientSearch = useIngredientFilterSearch();

    // Recent searches (U7) are keyed off the DEBOUNCED query — the value that actually fed the fetch above —
    // so history records searches the user ran, never keystrokes. Persisted in `localStorage` through the
    // injected port.
    const recentSearches = useRecentSearches(debouncedQuery, webRecentSearchStore);

    const status = toDiscoveryStatus(search.isLoading, search.isError);
    const cloningId = clone.isPending ? clone.variables : null;

    const results = search.data?.pages.flatMap((page) => page.results) ?? [];
    const facets = search.data?.pages[0]?.facets ?? {};

    const searching = searchInput.trim().length > 0 || hasActiveFilters(filters);
    const browsing = !searching && !browseDismissed;

    // Write the next criteria to the URL via the Next-integrated history API (no server round-trip per
    // keystroke). The field carries `searchInput` (immediate), so a URL write never lags the input.
    const applyCriteria = useCallback(
        (nextFilters: RecipeFilterState, nextQuery: string) => {
            const qs = filtersToQueryString(nextFilters, nextQuery);
            window.history.replaceState(null, '', qs.length > 0 ? `${pathname}?${qs}` : pathname);
        },
        [pathname],
    );

    const onSearchChange = useCallback(
        (value: string) => {
            setSearchInput(value);
            applyCriteria(filters, value);
        },
        [applyCriteria, filters],
    );

    const cuisines: readonly RecipeBrowseCuisineShortcut[] = (facets.cuisine ?? []).map((facet) => ({
        value: facet.value,
        onSelect: () => applyCriteria(setCuisine(filters, facet.value), searchInput),
    }));

    return (
        <RecipeDiscoveryList
            status={status}
            results={results}
            searchValue={searchInput}
            onSearchChange={onSearchChange}
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
            recentSearches={{
                queries: recentSearches.queries,
                // Selecting one is exactly a search change: the field echoes it immediately, the URL is
                // updated (shareable), and the debounce feeds it to the query — no second code path.
                onSelect: onSearchChange,
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
                        onSelectRecipe={(id) => router.push(`/${locale}/recipes/${id}` as Route)}
                        onClone={(id) =>
                            clone.mutate(id, {
                                onSuccess: (recipe) => router.push(`/${locale}/recipes/${recipe.id}` as Route),
                            })
                        }
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
                        applyCriteria(toggleFacetValue(filters, dimension, value), searchInput)
                    }
                    onSetCuisine={(cuisine) => applyCriteria(setCuisine(filters, cuisine), searchInput)}
                    onSetMaxPrepTime={(minutes) => applyCriteria(setMaxPrepTime(filters, minutes), searchInput)}
                    onSetMaxCookTime={(minutes) => applyCriteria(setMaxCookTime(filters, minutes), searchInput)}
                    onSetMaxTotalTime={(minutes) => applyCriteria(setMaxTotalTime(filters, minutes), searchInput)}
                    ingredientSearch={{
                        query: ingredientSearch.query,
                        onQueryChange: ingredientSearch.setQuery,
                        viewState: ingredientSearch.viewState,
                    }}
                    onAddIngredientFilter={(ingredient) =>
                        applyCriteria(addIngredientFilter(filters, ingredient), searchInput)
                    }
                    onRemoveIngredientFilter={(id) => applyCriteria(removeIngredientFilter(filters, id), searchInput)}
                    onClearAll={() => applyCriteria(clearRecipeFilters(), searchInput)}
                />
            }
        />
    );
};
