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
import { RecipeVersionsView } from '@commise/features-recipes/versions';
import { useMessages } from '@commise/i18n/react';
import type { Route } from 'next';
import { useParams, useRouter } from 'next/navigation';
import type { FC } from 'react';

import { ClientQueryBoundary } from '@/components/app/ClientQueryBoundary';
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
 * The live recipe version-history container: the route's read boundary around {@link RecipeVersionsView}.
 *
 * @param props - The recipe id whose version history to load.
 * @returns The boundary: the loading and error states (each with its way back) and, once both reads settle, the
 *   version history.
 */
export const RecipeVersionsContainer: FC<RecipeVersionsContainerProps> = ({ recipeId }) => {
    const { locale } = useParams<{ locale: string }>();
    const router = useRouter();

    const recipeHref = `/${locale}/recipes/${recipeId}`;

    const goToRecipe = (): void => {
        router.push(recipeHref as Route);
    };

    return (
        <ClientQueryBoundary
            loading={<RecipeVersionsRouteLoading />}
            renderError={({ resetErrorBoundary }) => (
                <VersionsError onBack={goToRecipe} backHref={recipeHref} onRetry={resetErrorBoundary} />
            )}
            resetKeys={[recipeId]}
        >
            <RecipeVersionsView recipeId={recipeId} onBack={goToRecipe} backHref={recipeHref} />
        </ClientQueryBoundary>
    );
};
