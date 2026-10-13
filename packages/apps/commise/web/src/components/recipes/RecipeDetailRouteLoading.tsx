'use client';

/**
 * @module components/recipes/RecipeDetailRouteLoading — the recipe page's loading state, localized: the shared
 * {@link RecipeDetailSkeleton} (D3; `buildSpec.md` §6.7) under the one name the page's own boundary uses.
 *
 * Both `recipes/[id]/loading.tsx` (a segment's server render resolving) and `RecipeDetailContainer`'s boundary (its query
 * resolving) render THIS, so the swap from one to the other moves nothing. A `loading.tsx` cannot read the dictionary on
 * its own, which is why this client component exists.
 *
 * Pure `props → JSX` (no props).
 */
import { RecipeDetailSkeleton } from '@commise/features-recipes';
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';

import { webMessages } from '@/i18n/messages';

/**
 * @returns The page-shaped skeleton, named "Loading recipe".
 */
export const RecipeDetailRouteLoading: FC = () => {
    const { recipes } = useMessages(webMessages);

    return <RecipeDetailSkeleton label={recipes.detail.loadingLabel} />;
};
