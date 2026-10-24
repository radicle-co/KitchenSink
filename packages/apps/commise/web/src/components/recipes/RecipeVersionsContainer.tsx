'use client';

/**
 * Container for the recipe version-history route (orchestration): the route's read boundary around the shared
 * {@link RecipeVersionsView}. The view reads the recipe's versions and the recipe itself (for its current version, which
 * the list marks and makes non-restorable) with suspense queries, wires the restore, the Preview modal and the two-version
 * Compare view, and holds no server data of its own — TanStack Query is the source of truth. The session behind it
 * (`useRecipeVersions`) is shared with the mobile screen; its module docs carry the Preview, Compare and restore rationale.
 *
 * What stays here is what is web's: the boundary owns the fetch-state affordances (loading, and an error whose retry
 * refetches), localized through the web dictionary, and it is the hydration-gated one because this route is not
 * server-prefetched — its server render was already the loading state, and a suspense read there would fetch on the
 * server. Back (V6) navigates to the recipe-detail route and is present in EVERY state (loading, error, populated).
 *
 * @pattern Facade — the route's boundary and navigation over the shared version-history view
 */
import { RecipeVersionListError, recipeVersionMessages } from '@commise/features-recipes';
import { RecipeVersionsView, useRecipeTitle } from '@commise/features-recipes/versions';
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';

import { ClientQueryBoundary } from '@/components/app/ClientQueryBoundary';
import { RecipeVersionsFrame, useRecipeVersionsNav } from '@/components/recipes/RecipeVersionsFrame';
import { RecipeVersionsRouteLoading } from '@/components/recipes/RecipeVersionsRouteLoading';

/** Props for {@link RecipeVersionsContainer}. */
export interface RecipeVersionsContainerProps {
    /** The recipe id from the `[id]` route segment. */
    readonly recipeId: string;
}

/** The version history's failed state: the same header, an alert and a retry. */
const VersionsError: FC<{ readonly onBack: () => void; readonly backHref: string; readonly onRetry: () => void }> = ({
    onBack,
    backHref,
    onRetry,
}) => {
    const { versionList } = useMessages(recipeVersionMessages);

    return (
        <RecipeVersionListError
            title={versionList.loadError}
            retryLabel={versionList.retry}
            onRetry={onRetry}
            onBack={onBack}
            backHref={backHref}
        />
    );
};

/**
 * The settled history in its frame: the bar names the recipe by its title, which only a settled read knows.
 *
 * @param props - The recipe id.
 * @returns The frame around the history.
 */
const SettledVersions: FC<RecipeVersionsContainerProps> = ({ recipeId }) => {
    const { recipeHref, goToRecipe } = useRecipeVersionsNav(recipeId);
    const title = useRecipeTitle(recipeId);

    return (
        <RecipeVersionsFrame recipeId={recipeId} parent={title}>
            <RecipeVersionsView recipeId={recipeId} onBack={goToRecipe} backHref={recipeHref} />
        </RecipeVersionsFrame>
    );
};

/**
 * The live recipe version-history container: the route's read boundary around {@link RecipeVersionsView}.
 *
 * @param props - The recipe id whose version history to load.
 * @returns The boundary: the loading and error states (each with its way back) and, once both reads settle, the
 *   version history.
 */
export const RecipeVersionsContainer: FC<RecipeVersionsContainerProps> = ({ recipeId }) => {
    const { recipeHref, goToRecipe } = useRecipeVersionsNav(recipeId);

    // The loading state's frame is `RecipeVersionsRouteLoading`'s own (`loading.tsx` renders it too); the failed and the
    // settled state each mount the same frame here, so the bar is the same bar, in the same place, in all three.
    return (
        <ClientQueryBoundary
            loading={<RecipeVersionsRouteLoading />}
            renderError={({ resetErrorBoundary }) => (
                <RecipeVersionsFrame recipeId={recipeId}>
                    <VersionsError onBack={goToRecipe} backHref={recipeHref} onRetry={resetErrorBoundary} />
                </RecipeVersionsFrame>
            )}
            resetKeys={[recipeId]}
        >
            <SettledVersions recipeId={recipeId} />
        </ClientQueryBoundary>
    );
};
