'use client';

/**
 * @module @commise/features-recipes — web recipe delete-confirmation dialog (T068 building block).
 *
 * Controlled, presentational confirmation modal built on Radix `AlertDialog` (B6/CR-003 — mirrors
 * `PullUpdatesDialog`'s `Dialog` usage, the semantic `alertdialog` variant for a destructive-action
 * confirmation): Radix owns the focus trap, Escape-to-dismiss, and background inert, so this component
 * hand-rolls none of that (no `role="alertdialog"` div). Renders nothing while `open` is false; when open it
 * names the recipe and offers cancel/confirm. `deleting` disables the confirm action and marks it busy so an
 * in-flight delete cannot be double-submitted. It performs NO mutation — the composing app wires the delete
 * mutation to `onConfirm`. `onOpenChange` maps every Radix close path (Escape, backdrop) onto the same
 * `onCancel` the explicit Cancel control uses — one exit path, not two.
 *
 * Focus-return is handled explicitly, NOT left to Radix's default: `AlertDialog.Content` wraps
 * `Dialog.Content`, whose built-in `onCloseAutoFocus` only restores focus to an OWNED `*.Trigger` (see
 * `PullUpdatesDialog`'s module doc for the underlying Radix behavior). The "Delete" control that opens this
 * dialog lives in the composing container (a sibling button, not an owned `AlertDialog.Trigger`), so
 * `triggerRef` below captures `document.activeElement` at the render where `open` flips true — BEFORE
 * `AlertDialog.Content` (and its own autofocus-on-mount, onto the Cancel action per the alertdialog pattern)
 * ever commits — and `onCloseAutoFocus` restores it, `preventDefault()`ing Radix's own no-op default.
 */
import { useMessages } from '@commise/i18n/react';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { useRef, type FC } from 'react';

import { fillTemplate } from '../list/model.js';
import { recipeActionMessages } from './messages.js';
import type { RecipeDeleteDialogProps } from './model.js';

export const RecipeDeleteDialog: FC<RecipeDeleteDialogProps> = ({
    recipeTitle,
    open,
    deleting = false,
    error = false,
    onConfirm,
    onCancel,
}) => {
    const { deleteDialog } = useMessages(recipeActionMessages);

    // Capture whatever had focus right before this dialog opened, during render (not an effect) — see the
    // module doc. Guarded on the false→true edge so it isn't re-captured on every re-render while the
    // dialog stays open (e.g. the `deleting`/`error` state changing).
    const triggerRef = useRef<HTMLElement | null>(null);
    const wasOpenRef = useRef(false);

    if (open && !wasOpenRef.current) {
        triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }

    wasOpenRef.current = open;

    return (
        <AlertDialog.Root open={open} onOpenChange={(next) => !next && onCancel()}>
            <AlertDialog.Portal>
                <AlertDialog.Overlay className="fixed inset-0 z-50 bg-charcoal/40" />
                <AlertDialog.Content
                    aria-modal="true"
                    onCloseAutoFocus={(event) => {
                        event.preventDefault();
                        triggerRef.current?.focus();
                    }}
                    className="fixed left-1/2 top-1/2 z-50 flex w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-2xl bg-card p-6 shadow-lg md:max-w-md"
                >
                    <AlertDialog.Title className="font-display text-heading-lg font-semibold text-charcoal">
                        {deleteDialog.title}
                    </AlertDialog.Title>
                    <AlertDialog.Description className="text-body-md leading-relaxed text-slate">
                        {fillTemplate(deleteDialog.body, { title: recipeTitle })}
                    </AlertDialog.Description>
                    <div className="flex items-center justify-end gap-3">
                        <AlertDialog.Cancel
                            type="button"
                            className="rounded-full px-4 py-2 text-body-sm font-medium text-slate transition hover:bg-pearl"
                        >
                            {deleteDialog.cancel}
                        </AlertDialog.Cancel>
                        <button
                            type="button"
                            onClick={onConfirm}
                            disabled={deleting}
                            aria-busy={deleting || undefined}
                            className="rounded-full bg-error px-5 py-2 text-body-sm font-semibold text-white shadow-sm transition hover:opacity-90 disabled:opacity-60"
                        >
                            {deleteDialog.confirm}
                        </button>
                    </div>
                    {deleting && (
                        <span role="status" className="text-body-sm text-slate">
                            {deleteDialog.deletingLabel}
                        </span>
                    )}
                    {error && !deleting && (
                        <p role="alert" className="text-body-sm text-error">
                            {deleteDialog.error}
                        </p>
                    )}
                </AlertDialog.Content>
            </AlertDialog.Portal>
        </AlertDialog.Root>
    );
};
