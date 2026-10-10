'use client';

/**
 * Container for the recipe version-history route: binds the shared, presentational `RecipeVersionList`
 * building block to live data, plus the Preview modal and two-version Compare view (W6 Task 5). It reads the
 * recipe's versions and the recipe itself (for its current version, which the block marks and makes
 * non-restorable) with suspense queries under a `ClientQueryBoundary`, and wires the restore action to
 * `useRestoreRecipeVersion`. The boundary owns the fetch-state affordances (loading, and an error whose retry
 * refetches), localized through the web dictionary; the block owns the list + empty states. The boundary is
 * the hydration-gated one because this route is not server-prefetched: its server render was already the
 * loading state, and a suspense read there would fetch on the server. The row being restored
 * is busied via `restoringVersion`, with the mutation carrying `{ id, versionNumber }`. It holds no server
 * data of its own — TanStack Query is the source of truth for the remote version list. Wires `onBack` (V6)
 * to navigate to the recipe-detail route, present in EVERY state (loading/error/populated) — the web parity
 * fix for the native `RecipeVersionsScreen`, which already receives its own `onBack` from its navigator.
 *
 * ## Preview (W6 Task 5)
 *
 * `onPreview(n)` sets `previewTarget` to `n`; the previewed version's full snapshot is read straight off the
 * already-loaded `versionsQuery.data` (every entry the list endpoint returns carries its own `snapshot` —
 * see `recipeQueries(client).versions`), so opening the modal makes NO extra fetch. The "changed from current"
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
    compareWithCurrent,
    recipeMessages,
    recipeVersionMessages,
    classifyRestoreError,
    resolveVersionPreview,
} from '@commise/features-recipes';
import { useSnackbar } from '@commise/ui/snackbar';
import { useLocale, useMessages } from '@commise/i18n/react';
import { isVersionConflictError, recipeQueries } from '@kitchensink/recipe-service-client';
import { useRecipeServiceClient, useRestoreRecipeVersion } from '@kitchensink/recipe-service-client/hooks';
import { useSuspenseQueries } from '@tanstack/react-query';
import type { Route } from 'next';
import { useParams, useRouter } from 'next/navigation';
import { useState, type FC } from 'react';

import { ClientQueryBoundary } from '@/components/app/ClientQueryBoundary';
import { webMessages } from '@/i18n/messages';

/** Props for {@link RecipeVersionsContainer}. */
export interface RecipeVersionsContainerProps {
    /** The recipe id from the `[id]` route segment. */
    readonly recipeId: string;
}

/** Shared "Back to Recipe" affordance for the boundary's loading and error fallbacks (V6 fold-in, W6 Task
 *  5). The settled history instead wires `onBack` straight into `RecipeVersionList`, which renders its own
 *  styled back control as part of its header chrome; this smaller link exists ONLY so the fallbacks — which
 *  render in place of that component — are never stranded without a way back to the recipe. Reuses `recipeVersionMessages.versionList.backToRecipe` (the SAME copy `RecipeVersionList`
 *  renders) rather than a second `webMessages` key, so the label is one piece of knowledge either way. */
const BackToRecipeLink: FC<{ readonly onBack: () => void }> = ({ onBack }) => {
    const { versionList } = useMessages(recipeVersionMessages);

    return (
        <button
            type="button"
            onClick={onBack}
            // `ocean-dark` foreground over a seafoam hover tint: the label is text a reader reads, the tint is a
            // non-text accent (see the palette JSDoc in `@commise/ui`).
            className="self-start rounded-full px-4 py-1.5 text-body-sm font-medium text-action-text transition hover:bg-action/10"
        >
            {versionList.backToRecipe}
        </button>
    );
};

/** The version history's pending state: its way back, and what is loading. */
const VersionsLoading: FC<{ readonly onBack: () => void }> = ({ onBack }) => {
    const { recipes } = useMessages(webMessages);

    return (
        <div className="flex max-w-list flex-col gap-3 py-8">
            <BackToRecipeLink onBack={onBack} />
            <p role="status" aria-label={recipes.versions.loadingLabel} className="text-body-md text-ink-muted">
                {recipes.versions.loadingLabel}
            </p>
        </div>
    );
};

