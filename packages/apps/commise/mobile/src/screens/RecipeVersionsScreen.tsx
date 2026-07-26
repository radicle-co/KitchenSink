/**
 * Recipe version-history screen (mobile, T069). Drives the shared native `RecipeVersionList` building block
 * from `useRecipeVersions` (the history) and `useRecipe` (for the authoritative current version, which the
 * list marks as non-restorable), and wires each restore action to `useRestoreRecipeVersion`. The mutation's
 * in-flight `variables` drive the per-row busy state, so exactly the version being restored shows progress.
 * Renders localized loading and error states until both queries resolve; the restore invalidates the recipe
 * and its versions, so the list refreshes itself.
 *
 * W6 Task 5 additionally wires the Preview full-screen modal and the two-version Compare full-screen sheet —
 * mirroring the web container's wiring EXACTLY (`RecipeVersionsContainer.tsx`, whose module docs carry the
 * fuller rationale, shared verbatim here): Preview/Compare read snapshots straight off the already-loaded
 * `useRecipeVersions` list (no extra fetch); the "changed from current" line gracefully omits itself if the
 * current version were ever NOT in that list (structurally unreachable today — see the web container's
 * docs); the preview modal's Restore reflects the restore mutation's own pending state for the previewed
 * version (no double-submit); and the Compare selection is capped at two, disabling every other row's
 * checkbox once two are picked, rather than silently evicting the oldest pick.
 */
import {
    RecipeVersionList,
    VersionCompareView,
    VersionPreviewModal,
    diffSnapshots,
    type RecipeVersionRestoreError,
} from '@commise/features-recipes';
import { useLocale, useMessages } from '@commise/i18n/react';
import type { RecipeVersion } from '@kitchensink/recipe-core';
import { isVersionConflictError } from '@kitchensink/recipe-service-client';
import { useRecipe, useRecipeVersions, useRestoreRecipeVersion } from '@kitchensink/recipe-service-client/hooks';
import { useState, type JSX } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { LoadingState } from '../components/LoadingState.js';
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
    const locale = useLocale();
    const recipe = useRecipe(recipeId);
    const versions = useRecipeVersions(recipeId);
    const restore = useRestoreRecipeVersion();

    // W6 Task 5 — Preview: which version (by number) is being previewed, or `null` when the modal is closed.
    const [previewTarget, setPreviewTarget] = useState<number | null>(null);
    // W6 Task 5 — Compare: the 0/1/2 version numbers currently selected for the compare sheet, in the order
    // they were picked (see `toggleCompare` for the cap-at-two UX this order feeds).
    const [compareSelection, setCompareSelection] = useState<readonly number[]>([]);

    const back = (
        <Pressable accessibilityRole="button" accessibilityLabel={t.back} onPress={onBack}>
            <Text>{t.back}</Text>
        </Pressable>
    );

    if (recipe.isLoading || versions.isLoading) {
        return <LoadingState label={t.versionsLoading} />;
    }

    if (recipe.isError || recipe.data === undefined || versions.isError || versions.data === undefined) {
        return (
            <View style={styles.center}>
                {back}
                <Text accessibilityRole="alert">{t.versionsError}</Text>
            </View>
        );
    }

    const versionRows = versions.data;
    const currentRecipe = recipe.data;
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

    /** Shared restore trigger for BOTH the list's row action and the preview modal's Restore action — same
     *  mutation, same B17 conflict-refetch; `onRestored` (only supplied from the preview modal) additionally
     *  closes the modal once the restore actually lands. */
    const restoreVersion = (versionNumber: number, onRestored?: () => void): void => {
        restore.mutate(
            { id: recipeId, versionNumber },
            {
                onSuccess: onRestored,
                // On a conflict the local history + current version are stale — refetch so the viewer sees
                // the version that landed before they retry.
                onError: (error) => {
                    if (isVersionConflictError(error)) {
                        void versions.refetch();
                        void recipe.refetch();
                    }
                },
            },
        );
    };

    // W6 Task 5 — Preview/Compare read snapshots straight off the already-loaded list (no extra fetch) — see
    // the module docs / the web container's `RecipeVersionsContainer.tsx` for the fuller rationale.
    const previewVersion =
        previewTarget === null ? undefined : versionRows.find((v) => v.versionNumber === previewTarget);
    const currentVersionInList = versionRows.find((v) => v.versionNumber === currentRecipe.currentVersion);
    const diffFromCurrent =
        previewVersion !== undefined && currentVersionInList !== undefined
            ? diffSnapshots(currentVersionInList.snapshot, previewVersion.snapshot)
            : undefined;
    const isRestoringPreview = restore.isPending && restore.variables?.versionNumber === previewTarget;

    const compareVersions = compareSelection
        .map((versionNumber) => versionRows.find((v) => v.versionNumber === versionNumber))
        .filter((version): version is RecipeVersion => version !== undefined);
    const [olderCompareVersion, newerCompareVersion] =
        compareVersions.length === 2
            ? [...compareVersions].sort((a, b) => a.versionNumber - b.versionNumber)
            : [undefined, undefined];
    const compareDiff =
        olderCompareVersion !== undefined && newerCompareVersion !== undefined
            ? diffSnapshots(olderCompareVersion.snapshot, newerCompareVersion.snapshot)
            : undefined;

    // Cap-at-two (W6 Task 5): once two versions are selected, `RecipeVersionList` disables every OTHER row's
    // checkbox rather than silently evicting the oldest pick; this handler's own `current.length >= 2` guard
    // is the defensive second half of that contract.
    const toggleCompare = (versionNumber: number): void => {
        setCompareSelection((current) => {
            if (current.includes(versionNumber)) {
                return current.filter((selected) => selected !== versionNumber);
            }

            return current.length >= 2 ? current : [...current, versionNumber];
        });
    };

    return (
        <View style={styles.container}>
            {back}
            <RecipeVersionList
                versions={versionRows}
                currentVersion={currentRecipe.currentVersion}
                restoringVersion={restoringVersion}
                restoreError={restoreError}
                selectedForCompare={compareSelection}
                onRestore={(versionNumber) => restoreVersion(versionNumber)}
                onPreview={(versionNumber) => setPreviewTarget(versionNumber)}
                onToggleCompare={toggleCompare}
            />
            <VersionPreviewModal
                open={previewTarget !== null}
                version={previewVersion}
                isLoading={false}
                diffFromCurrent={diffFromCurrent}
                isRestoring={isRestoringPreview}
                locale={locale}
                onCancel={() => setPreviewTarget(null)}
                onRestore={(versionNumber) => restoreVersion(versionNumber, () => setPreviewTarget(null))}
            />
            <VersionCompareView
                open={compareSelection.length === 2}
                versionA={olderCompareVersion}
                versionB={newerCompareVersion}
                diff={compareDiff}
                locale={locale}
                onClose={() => setCompareSelection([])}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
