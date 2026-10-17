/**
 * Recipe version-history screen (mobile, T069): the screen's read boundary around the shared `RecipeVersionsView`. The view
 * reads the history and the recipe (for the authoritative current version, which the list marks as non-restorable) with
 * suspense queries, drives the shared native `RecipeVersionList`, the Preview full-screen modal and the two-version Compare
 * sheet, and wires each restore action to `useRestoreRecipeVersion`; the session behind it (`useRecipeVersions`) is shared
 * with the web container, and its module docs carry the Preview, Compare and restore rationale.
 *
 * What stays here is what is mobile's: the boundary owns the localized loading state and the failure (whose retry
 * refetches), and Back is drawn by the list's own header in every state. The restore invalidates the recipe and its
 * versions, so the list refreshes itself.
 */
import { RecipeVersionListError, RecipeVersionListSkeleton, recipeVersionMessages } from '@commise/features-recipes';
import { RecipeVersionsView } from '@commise/features-recipes/versions';
import { useMessages } from '@commise/i18n/react';
import { QueryBoundary } from '@commise/query/boundary';
import type { JSX } from 'react';

/** Props for {@link RecipeVersionsScreen}. */
export interface RecipeVersionsScreenProps {
    /** The id of the recipe whose versions to show. */
    readonly recipeId: string;
    /** Invoked when the back affordance is activated. */
    readonly onBack: () => void;
}

/**
 * The recipe version-history screen.
 *
 * @param props - The recipe id and the back callback.
 * @returns Back, above the read boundary: the loading and error states, or the version history once both reads
 *   settle.
 */
export function RecipeVersionsScreen({ recipeId, onBack }: RecipeVersionsScreenProps): JSX.Element {
    const { versionList } = useMessages(recipeVersionMessages);

    return (
        <QueryBoundary
            loading={<RecipeVersionListSkeleton label={versionList.loading} onBack={onBack} />}
            renderError={({ resetErrorBoundary }) => (
                <RecipeVersionListError
                    title={versionList.loadError}
                    retryLabel={versionList.retry}
                    onRetry={resetErrorBoundary}
                    onBack={onBack}
                />
            )}
            resetKeys={[recipeId]}
        >
            <RecipeVersionsView recipeId={recipeId} onBack={onBack} />
        </QueryBoundary>
    );
}
