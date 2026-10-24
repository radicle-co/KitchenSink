'use client';

import { recipeServiceKeys } from '@kitchensink/recipe-service-client';

import { createEntryYields } from '../hooks/libraryState.js';
import { useRecipeLibraryState } from '../hooks/useRecipeLibraryState.js';
import { RECENT_RECIPE_LIMIT } from './recentRecipeLimit.js';

/**
 * Whether Home's floating create button yields (`docs/design/uiOverhaul/buildSpec.md` §3.4): while the recent-recipes
 * page the widget reads is still loading (the button never appears, so it cannot vanish under a first-run cook's
 * finger), and on the first run, whose own start buttons take its place. Offline or failed with nothing cached, it shows.
 * Read from the cache, never fetched, so it adds no request beside the widget's own. The key is the one
 * `recentRecipesQuery` (`recentRecipesQuery.ts`) caches under (pinned by its suite), because this runs outside the
 * widget's boundary and has no client to ask.
 *
 * @returns `true` while the button must not show.
 */
export function useHomeCreateEntryYields(): boolean {
    return createEntryYields(useRecipeLibraryState(recipeServiceKeys.recipeList({ pageSize: RECENT_RECIPE_LIMIT })));
}
