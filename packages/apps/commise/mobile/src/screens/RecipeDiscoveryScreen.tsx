/**
 * Public-recipe discovery screen (mobile, T076 / US2 + FR-006). Drives the shared native `RecipeDiscoveryList`
 * + `RecipeFilterBar` building blocks from `useSearchRecipes`. Unlike web (URL-persisted), mobile holds the
 * search term and the active filters in component state — the platform edge — but feeds them through the SAME
 * shared pure model (`filtersToSearchParams`, `toggleFacetValue`, …), so the two platforms cannot drift on
 * filter semantics. The search response's `facets` drive the filter chips. Each row's Clone action runs
 * `useCloneRecipe`; the mutation's in-flight `variables` busy exactly that row. Remote state stays in the
 * query cache — the screen derives its view state and never copies it.
 */
import {
    RecipeDiscoveryList,
    RecipeFilterBar,
    clearRecipeFilters,
    filtersToSearchParams,
    hasActiveFilters,
    setMaxTotalTime,
    toggleFacetValue,
    EMPTY_RECIPE_FILTERS,
    type FacetDimension,
    type RecipeDiscoveryStatus,
    type RecipeFilterState,
} from '@commise/features-recipes';
import { RecipeSearchSortBy } from '@kitchensink/recipe-core';
import { useSearchRecipes, useCloneRecipe } from '@kitchensink/recipe-service-client/hooks';
import type { JSX } from 'react';
import { useState } from 'react';

/** Props for {@link RecipeDiscoveryScreen}. */
export interface RecipeDiscoveryScreenProps {
    /** Invoked with a recipe id when a discovery row is activated (the navigator opens its detail). */
    readonly onSelectRecipe: (id: string) => void;
    /**
     * Filters to pre-apply on first mount — e.g. a tag deep-link from a recipe detail (D6). Defaults to no
     * filters. This still runs through the SAME visibility-scoped `useSearchRecipes`, so a deep-linked tag
     * never surfaces a recipe the viewer couldn't otherwise see.
     */
    readonly initialFilters?: RecipeFilterState;
}

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

    const search = useSearchRecipes({ ...filtersToSearchParams(filters, searchValue), sortBy });
    const clone = useCloneRecipe();

    const status: RecipeDiscoveryStatus = search.isError ? 'error' : search.isLoading ? 'loading' : 'ready';
    const cloningId = clone.isPending ? (clone.variables ?? null) : null;

    return (
        <RecipeDiscoveryList
            status={status}
            results={search.data?.results ?? []}
            searchValue={searchValue}
            onSearchChange={setSearchValue}
            onSelectRecipe={onSelectRecipe}
            onClone={(id) => clone.mutate(id)}
            onRetry={() => void search.refetch()}
            cloningId={cloningId}
            hasActiveFilters={hasActiveFilters(filters)}
            sort={{ active: sortBy, onChange: setSortBy }}
            filterSlot={
                <RecipeFilterBar
                    facets={search.data?.facets ?? {}}
                    filters={filters}
                    onToggleFacet={(dimension: FacetDimension, value: string) =>
                        setFilters((current) => toggleFacetValue(current, dimension, value))
                    }
                    onSetMaxTotalTime={(minutes) => setFilters((current) => setMaxTotalTime(current, minutes))}
                    onClearAll={() => setFilters(clearRecipeFilters())}
                />
            }
        />
    );
}
