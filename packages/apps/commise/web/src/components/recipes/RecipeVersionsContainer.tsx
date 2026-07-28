'use client';

/**
 * Container for the recipe version-history route: binds the shared, presentational `RecipeVersionList`
 * building block to live data, plus the Preview modal and two-version Compare view (W6 Task 5). It reads the
 * recipe's versions via `useRecipeVersions(id)` and the recipe's current version via `useRecipe(id)` (the
 * block marks that version and makes it non-restorable), and wires the restore action to
 * `useRestoreRecipeVersion`. The fetch-state affordances (loading, error with retry) belong to the app and
 * are localized through the web dictionary; the block owns the list + empty states. The row being restored
 * is busied via `restoringVersion`, with the mutation carrying `{ id, versionNumber }`. It holds no server
 * data of its own — TanStack Query is the source of truth for the remote version list. Wires `onBack` (V6)
 * to navigate to the recipe-detail route, present in EVERY state (loading/error/populated) — the web parity
 * fix for the native `RecipeVersionsScreen`, which already receives its own `onBack` from its navigator.
 *
 * ## Preview (W6 Task 5)
 *
 * `onPreview(n)` sets `previewTarget` to `n`; the previewed version's full snapshot is read straight off the
 * already-loaded `versionsQuery.data` (every entry the list endpoint returns carries its own `snapshot` —
 * see `useRecipeVersions`'s JSDoc), so opening the modal makes NO extra fetch. The "changed from current"
 * line needs the CURRENT version's snapshot too, looked up the SAME way (from the list) rather than
 * re-fetched: the DB retention window keeps the newest `VERSION_RETENTION_LIMIT` (10) versions
 * (`versions.dal.ts`), and the current version is BY CONSTRUCTION the highest version number that exists —
 * every write that changes `currentVersion` also records a new, higher-numbered version row — so it is
 * ALWAYS inside that window and therefore always present in the list this container already has. If that
 * invariant were ever violated (e.g. a future retention-policy change), this gracefully OMITS the "changed
 * from current" line (`diffFromCurrent` stays `undefined`) rather than adding a `useRecipeVersion` fallback
 * fetch for a state that cannot occur today — see the W6 Task 5 report for the fuller rationale on that
 * choice. `isRestoring` on the modal reflects the restore mutation's OWN pending state for the previewed
 * version's number, so a restore-from-preview cannot be double-submitted; `onRestore` shares the SAME
 * `restoreVersion` helper the list's row action uses (including the B17 conflict-refetch), closing the modal
 * only on success.
 *
 * ## Compare (W6 Task 5)
 *
 * `compareSelection` tracks 0–2 selected version numbers (`RecipeVersionList`'s per-row Compare checkbox,
 * `onToggleCompare`); like Preview, both versions are read from the already-loaded list — no fetch. Once
 * exactly two are picked they are ordered older→newer (independent of click order) and diffed via
 * `diffSnapshots(older.snapshot, newer.snapshot)`, so `VersionCompareView`'s "Compare v{B} vs v{A}" heading
 * always reads newer-vs-older. `onClose` clears the selection (closing the panel is equivalent to
 * deselecting both).
 */
import {
    RecipeVersionList,
    VersionCompareView,
    VersionPreviewModal,
    diffSnapshots,
    recipeVersionMessages,
    resolveVersionPreview,
    type RecipeVersionRestoreError,
} from '@commise/features-recipes';
import { toDetailQueryView } from '@commise/features-core';
import { useLocale, useMessages } from '@commise/i18n/react';
import type { RecipeVersion } from '@kitchensink/recipe-core';
import { isVersionConflictError } from '@kitchensink/recipe-service-client';
import { useRecipe, useRecipeVersions, useRestoreRecipeVersion } from '@kitchensink/recipe-service-client/hooks';
import type { Route } from 'next';
import { useParams, useRouter } from 'next/navigation';
import { useState, type FC } from 'react';

import { webMessages } from '@/i18n/messages';

/** Props for {@link RecipeVersionsContainer}. */
export interface RecipeVersionsContainerProps {
    /** The recipe id from the `[id]` route segment. */
    readonly recipeId: string;
}

/** Shared "Back to Recipe" affordance for the container's loading/error early-returns (V6 fold-in, W6 Task
 *  5). The populated branch instead wires `onBack` straight into `RecipeVersionList`, which renders its own
 *  styled back control as part of its header chrome; this smaller link exists ONLY so the loading/error
 *  branches — which return before ever reaching that component — are never stranded without a way back to
 *  the recipe. Reuses `recipeVersionMessages.versionList.backToRecipe` (the SAME copy `RecipeVersionList`
 *  renders) rather than a second `webMessages` key, so the label is one piece of knowledge either way. */
const BackToRecipeLink: FC<{ readonly onBack: () => void }> = ({ onBack }) => {
    const { versionList } = useMessages(recipeVersionMessages);

    return (
        <button
            type="button"
            onClick={onBack}
            // `ocean-dark` foreground over a seafoam hover tint: the label is text a reader reads, the tint is a
            // non-text accent (see the palette JSDoc in `@commise/ui`).
            className="self-start rounded-full px-4 py-1.5 text-body-sm font-medium text-ocean-dark transition hover:bg-seafoam/10"
        >
            {versionList.backToRecipe}
        </button>
    );
};

