/**
 * @module @commise/features-recipes/widget — what the Home recipe widget's host shares across web and mobile.
 *
 * A package-export entry (the one kind of barrel this repo keeps). The host slots stay in each app: the read is the
 * platform's (web resolves a promise under `next/dynamic`, mobile a suspense query under `React.lazy`), and so is the
 * navigation. What both need lives here.
 */
export { LIVE_CAPABILITIES } from './liveCapabilities.js';
export { RECENT_RECIPE_LIMIT } from './recentRecipeLimit.js';
export { useRecentRecipesNutrition } from './useRecentRecipesNutrition.js';
export { recentRecipesQuery } from './recentRecipesQuery.js';
export { useHomeFirstRun } from './useHomeFirstRun.js';
