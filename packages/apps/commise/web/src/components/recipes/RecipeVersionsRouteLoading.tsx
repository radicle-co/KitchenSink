'use client';

/**
 * @module components/recipes/RecipeVersionsRouteLoading — the version history's loading state, localized: the shared
 * {@link RecipeVersionListSkeleton} (D3; `buildSpec.md` §6.6 "Loading: 3 skeleton rows") with its way back to the recipe.
 *
 * Both `recipes/[id]/versions/loading.tsx` and `RecipeVersionsContainer`'s boundary render THIS, so the swap moves
 * nothing. It reads the route's own params, as the container does, because a `loading.tsx` is given none.
 *
 * Pure `props → JSX` (no props); the navigation is the router's.
 */
import { RecipeVersionListSkeleton, recipeVersionMessages } from '@commise/features-recipes';
import { useMessages } from '@commise/i18n/react';
import type { Route } from 'next';
import { useParams, useRouter } from 'next/navigation';
import type { FC } from 'react';

/**
 * @returns The header, one polite status and three placeholder rows.
 */
export const RecipeVersionsRouteLoading: FC = () => {
    const { versionList } = useMessages(recipeVersionMessages);
    const { locale, id } = useParams<{ locale: string; id: string }>();
    const router = useRouter();
    const recipeHref = `/${locale}/recipes/${id}`;

    return (
        <RecipeVersionListSkeleton
            label={versionList.loading}
            onBack={() => router.push(recipeHref as Route)}
            backHref={recipeHref}
        />
    );
};
