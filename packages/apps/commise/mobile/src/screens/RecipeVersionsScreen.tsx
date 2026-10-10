/**
 * Recipe version-history screen (mobile, T069). Reads the history and the recipe (for the authoritative current
 * version, which the list marks as non-restorable) with suspense queries under a `QueryBoundary`, drives the shared
 * native `RecipeVersionList` once both settle, and wires each restore action to `useRestoreRecipeVersion`. The
 * mutation's in-flight `variables` drive the per-row busy state, so exactly the version being restored shows
 * progress. The boundary owns the localized loading state and the failure (whose retry refetches); Back sits above
 * it, in the same place in every state. The restore invalidates the recipe and its versions, so the list refreshes
 * itself.
 *
 * W6 Task 5 additionally wires the Preview full-screen modal and the two-version Compare full-screen sheet —
 * mirroring the web container's wiring EXACTLY (`RecipeVersionsContainer.tsx`, whose module docs carry the
 * fuller rationale, shared verbatim here): Preview/Compare read snapshots straight off the already-loaded
 * history (no extra fetch); the "changed from current" line gracefully omits itself if the
 * current version were ever NOT in that list (structurally unreachable today — see the web container's
 * docs); the preview modal's Restore reflects the restore mutation's own pending state for the previewed
 * version (no double-submit); and the Compare selection is capped at two, disabling every other row's
 * checkbox once two are picked, rather than silently evicting the oldest pick.
 */
import {
    RecipeVersionList,
    VersionCompareView,
    VersionPreviewModal,
    classifyRestoreError,
    compareWithCurrent,
    recipeMessages,
    recipeVersionMessages,
    resolveVersionPreview,
} from '@commise/features-recipes';
import { useSnackbar } from '@commise/ui/snackbar';
import { useLocale, useMessages } from '@commise/i18n/react';
import { QueryBoundary } from '@commise/query/boundary';
import { Button } from '@commise/ui/button';
import { isVersionConflictError, recipeQueries } from '@kitchensink/recipe-service-client';
import { useRecipeServiceClient, useRestoreRecipeVersion } from '@kitchensink/recipe-service-client/hooks';
import { useSuspenseQueries } from '@tanstack/react-query';
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
 * @returns Back, above the read boundary: the loading and error states, or the version history once both reads
 *   settle.
 */
export function RecipeVersionsScreen({ recipeId, onBack }: RecipeVersionsScreenProps): JSX.Element {
    const { recipes: t } = useMessages(mobileMessages);

    return (
        <View style={styles.container}>
            <Pressable accessibilityRole="button" accessibilityLabel={t.back} onPress={onBack}>
                <Text>{t.back}</Text>
            </Pressable>
            <QueryBoundary
                loading={<LoadingState label={t.versionsLoading} />}
                renderError={({ resetErrorBoundary }) => (
                    <View style={styles.center}>
                        <Text accessibilityRole="alert">{t.versionsError}</Text>
                        <Button variant="secondary" icon="refreshCw" onPress={resetErrorBoundary}>
                            {t.versionsRetry}
                        </Button>
                    </View>
                )}
                resetKeys={[recipeId]}
            >
                <RecipeVersionsView recipeId={recipeId} />
            </QueryBoundary>
        </View>
    );
}

/**
 * The settled version history: both reads have resolved by the time this renders, so it holds no fetch state.
 *
 * @param props - The recipe id.
 * @returns The version list, the Preview modal and the Compare sheet.
 * @throws {Error} For an empty recipe id — a read that cannot be made fails into the boundary rather than issuing
 *   a request for `''` (B21: never a permanent spinner).
 */