/**
 * The live recipe version-history container.
 *
 * @param props - The recipe id whose version history to load.
 * @returns The wired {@link RecipeVersionList} plus the Preview modal and Compare view, or a localized
 *   loading / error affordance (each carrying its own {@link BackToRecipeLink}).
 */
export const RecipeVersionsContainer: FC<RecipeVersionsContainerProps> = ({ recipeId }) => {
    const { recipes } = useMessages(webMessages);
    const { locale } = useParams<{ locale: string }>();
    const activeLocale = useLocale();
    const router = useRouter();
    const versionsQuery = useRecipeVersions(recipeId);
    const recipeQuery = useRecipe(recipeId);
    const restore = useRestoreRecipeVersion();

    // W6 Task 5 — Preview: which version (by number) is being previewed, or `null` when the modal is closed.
    const [previewTarget, setPreviewTarget] = useState<number | null>(null);
    // W6 Task 5 — Compare: the 0/1/2 version numbers currently selected for the compare view, in the order
    // they were picked (see `toggleCompare` for the cap-at-two UX this order feeds).
    const [compareSelection, setCompareSelection] = useState<readonly number[]>([]);

    const goToRecipe = (): void => {
        router.push(`/${locale}/recipes/${recipeId}` as Route);
    };

    // B21: ONE derivation of which fetch-state affordance to render, over BOTH queries combined — the pair
    // is loading while either is, failed if either failed, and ready only with BOTH data present. The
    // settled-but-absent case (neither loading nor errored, still no data) used to fall into a SECOND loading
    // branch below the error one, stranding the viewer on a permanent spinner; mobile's
    // `RecipeVersionsScreen` has always routed it into ERROR, and web now agrees BY CONSTRUCTION.
    const view = toDetailQueryView({
        isLoading: versionsQuery.isLoading || recipeQuery.isLoading,
        isError: versionsQuery.isError || recipeQuery.isError,
        data:
            versionsQuery.data === undefined || recipeQuery.data === undefined
                ? undefined
                : { versions: versionsQuery.data, recipe: recipeQuery.data },
    });

    if (view.status === 'loading') {
        return (
            <div className="mx-auto flex max-w-2xl flex-col gap-3 px-4 py-8">
                <BackToRecipeLink onBack={goToRecipe} />
                <p role="status" aria-label={recipes.versions.loadingLabel} className="text-body-md text-slate">
                    {recipes.versions.loadingLabel}
                </p>
            </div>
        );
    }

    if (view.status === 'error') {
        return (
            <div className="mx-auto flex max-w-2xl flex-col gap-3 px-4 py-8">
                <BackToRecipeLink onBack={goToRecipe} />
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
            </div>
        );
    }

    const { versions, recipe } = view.data;
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

    /** Shared restore trigger for BOTH the list's row action and the preview modal's Restore action — same
     *  mutation, same B17 conflict-refetch; `onRestored` (only supplied from the preview modal) additionally
     *  closes the modal once the restore actually lands. */
    const restoreVersion = (versionNumber: number, onRestored?: () => void): void => {
        restore.mutate(
            { id: recipeId, versionNumber },
            {
                onSuccess: onRestored,
                onError: (error) => {
                    if (isVersionConflictError(error)) {
                        void versionsQuery.refetch();
                        void recipeQuery.refetch();
                    }
                },
            },
        );
    };

    // W6 Task 5 — Preview (see module docs for the "read from the already-loaded list" rationale). B21: the
    // whole derivation — including the FAILED-LOOKUP report a preview target the history no longer contains
    // must produce — lives in the shared `resolveVersionPreview`, so the native screen cannot drift from it.
    const preview = resolveVersionPreview({
        previewTarget,
        versions,
        currentVersion: recipe.currentVersion,
        restoringVersion,
    });

    // W6 Task 5 — Compare: both selected versions come from the same already-loaded list data (no fetch).
    const compareVersions = compareSelection
        .map((versionNumber) => versions.find((v) => v.versionNumber === versionNumber))
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
    // checkbox (an explicit "deselect one first" UX) rather than silently evicting the oldest pick. This
    // handler's own `current.length >= 2` guard is the defensive second half of that contract — a disabled
    // control shouldn't be reachable, but a direct call is a no-op rather than a surprise eviction.
    const toggleCompare = (versionNumber: number): void => {
        setCompareSelection((current) => {
            if (current.includes(versionNumber)) {
                return current.filter((selected) => selected !== versionNumber);
            }

            return current.length >= 2 ? current : [...current, versionNumber];
        });
    };

    return (
        <>
            <RecipeVersionList
                versions={versions}
                currentVersion={recipe.currentVersion}
                restoringVersion={restoringVersion}
                restoreError={restoreError}
                selectedForCompare={compareSelection}
                onBack={goToRecipe}
                onRestore={(versionNumber) => restoreVersion(versionNumber)}
                onPreview={(versionNumber) => setPreviewTarget(versionNumber)}
                onToggleCompare={toggleCompare}
            />
            <VersionPreviewModal
                {...preview}
                locale={activeLocale}
                onCancel={() => setPreviewTarget(null)}
                onRestore={(versionNumber) => restoreVersion(versionNumber, () => setPreviewTarget(null))}
            />
            <VersionCompareView
                open={compareSelection.length === 2}
                versionA={olderCompareVersion}
                versionB={newerCompareVersion}
                diff={compareDiff}
                locale={activeLocale}
                onClose={() => setCompareSelection([])}
            />
        </>
    );
};
