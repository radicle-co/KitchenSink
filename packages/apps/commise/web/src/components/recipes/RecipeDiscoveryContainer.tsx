'use client';

/**
 * Container for the public-discovery route (orchestration): the web host of the shared `DiscoveryScreen`
 * (`@commise/features-recipes/discovery`), which owns the frame, the search, the filters, the rails and the results
 * (`docs/design/uiOverhaul/buildSpec.md` §4.4–§4.6). This file supplies only what is the web's:
 *
 * - **The criteria live in the URL** (`?query=…&tags=…`, `useUrlCriteriaStore`), so a filtered view is shareable and
 *   survives reload.
 * - **The platform**: `ClientQueryBoundary` (`/discover` is server-prefetched with the URL's criteria, so the boundary
 *   opens before hydration when every prefetched key holds data), the hydration-gated calorie lookup, and `localStorage`
 *   for the recent searches.
 * - **Navigation**: a card is a link to `/{locale}/recipes/{id}` and is also opened with the router; the snackbar's Edit
 *   opens the copy.
 *
 * @pattern Adapter — the web host's criteria store and platform plugged into the shared discovery screen
 */
import { DiscoveryScreen } from '@commise/features-recipes/discovery';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import type { FC } from 'react';

import { webDiscoveryPlatform } from '@/components/recipes/webDiscoveryPlatform';
import { useUrlCriteriaStore } from '@/hooks/useUrlCriteriaStore';

/** Props for {@link RecipeDiscoveryContainer}. */
export interface RecipeDiscoveryContainerProps {
    /** The active route locale, used to build locale-prefixed navigation targets. */
    readonly locale: string;
}

/**
 * The live public-discovery container.
 *
 * @param props - The active locale.
 * @returns The shared discovery screen over the URL and the web platform.
 */
export const RecipeDiscoveryContainer: FC<RecipeDiscoveryContainerProps> = ({ locale }) => {
    const router = useRouter();
    const criteria = useUrlCriteriaStore();

    return (
        <DiscoveryScreen
            criteria={criteria}
            platform={webDiscoveryPlatform}
            onEditCopy={(copyId) => router.push(`/${locale}/recipes/${copyId}/edit` as Route)}
            onSelectRecipe={(id) => router.push(`/${locale}/recipes/${id}` as Route)}
            hrefOf={(recipeId) => `/${locale}/recipes/${recipeId}`}
        />
    );
};
