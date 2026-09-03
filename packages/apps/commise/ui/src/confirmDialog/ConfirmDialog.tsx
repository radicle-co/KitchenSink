/**
 * @module @commise/ui/confirm-dialog — the web design-system {@link ConfirmDialog} (house pattern B6).
 *
 * A controlled `AlertDialog` built on `@radix-ui/react-alert-dialog` — Radix owns focus-trapping, Escape-to-
 * dismiss, backdrop-click dismiss, and the `role="alertdialog"` + `aria-labelledby`/`aria-describedby` wiring
 * from its `Title`/`Description` parts, so this leaf only supplies the Commise visual language and maps
 * Radix's `onOpenChange(false)` (covers Escape + backdrop + the built-in Cancel action) onto the same
 * `onCancel` callback the explicit Cancel button uses — one exit path, not two.
 *
 * @pattern Adapter over `@radix-ui/react-alert-dialog` — Radix owns the focus trap, Escape-to-dismiss, backdrop
 *     dismissal and the `alertdialog` role wiring, so this leaf supplies only the Commise visual language.
 */
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import type { FC } from 'react';

import type { ConfirmDialogProps } from './props.js';

export const ConfirmDialog: FC<ConfirmDialogProps> = ({
    open,
    title,
    description,
    confirmLabel,
    cancelLabel,
    onConfirm,
    onCancel,
    destructive = false,
}) => (
    <AlertDialog.Root open={open} onOpenChange={(next) => (next ? undefined : onCancel())}>
        <AlertDialog.Portal>
            <AlertDialog.Overlay className="fixed inset-0 z-50 bg-charcoal/40" />
            <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 flex w-full max-w-md -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-2xl bg-card p-6 shadow-lg">
                <AlertDialog.Title className="font-display text-heading-lg font-semibold text-charcoal">
                    {title}
                </AlertDialog.Title>
                <AlertDialog.Description className="text-body-md leading-relaxed text-slate">
                    {description}
                </AlertDialog.Description>
                <div className="flex items-center justify-end gap-3">
                    <AlertDialog.Cancel asChild>
                        <button
                            type="button"
                            className="rounded-full px-4 py-2 text-body-sm font-medium text-slate transition hover:bg-pearl"
                        >
                            {cancelLabel}
                        </button>
                    </AlertDialog.Cancel>
                    <AlertDialog.Action asChild>
                        <button
                            type="button"
                            onClick={onConfirm}
                            className={
                                destructive
                                    ? 'rounded-full bg-error px-5 py-2 text-body-sm font-semibold text-white shadow-sm transition hover:opacity-90'
                                    : 'rounded-full bg-gradient-to-br from-seafoam to-ocean-dark px-5 py-2 text-body-sm font-semibold text-white shadow-sm transition hover:opacity-95'
                            }
                        >
                            {confirmLabel}
                        </button>
                    </AlertDialog.Action>
                </div>
            </AlertDialog.Content>
        </AlertDialog.Portal>
    </AlertDialog.Root>
);
