/**
 * @module @commise/features-recipes/discovery — platform-neutral barrel for the public discovery/browse
 * building block (T076): browse public recipes with search + per-row clone. Each component specifier
 * resolves to its web (`*.tsx`) or native (`*.native.tsx`) leaf at bundle time; the model + message layers
 * are platform-agnostic. The apps compose this into their public discovery page/screen.
 */
export { RecipeDiscoveryList } from './RecipeDiscoveryList.js';
export { RecipeDiscoveryCard } from './RecipeDiscoveryCard.js';
export { RecipeBrowseRails } from './RecipeBrowseRails.js';

export {
    DISCOVERY_SORTS,
    DISCOVERY_SEARCH_DEBOUNCE_MS,
    RECIPE_BROWSE_RAILS,
    RECIPE_BROWSE_RAIL_PAGE_SIZE,
} from './model.js';
export {
    MAX_RECENT_SEARCHES,
    RECENT_SEARCHES_STORAGE_KEY,
    addRecentSearch,
    mergeRecentSearches,
    parseRecentSearches,
    serializeRecentSearches,
} from './recentSearches.js';
export type { RecentSearchStore } from './recentSearches.js';

export type {
    RecipeDiscoveryCardProps,
    RecipeDiscoveryListProps,
    RecipeDiscoveryStatus,
    RecipeDiscoverySortControl,
    RecipeRecentSearchesControl,
    RecipeBrowseRailId,
    RecipeBrowseRailDefinition,
    RecipeBrowseRailView,
    RecipeBrowseCuisineShortcut,
    RecipeBrowseRailsProps,
} from './model.js';

export { discoveryMessages } from './messages.js';
export type { DiscoveryMessages } from './messages.js';
