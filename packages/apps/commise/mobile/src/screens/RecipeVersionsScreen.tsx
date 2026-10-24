/**
 * Recipe version-history screen (mobile, T069): the screen's read boundary around the shared `RecipeVersionsView`. The view
 * reads the history and the recipe (for the authoritative current version, which the list marks as non-restorable) with
 * suspense queries, drives the shared native `RecipeVersionList`, the Preview full-screen modal and the two-version Compare
 * sheet, and wires each restore action to `useRestoreRecipeVersion`; the session behind it (`useRecipeVersions`) is shared
 * with the web container, and its module docs carry the Preview, Compare and restore rationale.
 *
 * What stays here is what is mobile's: the boundary owns the localized loading state and the failure (whose retry
 * refetches), and the way back. Back is the pinned bar's (`PushedPageFrame`, `docs/design/uiRefreshWorkshop5/
 * pinnedBackBar.md`), and EVERY branch of the boundary mounts its own frame with the same Back in the same place: the bar
 * cannot be lifted out of the boundary, because the title lives only in the loading and settled states, and the cost is
 * that the bar remounts when the loading state settles. The frame also gives the settled history the scroller it did not
 * have, so a long history can be scrolled. The restore invalidates the recipe and its versions, so the list refreshes itself.
 *
 * ORCHESTRATION: the boundary, the three frames and the navigator's way back meet here.
 *
 * @pattern Facade — one screen over the shared version-history session, in the shared pushed-page frame
 */
import { RecipeVersionListError, RecipeVersionListSkeleton, recipeVersionMessages } from '@commise/features-recipes';
import { RecipeVersionsView, useRecipeTitle } from '@commise/features-recipes/versions';
import { useMessages } from '@commise/i18n/react';
import { QueryBoundary } from '@commise/query/boundary';
import { PushedPageFrame } from '@commise/ui/pushed-page';
import { useId, type JSX, type ReactNode } from 'react';
import { ScrollView, StyleSheet } from 'react-native';

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
 * @returns The read boundary, each of whose branches — loading, failed and settled — sits in the pinned-page frame.
 */
export function RecipeVersionsScreen({ recipeId, onBack }: RecipeVersionsScreenProps): JSX.Element {
    const { versionList } = useMessages(recipeVersionMessages);
    const headingId = useId();
    // The same frame in every branch, so Back is at the same place in loading, failed and settled. Its parent says "Recipe"
    // until the settled read knows the recipe's title.
    const framed = (content: ReactNode, parent: string = versionList.recipeParent): JSX.Element => (
        <PushedPageFrame
            back={{ label: versionList.backToRecipe, parent, onPress: onBack }}
            headingId={headingId}
            title={versionList.heading}
        >
            {(bind, inset) => (
                <ScrollView
                    {...bind}
                    style={styles.region}
                    contentContainerStyle={inset}
                    keyboardShouldPersistTaps="handled"
                >
                    {content}
                </ScrollView>
            )}
        </PushedPageFrame>
    );

    return (
        <QueryBoundary
            loading={framed(<RecipeVersionListSkeleton label={versionList.loading} />)}
            renderError={({ resetErrorBoundary }) =>
                framed(
                    <RecipeVersionListError
                        title={versionList.loadError}
                        retryLabel={versionList.retry}
                        onRetry={resetErrorBoundary}
                    />,
                )
            }
            resetKeys={[recipeId]}
        >
            <SettledVersions recipeId={recipeId} framed={framed} />
        </QueryBoundary>
    );
}

/** What {@link SettledVersions} needs: the recipe and the screen's frame. */
interface SettledVersionsProps {
    readonly recipeId: string;
    /** The screen's frame, given the content and the parent's name. */
    readonly framed: (content: ReactNode, parent: string) => JSX.Element;
}

/**
 * The settled history in the screen's frame, whose bar names the recipe by its title.
 *
 * @param props - The recipe id and the frame.
 * @returns The framed history.
 */
function SettledVersions({ recipeId, framed }: SettledVersionsProps): JSX.Element {
    const title = useRecipeTitle(recipeId);

    return framed(<RecipeVersionsView recipeId={recipeId} />, title);
}

const styles = StyleSheet.create({
    region: { flex: 1 },
});