function RecipeVersionsView({ recipeId }: Pick<RecipeVersionsScreenProps, 'recipeId'>): JSX.Element {
    if (recipeId.length === 0) {
        throw new Error('A recipe version history needs a recipe id.');
    }

    const locale = useLocale();
    const client = useRecipeServiceClient();
    const [versions, recipe] = useSuspenseQueries({
        queries: [recipeQueries(client).versions(recipeId), recipeQueries(client).detail(recipeId)],
    });
    const restore = useRestoreRecipeVersion();

    // W6 Task 5 — Preview: which version (by number) is being previewed, or `null` when the modal is closed.
    const [previewTarget, setPreviewTarget] = useState<number | null>(null);
    // §6.6 — Compare is per row, against the current version: which version (by number) is open, or `null`.
    const [compareTarget, setCompareTarget] = useState<number | null>(null);
    // "Edited 2 days ago" is measured from the moment the history was read, held so the render stays pure.
    const [now] = useState(() => new Date().toISOString());
    const snackbar = useSnackbar();
    const { versionList } = useMessages(recipeVersionMessages);
    const { ingredientLineName } = useMessages(recipeMessages);

    const versionRows = versions.data;
    const currentRecipe = recipe.data;
    const restoringVersion = restore.isPending ? (restore.variables?.versionNumber ?? null) : null;

    // B17 — a failed restore must never silently no-op. The shared classifier (the web container uses the same one)
    // maps the mutation's error to an honest code for the version it targeted: a 409 conflict, a refusal naming the
    // lines it cannot restore (plan 002 R52), or generic. The banner clears on the next restore attempt.
    const restoreError = classifyRestoreError(restore.error, restore.variables?.versionNumber);

    /** Shared restore trigger for BOTH the list's row action and the preview modal's Restore action — same
     *  mutation, same B17 conflict-refetch; `onRestored` (only supplied from the preview modal) additionally
     *  closes the modal once the restore actually lands. A restore makes a NEW version, so it asks no confirmation:
     *  the snackbar's Undo restores the version that was current before, which makes another (§6.6). */
    const restoreVersion = (versionNumber: number, onRestored?: () => void): void => {
        const wasCurrent = recipe.data.currentVersion;

        restore.mutate(
            { id: recipeId, versionNumber },
            {
                onSuccess: () => {
                    onRestored?.();
                    snackbar.show({
                        message: versionList.restored.replace('{version}', String(versionNumber)),
                        action: { label: versionList.undo, onAction: () => restoreVersion(wasCurrent) },
                    });
                },
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
    // the module docs / the web container's `RecipeVersionsContainer.tsx` for the fuller rationale. B21: the
    // preview's whole derivation — including the FAILED-LOOKUP report a preview target the history no longer
    // contains must produce — lives in the shared `resolveVersionPreview`, so web cannot drift from it.
    const preview = resolveVersionPreview({
        previewTarget,
        versions: versionRows,
        currentVersion: currentRecipe.currentVersion,
        restoringVersion,
    });

    // §6.6 — Compare: both snapshots come from the already-loaded list (no fetch).
    const compareVersion = versionRows.find((version) => version.versionNumber === compareTarget);
    const currentEntry = versionRows.find((version) => version.versionNumber === currentRecipe.currentVersion);
    const compareDiff =
        compareVersion !== undefined && currentEntry !== undefined
            ? compareWithCurrent(compareVersion, currentEntry, locale, ingredientLineName)
            : undefined;

    return (
        <>
            <RecipeVersionList
                versions={versionRows}
                currentVersion={currentRecipe.currentVersion}
                restoringVersion={restoringVersion}
                restoreError={restoreError}
                now={now}
                recipeTitle={currentRecipe.title}
                onRestore={(versionNumber) => restoreVersion(versionNumber)}
                onPreview={(versionNumber) => setPreviewTarget(versionNumber)}
                {...(currentEntry === undefined
                    ? {}
                    : { onCompare: (versionNumber: number) => setCompareTarget(versionNumber) })}
            />
            <VersionPreviewModal
                {...preview}
                locale={locale}
                {...(restoreError === undefined ? {} : { restoreError })}
                onCancel={() => setPreviewTarget(null)}
                onRestore={(versionNumber) => restoreVersion(versionNumber, () => setPreviewTarget(null))}
            />
            <VersionCompareView
                open={compareDiff !== undefined}
                {...(compareVersion === undefined ? {} : { version: compareVersion })}
                {...(compareDiff === undefined ? {} : { diff: compareDiff })}
                onClose={() => setCompareTarget(null)}
            />
        </>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
});
