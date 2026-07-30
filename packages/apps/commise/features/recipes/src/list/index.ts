/**
 * @module @commise/features-recipes/list — platform-neutral barrel for the recipe-list building blocks
 * (T065). Each component specifier resolves to its web (`*.tsx`) or native (`*.native.tsx`) leaf at bundle
 * time; the model layer is platform-agnostic. The apps compose these into their recipe-list page/screen.
 */
export { RecipeList } from './RecipeList.js';
export { RecipeListCard } from './RecipeListCard.js';
export { RecipeSourceTabs } from './RecipeSourceTabs.js';
export type { RecipeSourceTabsProps } from './RecipeSourceTabs.js';

export {
    QUICK_TIME_FACET,
    QUICK_TIME_THRESHOLD_MINUTES,
    RECIPE_SOURCE_TABS,
    fillTemplate,
    filterChipLabel,
    formatDurationMinutes,
    formatRecipeCount,
    isListNarrowed,
    isQuickRecipe,
    matchesListFacet,
    sourceTabLabel,
    toRecipeListItem,
} from './model.js';
export type {
    RecipeCountLabels,
    RecipeFacetSource,
    RecipeListCardProps,
    RecipeListItem,
    RecipeListStatus,
    RecipeListTab,
    RecipeListTabControl,
    RecipeListViewProps,
} from './model.js';
