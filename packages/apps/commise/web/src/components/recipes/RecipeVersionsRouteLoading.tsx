'use client';

/**
 * @module components/recipes/RecipeVersionsRouteLoading — the version history's loading state, localized: the shared
 * {@link RecipeVersionListSkeleton} (D3; `buildSpec.md` §6.6 "Loading: 3 skeleton rows") with its way back to the recipe, in
 * the route's pinned-back-bar frame.
 *
 * Both `recipes/[id]/versions/loading.tsx` and `RecipeVersionsContainer`'s boundary render THIS, so the swap moves
 * nothing, and the frame is mounted here and nowhere else in the loading state: the skeleton draws the header's eyebrow
 * only. It reads the route's own params, as the container does, because a `loading.tsx` is given none.
 *
 * Pure `props → JSX` (no props); the navigation is the router's.
 */
import { RecipeVersionListSkeleton, recipeVersionMessages } from '@commise/features-recipes';
import { useMessages } from '@commise/i18n/react';
import { useParams } from 'next/navigation';
import type { FC } from 'react';

import { RecipeVersionsFrame, useRecipeVersionsNav } from '@/components/recipes/RecipeVersionsFrame';

/**
 * @returns The header, one polite status and three placeholder rows, under the pinned bar.
 */
export const RecipeVersionsRouteLoading: FC = () => {
    const { versionList } = useMessages(recipeVersionMessages);
    const { id } = useParams<{ id: string }>();
    const { recipeHref, goToRecipe } = useRecipeVersionsNav(id);

    return (
        <RecipeVersionsFrame recipeId={id}>
            <RecipeVersionListSkeleton label={versionList.loading} onBack={goToRecipe} backHref={recipeHref} />
        </RecipeVersionsFrame>
    );
};
