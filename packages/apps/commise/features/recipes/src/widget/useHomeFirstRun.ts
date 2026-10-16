'use client';

import { recipeServiceKeys } from '@kitchensink/recipe-service-client';

import { useLibraryEmpty } from '../hooks/useLibraryEmpty.js';
import { RECENT_RECIPE_LIMIT } from './recentRecipeLimit.js';

/**
 * Whether Home is on its first run: the recent-recipes page the widget reads has settled empty in the cache (§3.4).
 * Read from the cache, never fetched, so it adds no request beside the widget's own. The key is the one
 * {@link recentRecipesQuery} caches under (pinned by its suite), because this runs outside the widget's boundary and
 * has no client to ask.
 *
 * @returns `true` only for a settled read of no recipes.
 */
export function useHomeFirstRun(): boolean {
    return useLibraryEmpty(recipeServiceKeys.recipeList({ pageSize: RECENT_RECIPE_LIMIT }));
}
