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
 *
 * @pattern Adapter over the house Radix `AlertDialog` — Radix owns the focus trap, Escape-to-dismiss and background
 *     inert, so this leaf hand-rolls none of it and stays a controlled `props → JSX` render.
 */
import { useMessages } from '@commise/i18n/react';
import { Button, buttonSurfaceClass } from '@commise/ui/button';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { useRef, type FC } from 'react';

import { fillTemplate } from '../list/model.js';
import { recipeActionMessages } from './messages.js';
import type { RecipeDeleteDialogProps } from './model.js';

/** The confirm control's decorative glyph — a trash can. The DS Button pairs every label with an icon. */
const TrashIcon: FC = () => (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
        />
    </svg>
);

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
                        {/* `AlertDialog.Cancel` owns its own element (Radix wires the close behaviour onto it),
                            so it wears the DS secondary surface via the shared recipe rather than being the
                            `Button` component. */}
                        <AlertDialog.Cancel type="button" className={buttonSurfaceClass('secondary')}>
                            {deleteDialog.cancel}
                        </AlertDialog.Cancel>
                        {/* The DS destructive Button: it supplies the error-toned surface, the 44px touch floor,
                            the press-scale motion, and — via `busy` — the real in-place spinner plus the
                            disabled + `aria-busy` in-flight guard that used to be hand-rolled here. */}
                        <Button variant="destructive" icon={<TrashIcon />} busy={deleting} onPress={onConfirm}>
                            {deleteDialog.confirm}
                        </Button>
                    </div>
                    {deleting && (
                        <span role="status" className="text-body-sm text-slate">
                            {deleteDialog.deletingLabel}
                        </span>
                    )}
                    {error && !deleting && (
                        <p role="alert" className="text-body-sm text-error-dark">
                            {deleteDialog.error}
                        </p>
                    )}
                </AlertDialog.Content>
            </AlertDialog.Portal>
        </AlertDialog.Root>
    );
};
