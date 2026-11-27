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
import { commonMessages } from '@commise/features-core/common';
import { fillTemplate } from '@commise/i18n';
import { useLocale, useMessages } from '@commise/i18n/react';
import { useSnackbar } from '@commise/ui/snackbar';
import {
    isNotFoundError,
    isPrivateFoodsOnPublicRecipeError,
    isVersionConflictError,
    recipeQueries,
} from '@kitchensink/recipe-service-client';
import {
    recipeServiceKeys,
    useRecipeServiceClient,
    useRestoreRecipeVersion,
} from '@kitchensink/recipe-service-client/hooks';
import { useQueryClient, useSuspenseQueries } from '@tanstack/react-query';
import { useState } from 'react';

import { refusedLinesOf } from '../editor/refusedLinesOf.js';
import type { PrivateFoodsRefusalSheetProps } from '../editor/privateFoodsRefusalSheetProps.js';
import { recipeMessages } from '../messages.js';
import { compareWithCurrent, type VersionCompareViewProps } from './compare.js';
import { classifyRestoreError, type RecipeVersionListProps } from './history.js';
import { recipeVersionMessages } from './messages.js';
import { resolveVersionPreview, type VersionPreviewModalProps } from './preview.js';

/** What {@link useRecipeVersions} reads. */
export interface RecipeVersionsInput {
    /** The recipe whose history to show. */
    readonly recipeId: string;
    /** Open a food's page. Absent where the host has none; the refusal then lists the lines without the button's effect. */
    readonly onOpenFood?: (foodId: string) => void;
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
    /**
     * A restore the server refused because a line of that version uses a food only the cook can see (private foods spec
     * section 7): the lines named from the version's own lines, since the refusal carries only ids and positions. Absent
     * when nothing was refused.
     */
    readonly privateFoods?: Pick<PrivateFoodsRefusalSheetProps, 'lines' | 'onOpenFood' | 'onClose'>;
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
export function useRecipeVersions({ recipeId, onOpenFood }: RecipeVersionsInput): RecipeVersionsSession {
    if (recipeId.length === 0) {
        throw new Error('A recipe version history needs a recipe id.');
    }

    const locale = useLocale();
    const client = useRecipeServiceClient();
    const [versionsQuery, recipeQuery] = useSuspenseQueries({
        queries: [recipeQueries(client).versions(recipeId), recipeQueries(client).detail(recipeId)],
    });
    const queryClient = useQueryClient();
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
    const { undoGone, undoFailed } = useMessages(commonMessages);

    const versions = versionsQuery.data;
    const recipe = recipeQuery.data;
    const restoringVersion = restore.isPending ? (restore.variables?.versionNumber ?? null) : null;

    // B17 — a failed restore must never silently no-op. The shared classifier maps the mutation's error to an honest
    // code for the version it targeted: a 409 conflict, a refusal naming the lines it cannot restore (plan 002 R52), or
    // generic. The banner clears on the next restore attempt.
    // A refusal for a private food has its own sheet, so the list and the preview do not also show a generic error.
    const refusedFoods = isPrivateFoodsOnPublicRecipeError(restore.error) ? restore.error.lines : undefined;
    const restoreError =
        refusedFoods === undefined ? classifyRestoreError(restore.error, restore.variables?.versionNumber) : undefined;
    const refusedVersion = versions.find((version) => version.versionNumber === restore.variables?.versionNumber);

    /** What a failed Undo says: deleted, changed since, or failed for another reason (the change is still in place). */
    const undoMessageFor = (error: unknown): string => {
        if (isNotFoundError(error)) {
            return undoGone;
        }

        return isVersionConflictError(error) ? versionList.undoConflict : undoFailed;
    };

    const restoreVersion = (versionNumber: number, options: RestoreOptions = {}): void => {
        const { onRestored, undoable = true } = options;
        const wasCurrent = recipe.currentVersion;

        // `mutateAsync`, not callbacks on `mutate`: the snackbar's Undo can run after this screen unmounted, and
        // TanStack skips a `mutate` call's own callbacks then. A failure is not raised again: the observer's `error`
        // already feeds `restoreError`, so the rejection is handled here and nowhere else.
        const send = async (): Promise<void> => {
            try {
                await restore.mutateAsync({ id: recipeId, versionNumber });
            } catch (error: unknown) {
                // On a conflict the local history and current version are stale: mark the recipe and its history
                // stale by id (the history's key sits under the recipe's), so it also works once this screen is gone.
                if (isVersionConflictError(error)) {
                    void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.recipe(recipeId) });
                }

                // The first restore keeps its inline error. An Undo says what happened in the snackbar instead, and
                // clears that inline error first, since it would tell the wrong story (a no-op once the screen
                // is gone).
                if (!undoable) {
                    restore.reset();
                    snackbar.show({ message: undoMessageFor(error) });
                }

                return;
            }

            onRestored?.();
            snackbar.show({
                message: fillTemplate(versionList.restored, { version: versionNumber }),
                ...(undoable
                    ? {
                          action: {
                              label: versionList.undo,
                              onAction: () => {
                                  restoreVersion(wasCurrent, { undoable: false });
                              },
                          },
                      }
                    : {}),
            });
        };

        void send();
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
            onRestore: (versionNumber) => {
                restoreVersion(versionNumber);
            },
            onPreview: (versionNumber) => {
                setPreviewTarget(versionNumber);
            },
            ...(currentEntry === undefined
                ? {}
                : {
                      onCompare: (versionNumber: number) => {
                          setCompareTarget(versionNumber);
                      },
                  }),
        },
        preview: {
            ...preview,
            locale,
            ...(restoreError === undefined ? {} : { restoreError }),
            onCancel: () => {
                setPreviewTarget(null);
            },
            onRestore: (versionNumber) => {
                restoreVersion(versionNumber, {
                    onRestored: () => {
                        setPreviewTarget(null);
                    },
                });
            },
        },
        compare: {
            open: compareDiff !== undefined,
            ...(compareVersion === undefined ? {} : { version: compareVersion }),
            ...(compareDiff === undefined ? {} : { diff: compareDiff }),
            onClose: () => {
                setCompareTarget(null);
            },
        },
        ...(refusedFoods === undefined || refusedVersion === undefined
            ? {}
            : {
                  privateFoods: {
                      // A saved line carries no food id, only its place, and the refusal names that place: the line
                      // at `sortOrder` is the one refused, and it is the version's own words that name it.
                      lines: refusedLinesOf(
                          refusedVersion.snapshot.ingredients.map((line, index) => ({
                              ...line,
                              name: line.ingredientName,
                              foodId: refusedFoods.find((refused) => refused.sortOrder === index)?.foodId,
                          })),
                          refusedFoods,
                          locale,
                      ),
                      onOpenFood: (foodId: string) => onOpenFood?.(foodId),
                      onClose: restore.reset,
                  },
              }),
    };
}
