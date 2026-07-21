/**
 * @module @commise/features-recipes/discovery — platform-neutral barrel for the public discovery/browse
 * building block (T076): browse public recipes with search + per-row clone. Each component specifier
 * resolves to its web (`*.tsx`) or native (`*.native.tsx`) leaf at bundle time; the model + message layers
 * are platform-agnostic. The apps compose this into their public discovery page/screen.
 */
export { RecipeDiscoveryList } from './RecipeDiscoveryList.js';
export { RecipeDiscoveryCard } from './RecipeDiscoveryCard.js';

export { DISCOVERY_SORTS } from './model.js';
export type {
    RecipeDiscoveryCardProps,
    RecipeDiscoveryListProps,
    RecipeDiscoveryStatus,
    RecipeDiscoverySortControl,
} from './model.js';

export { discoveryMessages } from './messages.js';
export type { DiscoveryMessages } from './messages.js';
