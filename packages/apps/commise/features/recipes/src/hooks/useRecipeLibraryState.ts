'use client';

/**
 * @module @commise/features-recipes/hooks — the cook's recipe library state: {@link useLibraryState} over the recipe
 * library's family of reads. Home and My recipes read it.
 */
import { recipeServiceKeys } from '@kitchensink/recipe-service-client';
import type { QueryKey } from '@tanstack/react-query';

import { RECENT_RECIPE_LIMIT } from '../widget/recentRecipeLimit.js';
import type { LibraryCacheState } from './libraryState.js';
import { useLibraryState, type LibraryFamilyMember } from './useLibraryState.js';

/**
 * The recipe library's family: every whole-library read, whatever its sort (a prefix, so a new sort joins it), and Home's
 * recent page (exact). Search and filters are on the device, so neither is in a key. ⛔ Not the `recipeLists` prefix:
 * it also matches filtered pages and "load more" reads, whose totals are NARROWED and would call a populated library
 * empty.
 */
const RECIPE_LIBRARY_FAMILY: readonly LibraryFamilyMember[] = [
    { queryKey: recipeServiceKeys.recipeLibrary() },
    { queryKey: recipeServiceKeys.recipeList({ pageSize: RECENT_RECIPE_LIMIT }), exact: true },
];

/**
 * The state of the cook's recipe library (Home and My recipes).
 *
 * @param ownKey - The screen's own read: My recipes' library key, or Home's recent page.
 * @returns The library's state.
 */
export function useRecipeLibraryState(ownKey: QueryKey): LibraryCacheState {
    return useLibraryState(RECIPE_LIBRARY_FAMILY, ownKey);
}
