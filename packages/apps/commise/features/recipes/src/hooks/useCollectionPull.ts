/**
 * @module @commise/features-recipes/hooks — the Pull-Updates machine of a collection copy (FR-011), once for both
 * platforms' detail screens (it used to be written out in each).
 *
 * Opening runs `previewPull` and shows its diff; confirming commits with `pullCollectionFromSource({ previewedDiff })`.
 * A `PullDriftError` (409: the source changed since the preview) is caught, RE-PREVIEWED for the fresh diff, and left as
 * the dialog's `'drift'` state — never a blind retry and never an infinite spinner. Any other failure is `'generic'`. A
 * successful commit invalidates the collections (in the hook) and closes.
 *
 * ⛔ A commit without a previewed diff is refused here: a blind pull would skip the server's drift guard, which only runs
 * when `previewedDiff` is present.
 *
 * @pattern State — closed / previewing / ready / drift / generic, as the open flag, the diff and the error
 * @pattern Command — each of preview and commit is a TanStack mutation
 */
import { isPullDriftError, type PullDiff } from '@kitchensink/recipe-service-client';
import { usePreviewPull, usePullCollectionFromSource } from '@kitchensink/recipe-service-client/hooks';
import { useState } from 'react';

/** Why the dialog cannot offer a pull. */
export type CollectionPullError = 'drift' | 'generic';

/** What the detail screen gets. */
export interface CollectionPull {
    readonly open: boolean;
    readonly diff: PullDiff | undefined;
    readonly error: CollectionPullError | undefined;
    readonly isLoadingPreview: boolean;
    readonly isCommitting: boolean;
    /** Open the dialog and load a preview. */
    readonly start: () => void;
    /** Close and reset. */
    readonly cancel: () => void;
    /** Commit the previewed diff. */
    readonly confirm: () => void;
}

/**
 * The Pull-Updates machine for one collection.
 *
 * @param id - The collection copy.
 * @returns The dialog's state and its three actions.
 * @sideEffect Sends preview and pull requests.
 */
export function useCollectionPull(id: string): CollectionPull {
    const preview = usePreviewPull();
    const commit = usePullCollectionFromSource();
    const [open, setOpen] = useState(false);
    const [diff, setDiff] = useState<PullDiff | undefined>(undefined);
    const [error, setError] = useState<CollectionPullError | undefined>(undefined);

    const runPreview = async (): Promise<void> => {
        try {
            setDiff(await preview.mutateAsync(id));
            setError(undefined);
        } catch {
            setError('generic');
        }
    };

    return {
        open,
        diff,
        error,
        isLoadingPreview: preview.isPending,
        isCommitting: commit.isPending,
        start: () => {
            setDiff(undefined);
            setError(undefined);
            setOpen(true);
            void runPreview();
        },
        cancel: () => {
            setOpen(false);
            setDiff(undefined);
            setError(undefined);
            preview.reset();
            commit.reset();
        },
        confirm: () => {
            if (diff === undefined) {
                return;
            }

            void (async () => {
                try {
                    await commit.mutateAsync({ id, previewedDiff: diff });
                    setOpen(false);
                    setDiff(undefined);
                    setError(undefined);
                } catch (failure) {
                    if (!isPullDriftError(failure)) {
                        setError('generic');

                        return;
                    }

                    try {
                        setDiff(await preview.mutateAsync(id));
                        setError('drift');
                    } catch {
                        // Even the re-preview failed: fall back to the generic error rather than a stuck spinner.
                        setError('generic');
                    }
                }
            })();
        },
    };
}
