'use client';

/**
 * @module @commise/features-recipes/versions — the recipe's title, read for the SETTLED version history's pinned bar, which
 * names its parent by it ("‹ Pasta e fagioli"; `docs/design/uiRefreshWorkshop5/pinnedBackBar.md` §4). Loading and failed do
 * not know the title yet and say `versionList.recipeParent` ("Recipe"), so only the settled branch calls this.
 *
 * It is the SAME suspense query `useRecipeVersions` reads (the recipe's detail), so under one read boundary it adds no
 * request: the pinned-bar frame sits outside the settled view and needs the title before the view renders.
 *
 * @sideEffect Reads the recipe through the query cache; suspends until it settles.
 */
import { recipeQueries } from '@kitchensink/recipe-service-client';
import { useRecipeServiceClient } from '@kitchensink/recipe-service-client/hooks';
import { useSuspenseQuery } from '@tanstack/react-query';

/**
 * The recipe's title.
 *
 * @param recipeId - The recipe the history belongs to.
 * @returns Its title.
 * @throws {Error} For an empty recipe id — a read that cannot be made fails into the boundary rather than issuing a
 *   request for `''` (B21: never a permanent spinner), as `useRecipeVersions` does.
 */
export function useRecipeTitle(recipeId: string): string {
    if (recipeId.length === 0) {
        throw new Error('A recipe version history needs a recipe id.');
    }

    const client = useRecipeServiceClient();

    return useSuspenseQuery(recipeQueries(client).detail(recipeId)).data.title;
}
