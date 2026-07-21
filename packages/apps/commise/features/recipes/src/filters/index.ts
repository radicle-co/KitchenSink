/**
 * @module @commise/features-recipes/filters — platform-neutral barrel for the recipe filter bar (FR-006).
 * The `RecipeFilterBar` specifier resolves to its web (`*.tsx`) or native (`*.native.tsx`) leaf at bundle
 * time; the model + message layers are platform-agnostic. The apps compose the bar into their search surface
 * alongside the discovery list, projecting the search response's `facets` and the URL/component filter state
 * onto its props.
 */
export { RecipeFilterBar } from './RecipeFilterBar.js';

export {
    EMPTY_RECIPE_FILTERS,
    TIME_BUCKETS_MINUTES,
    TOTAL_TIME_BUCKETS_MINUTES,
    buildFacetChips,
    clearRecipeFilters,
    countActiveFilters,
    filtersFromQueryString,
    filtersToQueryString,
    filtersToSearchParams,
    formatFacetChipName,
    hasActiveFilters,
    setCuisine,
    setMaxPrepTime,
    setMaxTotalTime,
    toggleFacetValue,
} from './model.js';
export type {
    FacetDimension,
    RecipeFacetChip,
    RecipeFacets,
    RecipeFilterBarProps,
    RecipeFilterState,
} from './model.js';

export { filterMessages } from './messages.js';
export type { FilterMessages } from './messages.js';
