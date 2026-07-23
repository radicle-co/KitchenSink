/**
 * Recipe version-history screen (mobile, T069). Drives the shared native `RecipeVersionList` building block
 * from `useRecipeVersions` (the history) and `useRecipe` (for the authoritative current version, which the
 * list marks as non-restorable), and wires each restore action to `useRestoreRecipeVersion`. The mutation's
 * in-flight `variables` drive the per-row busy state, so exactly the version being restored shows progress.
 * Renders localized loading and error states until both queries resolve; the restore invalidates the recipe
 * and its versions, so the list refreshes itself.
 */
import { RecipeVersionList, type RecipeVersionRestoreError } from '@commise/features-recipes';
import { useMessages } from '@commise/i18n/react';
import { isVersionConflictError } from '@kitchensink/recipe-service-client';
import { useRecipe, useRecipeVersions, useRestoreRecipeVersion } from '@kitchensink/recipe-service-client/hooks';
import type { JSX } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { mobileMessages } from '../i18n/messages.js';

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
 * @returns The loading, error, or populated version-history view.
 */
export function RecipeVersionsScreen({ recipeId, onBack }: RecipeVersionsScreenProps): JSX.Element {
    const { recipes: t } = useMessages(mobileMessages);
    const recipe = useRecipe(recipeId);
    const versions = useRecipeVersions(recipeId);
    const restore = useRestoreRecipeVersion();

    const back = (
        <Pressable accessibilityRole="button" accessibilityLabel={t.back} onPress={onBack}>
            <Text>{t.back}</Text>
        </Pressable>
    );

    if (recipe.isLoading || versions.isLoading) {
        return (
            <View accessibilityLabel={t.versionsLoading} style={styles.center}>
                <ActivityIndicator />
            </View>
        );
    }

    if (recipe.isError || recipe.data === undefined || versions.isError || versions.data === undefined) {
        return (
            <View style={styles.center}>
                {back}
                <Text accessibilityRole="alert">{t.versionsError}</Text>
            </View>
        );
    }

    const restoringVersion = restore.isPending ? (restore.variables?.versionNumber ?? null) : null;

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
        <View style={styles.container}>
            {back}
            <RecipeVersionList
                versions={versions.data}
                currentVersion={recipe.data.currentVersion}
                restoringVersion={restoringVersion}
                restoreError={restoreError}
                onRestore={(versionNumber) =>
                    restore.mutate(
                        { id: recipeId, versionNumber },
                        {
                            // On a conflict the local history + current version are stale — refetch so the
                            // viewer sees the version that landed before they retry.
                            onError: (error) => {
                                if (isVersionConflictError(error)) {
                                    void versions.refetch();
                                    void recipe.refetch();
                                }
                            },
                        },
                    )
                }
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
