'use client';

/**
 * @module @commise/features-recipes/versions — the SETTLED version history's session, shared by web's
 * `RecipeVersionsContainer` and mobile's `RecipeVersionsScreen` (`docs/design/uiOverhaul/buildSpec.md` §6.6).
 *
 * It reads the recipe's versions and the recipe itself (for the authoritative current version, which the list marks and
 * makes non-restorable) with suspense queries, wires the restore, and derives the Preview and Compare props from the
 * ALREADY-LOADED list: every entry the list endpoint returns carries its own `snapshot`, so opening either makes no extra
 * fetch. The current version is by construction the highest number that exists (every write that changes it records a
 * new, higher-numbered row), so it is always inside the retention window and therefore always in the list; if that were
 * ever violated the "changed from current" line is OMITTED rather than fetched for a state that cannot occur today.
 *
 * The caller puts it under its own read boundary (`ClientQueryBoundary` / `QueryBoundary` live in `@commise/query`, which
 * this package may not import). Restore is ONE trigger for the list's row action and the preview's Restore, and says so
 * with an Undo that restores the version that was current before — itself without an Undo, since offering one would be a
 * loop of restores each undoing the last. A restore that fails with a 409 conflict refetches both reads, so the viewer
 * sees what landed before they retry.
 *
 * @pattern Headless hook — three prop bags (list, preview, compare) the platforms render
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { useSnackbar } from '@commise/ui/snackbar';
import { isVersionConflictError, recipeQueries } from '@kitchensink/recipe-service-client';
import { useRecipeServiceClient, useRestoreRecipeVersion } from '@kitchensink/recipe-service-client/hooks';
import { useSuspenseQueries } from '@tanstack/react-query';
import { useState } from 'react';

import { fillTemplate } from '../format/fillTemplate.js';
import { recipeMessages } from '../messages.js';
import { compareWithCurrent, type VersionCompareViewProps } from './compare.js';
import { classifyRestoreError, type RecipeVersionListProps } from './history.js';
import { recipeVersionMessages } from './messages.js';
import { resolveVersionPreview, type VersionPreviewModalProps } from './preview.js';

/** What {@link useRecipeVersions} reads. */
export interface RecipeVersionsInput {
    /** The recipe whose history to show. */
    readonly recipeId: string;
}

/** What a restore does beyond restoring. */
interface RestoreOptions {
    /** Runs once the restore has landed (the preview closes). */
    readonly onRestored?: () => void;
    /** Whether the snackbar that follows offers Undo. False for the restore an Undo makes. */
    readonly undoable?: boolean;
}

/** The three prop bags the version history renders. */
export interface RecipeVersionsSession {
    /** The list's props, minus the way back — the platform adds its own (web: the header's link; mobile: the screen's). */
    readonly list: Omit<RecipeVersionListProps, 'onBack' | 'backHref'>;
    readonly preview: VersionPreviewModalProps;
    readonly compare: VersionCompareViewProps;
}

/**
 * The settled version history's session.
 *
 * @param input - The recipe id.
 * @returns The list, preview and compare props.
 * @throws {Error} For an empty recipe id — a read that cannot be made fails into the boundary rather than issuing a
 *   request for `''` (B21: never a permanent spinner).
 * @sideEffect Sends the restore request; shows a snackbar; refetches both reads after a conflict.
 */
export function useRecipeVersions({ recipeId }: RecipeVersionsInput): RecipeVersionsSession {
    if (recipeId.length === 0) {
        throw new Error('A recipe version history needs a recipe id.');
    }

    const locale = useLocale();
    const client = useRecipeServiceClient();
    const [versionsQuery, recipeQuery] = useSuspenseQueries({
        queries: [recipeQueries(client).versions(recipeId), recipeQueries(client).detail(recipeId)],
    });
    const restore = useRestoreRecipeVersion();
    // Preview: which version (by number) is being previewed, or `null` when the modal is closed.
    const [previewTarget, setPreviewTarget] = useState<number | null>(null);
    // Compare is per row, against the current version: which version (by number) is open, or `null`.
    const [compareTarget, setCompareTarget] = useState<number | null>(null);
    // "Edited 2 days ago" is measured from the moment the history was read, held so the render stays pure.
    const [now] = useState(() => new Date().toISOString());
    const snackbar = useSnackbar();
    const { versionList } = useMessages(recipeVersionMessages);
    const { ingredientLineName } = useMessages(recipeMessages);

    const versions = versionsQuery.data;
    const recipe = recipeQuery.data;
    const restoringVersion = restore.isPending ? (restore.variables?.versionNumber ?? null) : null;

    // B17 — a failed restore must never silently no-op. The shared classifier maps the mutation's error to an honest
    // code for the version it targeted: a 409 conflict, a refusal naming the lines it cannot restore (plan 002 R52), or
    // generic. The banner clears on the next restore attempt.
    const restoreError = classifyRestoreError(restore.error, restore.variables?.versionNumber);

    const restoreVersion = (versionNumber: number, options: RestoreOptions = {}): void => {
        const { onRestored, undoable = true } = options;
        const wasCurrent = recipe.currentVersion;

        restore.mutate(
            { id: recipeId, versionNumber },
            {
                onSuccess: () => {
                    onRestored?.();
                    snackbar.show({
                        message: fillTemplate(versionList.restored, { version: versionNumber }),
                        ...(undoable
                            ? {
                                  action: {
                                      label: versionList.undo,
                                      onAction: () => restoreVersion(wasCurrent, { undoable: false }),
                                  },
                              }
                            : {}),
                    });
                },
                // On a conflict the local history and current version are stale — refetch so the viewer sees the
                // version that landed before they retry.
                onError: (error) => {
                    if (isVersionConflictError(error)) {
                        void versionsQuery.refetch();
                        void recipeQuery.refetch();
                    }
                },
            },
        );
    };

    // B21: the whole preview derivation — including the FAILED-LOOKUP report a preview target the history no longer
    // contains must produce — lives in the shared `resolveVersionPreview`, so the platforms cannot drift from it.
    const preview = resolveVersionPreview({
        previewTarget,
        versions,
        currentVersion: recipe.currentVersion,
        restoringVersion,
    });

    // §6.6 — Compare: both snapshots come from the already-loaded list (no fetch).
    const compareVersion = versions.find((version) => version.versionNumber === compareTarget);
    const currentEntry = versions.find((version) => version.versionNumber === recipe.currentVersion);
    const compareDiff =
        compareVersion !== undefined && currentEntry !== undefined
            ? compareWithCurrent(compareVersion, currentEntry, locale, ingredientLineName)
            : undefined;

    return {
        list: {
            versions,
            currentVersion: recipe.currentVersion,
            restoringVersion,
            restoreError,
            now,
            recipeTitle: recipe.title,
            onRestore: (versionNumber) => restoreVersion(versionNumber),
            onPreview: (versionNumber) => setPreviewTarget(versionNumber),
            ...(currentEntry === undefined
                ? {}
                : { onCompare: (versionNumber: number) => setCompareTarget(versionNumber) }),
        },
        preview: {
            ...preview,
            locale,
            ...(restoreError === undefined ? {} : { restoreError }),
            onCancel: () => setPreviewTarget(null),
            onRestore: (versionNumber) => restoreVersion(versionNumber, { onRestored: () => setPreviewTarget(null) }),
        },
        compare: {
            open: compareDiff !== undefined,
            ...(compareVersion === undefined ? {} : { version: compareVersion }),
            ...(compareDiff === undefined ? {} : { diff: compareDiff }),
            onClose: () => setCompareTarget(null),
        },
    };
}