/** The version history's failed state: its way back, and a retry. */
const VersionsError: FC<{ readonly onBack: () => void; readonly onRetry: () => void }> = ({ onBack, onRetry }) => {
    const { recipes } = useMessages(webMessages);

    return (
        <div className="flex max-w-list flex-col gap-3 py-8">
            <BackToRecipeLink onBack={onBack} />
            <div role="alert">
                <p>{recipes.versions.errorTitle}</p>
                <button type="button" onClick={onRetry}>
                    {recipes.versions.retry}
                </button>
            </div>
        </div>
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

    const goToRecipe = (): void => {
        router.push(`/${locale}/recipes/${recipeId}` as Route);
    };

    return (
        <ClientQueryBoundary
            loading={<VersionsLoading onBack={goToRecipe} />}
            renderError={({ resetErrorBoundary }) => <VersionsError onBack={goToRecipe} onRetry={resetErrorBoundary} />}
            resetKeys={[recipeId]}
        >
            <RecipeVersionsView recipeId={recipeId} onBack={goToRecipe} />
        </ClientQueryBoundary>
    );
};

/**
 * The settled version history: both reads have resolved by the time this renders, so it holds no fetch state.
 *
 * @param props - The recipe id and the way back to it.
 * @returns The wired {@link RecipeVersionList} plus the Preview modal and Compare view.
 * @throws {Error} For an empty recipe id — a read that cannot be made fails into the boundary rather than issuing
 *   a request for `''` (B21: never a permanent spinner).
 */
const RecipeVersionsView: FC<RecipeVersionsContainerProps & { readonly onBack: () => void }> = ({
    recipeId,
    onBack,
}) => {
    if (recipeId.length === 0) {
        throw new Error('A recipe version history needs a recipe id.');
    }

    const activeLocale = useLocale();
    const { locale } = useParams<{ locale: string }>();
    const client = useRecipeServiceClient();
    const [versionsQuery, recipeQuery] = useSuspenseQueries({
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

    const versions = versionsQuery.data;
    const recipe = recipeQuery.data;
    const restoringVersion = restore.isPending ? restore.variables.versionNumber : null;

    // B17 — a failed restore must never silently no-op. The shared classifier maps the mutation's error to an honest
    // code for the version it targeted: a 409 conflict, a refusal naming the lines it cannot restore (plan 002 R52),
    // or generic. The banner clears on the next restore attempt.
    const restoreError = classifyRestoreError(restore.error, restore.variables?.versionNumber);

    /** Shared restore trigger for BOTH the list's row action and the preview modal's Restore action — same
     *  mutation, same B17 conflict-refetch; `onRestored` (only supplied from the preview modal) additionally
     *  closes the modal once the restore actually lands. A restore makes a NEW version, so it asks no confirmation:
     *  the snackbar's Undo restores the version that was current before, which makes another (§6.6). */
    const restoreVersion = (versionNumber: number, onRestored?: () => void): void => {
        const wasCurrent = recipe.currentVersion;

        restore.mutate(
            { id: recipeId, versionNumber },
            {
                onSuccess: () => {
                    onRestored?.();
                    snackbar.show({
                        message: fillVersion(versionList.restored, versionNumber),
                        action: { label: versionList.undo, onAction: () => restoreVersion(wasCurrent) },
                    });
                },
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

    // §6.6 — Compare: both snapshots come from the already-loaded list (no fetch); the current version is by
    // construction the newest one there (see the module note on Preview).
    const compareVersion = versions.find((version) => version.versionNumber === compareTarget);
    const currentEntry = versions.find((version) => version.versionNumber === recipe.currentVersion);
    const compareDiff =
        compareVersion !== undefined && currentEntry !== undefined
            ? compareWithCurrent(compareVersion, currentEntry, activeLocale, ingredientLineName)
            : undefined;

    return (
        <>
            <RecipeVersionList
                versions={versions}
                currentVersion={recipe.currentVersion}
                restoringVersion={restoringVersion}
                restoreError={restoreError}
                now={now}
                recipeTitle={recipe.title}
                onBack={onBack}
                backHref={`/${locale}/recipes/${recipeId}`}
                onRestore={(versionNumber) => restoreVersion(versionNumber)}
                onPreview={(versionNumber) => setPreviewTarget(versionNumber)}
                {...(currentEntry === undefined
                    ? {}
                    : { onCompare: (versionNumber: number) => setCompareTarget(versionNumber) })}
            />
            <VersionPreviewModal
                {...preview}
                locale={activeLocale}
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
};

/** A version template with its number filled in. Pure. */
function fillVersion(template: string, version: number): string {
    return template.replace('{version}', String(version));
}
