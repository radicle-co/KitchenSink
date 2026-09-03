'use client';

/**
 * @module @commise/features-recipes — web Pull-Updates preview dialog (W5 Task 10, C2 / FR-011).
 *
 * Presentational (pure props → JSX) render of the collection-view wireframe's "Pull Updates Preview
 * Dialog". Built on the house **Radix `Dialog`** (mirrors `PhotoCarousel`'s lightbox usage, B6/CR-003):
 * Radix owns the focus trap, Escape-to-dismiss, and background inert, so this component hand-rolls none of
 * that (no `role="dialog"` div). `open` is driven entirely by the caller — `onOpenChange` maps Radix's own
 * close paths (Escape, backdrop click) onto the same `onCancel` the explicit Cancel control uses, so there
 * is exactly ONE exit path, not two.
 *
 * Focus-return is handled explicitly, NOT left to Radix's default: `Dialog.Content`'s built-in
 * `onCloseAutoFocus` only restores focus to an OWNED `Dialog.Trigger` (`DialogContentModal` unconditionally
 * `preventDefault()`s FocusScope's own restore-to-previous-element behavior and focuses
 * `context.triggerRef.current` instead — see `@radix-ui/react-dialog`'s `DialogContentModal`). This dialog
 * is opened by a sibling control (the collection-actions "Pull Updates" button, wired in W5 Task 12), not
 * an owned `Dialog.Trigger`, so that default silently focuses nothing. `triggerRef` below captures
 * `document.activeElement` at the render where `open` flips true — BEFORE `Dialog.Content` (and its
 * autofocus-on-mount) ever commits — and `onCloseAutoFocus` restores it, `preventDefault()`ing Radix's own
 * no-op default so there is one focus-restore path, not a silently-losing second one.
 *
 * A discriminated three-way state (mutually exclusive, matching {@link PullUpdatesDialogProps}'s JSDoc):
 * (1) a `role="status"` progress affordance while `isLoadingPreview`, or before any `diff` has arrived; (2)
 * a `role="alert"` for a failed preview/commit — `'drift'` (409, the previewed diff went stale) is
 * deliberately NOT a dead end: the counts are hidden (they're no longer trustworthy) but Cancel/Escape
 * still close the dialog, so the composing container (W5 Task 12) can re-run the preview; (3) the loaded
 * `diff` — added/removed/unchanged COUNTS only (this block never resolves recipe titles, it only received
 * ids), the "not overwritten" note, and the count-templated Pull action, disabled while `isCommitting` or
 * when there is nothing to add.
 *
 * @pattern Adapter over the house Radix `Dialog` — Radix owns the focus trap, Escape-to-dismiss and background inert;
 *     `open` is the caller's, so this leaf stays a controlled `props → JSX` render.
 */
import { useMessages } from '@commise/i18n/react';
import * as Dialog from '@radix-ui/react-dialog';
import { useRef, type FC } from 'react';

import { fillTemplate } from '../list/model.js';
import { collectionMessages } from './messages.js';
import type { PullUpdatesDialogProps } from './model.js';

export const PullUpdatesDialog: FC<PullUpdatesDialogProps> = ({
    open,
    diff,
    isLoadingPreview,
    isCommitting,
    error,
    sourceOwnerHandle,
    sourceCollectionName,
    onCancel,
    onConfirm,
}) => {
    const { pull } = useMessages(collectionMessages);

    // Capture whatever had focus right before this dialog opened, during render (not an effect): this runs
    // BEFORE `Dialog.Content` mounts and moves focus onto its own first tabbable candidate, so it always
    // sees the real invoking control. Guarded on the false→true edge so it isn't re-captured on every
    // re-render while the dialog stays open (e.g. a preview/commit state change).
    const triggerRef = useRef<HTMLElement | null>(null);
    const wasOpenRef = useRef(false);

    if (open && !wasOpenRef.current) {
        triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }

    wasOpenRef.current = open;

    const attribution =
        sourceOwnerHandle !== undefined && sourceCollectionName !== undefined
            ? fillTemplate(pull.attribution, { handle: sourceOwnerHandle, name: sourceCollectionName })
            : sourceCollectionName !== undefined
              ? fillTemplate(pull.attributionNoHandle, { name: sourceCollectionName })
              : undefined;

    // Never trust an in-flight or stale diff: loading always wins, and no diff at all reads as "still
    // loading" rather than risking a misleading zero-count flash before the first preview resolves.
    const showLoading = isLoadingPreview || (diff === undefined && error === undefined);
    const showDiff = !showLoading && error === undefined && diff !== undefined;
    const canConfirm = diff !== undefined && diff.added.length > 0 && !isCommitting;

    return (
        <Dialog.Root open={open} onOpenChange={(next) => !next && onCancel()}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-50 bg-charcoal/40" />
                <Dialog.Content
                    onCloseAutoFocus={(event) => {
                        event.preventDefault();
                        triggerRef.current?.focus();
                    }}
                    className="fixed left-1/2 top-1/2 z-50 flex w-full max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-2xl bg-card p-6 shadow-lg"
                >
                    <div className="flex flex-col gap-1">
                        <Dialog.Title className="font-display text-heading-lg font-semibold text-charcoal">
                            {pull.title}
                        </Dialog.Title>
                        {attribution !== undefined && <p className="text-body-sm text-slate">{attribution}</p>}
                    </div>

                    {showLoading && (
                        <p role="status" aria-label={pull.loadingLabel} className="text-body-md text-slate">
                            {pull.loadingLabel}
                        </p>
                    )}

                    {!showLoading && error !== undefined && (
                        <p role="alert" className="text-body-md text-error-dark">
                            {error === 'drift' ? pull.driftMessage : pull.genericErrorMessage}
                        </p>
                    )}

                    {showDiff && diff !== undefined && (
                        <div className="flex flex-col gap-2 text-body-md text-slate">
                            <p>{fillTemplate(pull.addedCount, { count: diff.added.length })}</p>
                            <p>{fillTemplate(pull.removedCount, { count: diff.removed.length })}</p>
                            <p>{fillTemplate(pull.unchangedCount, { count: diff.unchanged.length })}</p>
                            <p className="text-body-sm italic">{pull.ownMembersNote}</p>
                            {diff.added.length === 0 && <p>{pull.upToDate}</p>}
                        </div>
                    )}

                    <div className="flex items-center justify-end gap-3">
                        <Dialog.Close className="rounded-full px-4 py-2 text-body-sm font-medium text-slate transition hover:bg-pearl">
                            {pull.cancel}
                        </Dialog.Close>
                        {showDiff && diff !== undefined && (
                            <button
                                type="button"
                                onClick={onConfirm}
                                disabled={!canConfirm}
                                aria-busy={isCommitting || undefined}
                                className="rounded-full bg-seafoam px-5 py-2 text-body-sm font-semibold text-white shadow-sm transition hover:bg-ocean-dark disabled:opacity-60"
                            >
                                {fillTemplate(pull.confirm, { count: diff.added.length })}
                            </button>
                        )}
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
};
