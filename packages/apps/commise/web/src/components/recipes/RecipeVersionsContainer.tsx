'use client';

/**
 * Container for the recipe version-history route: binds the shared, presentational `RecipeVersionList`
 * building block to live data. It reads the recipe's versions via `useRecipeVersions(id)` and the recipe's
 * current version via `useRecipe(id)` (the block marks that version and makes it non-restorable), and wires
 * the restore action to `useRestoreRecipeVersion`. The fetch-state affordances (loading, error with retry)
 * belong to the app and are localized through the web dictionary; the block owns the list + empty states.
 * The row being restored is busied via `restoringVersion`, with the mutation carrying `{ id, versionNumber }`.
 * It holds no server data of its own — TanStack Query is the source of truth for the remote version list.
 * Wires `onBack` (V6) to navigate to the recipe-detail route — the web parity fix for the native
 * `RecipeVersionsScreen`, which already receives its own `onBack` from its navigator.
 */
import { RecipeVersionList, type RecipeVersionRestoreError } from '@commise/features-recipes';
import { useMessages } from '@commise/i18n/react';
import { isVersionConflictError } from '@kitchensink/recipe-service-client';
import { useRecipe, useRecipeVersions, useRestoreRecipeVersion } from '@kitchensink/recipe-service-client/hooks';
import type { Route } from 'next';
import { useParams, useRouter } from 'next/navigation';
import type { FC } from 'react';

import { webMessages } from '@/i18n/messages';

/** Props for {@link RecipeVersionsContainer}. */
export interface RecipeVersionsContainerProps {
    /** The recipe id from the `[id]` route segment. */
    readonly recipeId: string;
}

/**
 * The live recipe version-history container.
 *
 * @param props - The recipe id whose version history to load.
 * @returns The wired {@link RecipeVersionList}, or a localized loading / error affordance.
 */
export const RecipeVersionsContainer: FC<RecipeVersionsContainerProps> = ({ recipeId }) => {
    const { recipes } = useMessages(webMessages);
    const { locale } = useParams<{ locale: string }>();
    const router = useRouter();
    const versionsQuery = useRecipeVersions(recipeId);
    const recipeQuery = useRecipe(recipeId);
    const restore = useRestoreRecipeVersion();

    if (versionsQuery.isLoading || recipeQuery.isLoading) {
        return <div role="status" aria-label={recipes.versions.loadingLabel} />;
    }

    if (versionsQuery.isError || recipeQuery.isError) {
        return (
            <div role="alert">
                <p>{recipes.versions.errorTitle}</p>
                <button
                    type="button"
                    onClick={() => {
                        void versionsQuery.refetch();
                        void recipeQuery.refetch();
                    }}
                >
                    {recipes.versions.retry}
                </button>
            </div>
        );
    }

    if (versionsQuery.data === undefined || recipeQuery.data === undefined) {
        // Enabled queries that are neither loading nor errored should have data; guard defensively so a
        // transient undefined never crashes the view.
        return <div role="status" aria-label={recipes.versions.loadingLabel} />;
    }

    const restoringVersion = restore.isPending ? restore.variables.versionNumber : null;

    // B17 — a failed restore must never silently no-op. Map the mutation's error to an honest code: a 409 is
    // the recipe changing underneath (someone saved a new version), so the copy tells the viewer to review the
    // refreshed list; anything else is generic. The banner clears on the next restore attempt.
    const restoreError: RecipeVersionRestoreError | undefined =
        restore.error === null || restore.error === undefined
            ? undefined
            : isVersionConflictError(restore.error)
              ? 'conflict'
              : 'generic';

    return (
        <RecipeVersionList
            versions={versionsQuery.data}
            currentVersion={recipeQuery.data.currentVersion}
            restoringVersion={restoringVersion}
            restoreError={restoreError}
            onBack={() => router.push(`/${locale}/recipes/${recipeId}` as Route)}
            onRestore={(versionNumber) =>
                restore.mutate(
                    { id: recipeId, versionNumber },
                    {
                        // On a conflict the local history + current version are stale — refetch so the viewer
                        // sees the version that landed before they retry (the block marks the new current).
                        onError: (error) => {
                            if (isVersionConflictError(error)) {
                                void versionsQuery.refetch();
                                void recipeQuery.refetch();
                            }
                        },
                    },
                )
            }
        />
    );
};
