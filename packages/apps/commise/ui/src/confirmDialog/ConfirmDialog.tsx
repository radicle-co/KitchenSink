/**
 * @module @commise/ui/confirm-dialog — the web design-system {@link ConfirmDialog}: a Radix `AlertDialog` that confirms
 * a destructive step with two verb buttons (spec §1.11, §6.5).
 *
 * - Focus opens on Keep: Radix's `AlertDialog.Cancel` takes the initial focus, so no effect is added for it. Keep is
 *   that Radix slot wearing the DS secondary surface (`buttonSurfaceClass`), because a slot owns its own element and
 *   the `Button` component forwards no ref. The confirm is the DS `Button` in its filled `confirm` tone, which brings
 *   the in-place spinner and the busy guard (`aria-busy`, a refused press that keeps focus).
 * - The buttons stack full width below a 400 px DIALOG — a container query on the dialog itself, not the viewport —
 *   with the destructive one on top; side by side above it, Keep first.
 * - Focus returns to the control that opened the dialog when it closes (`useReturnFocusOnClose`); Radix restores
 *   focus only to an owned trigger, and every caller opens this from a sibling.
 *
 * @pattern Adapter over `@radix-ui/react-alert-dialog`
 */
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import type { FC } from 'react';

import { Button } from '../button/Button.js';
import { buttonSurfaceClass } from '../button/surfaceClass.js';
import { useReturnFocusOnClose } from '../dialogFocus/useReturnFocusOnClose.js';
import { Icon } from '../icon/Icon.js';
import type { ConfirmDialogProps } from './props.js';

export const ConfirmDialog: FC<ConfirmDialogProps> = ({
    open,
    title,
    body,
    confirm,
    keep,
    onConfirm,
    onKeep,
    busy = false,
    busyLabel,
    error,
}) => {
    // Snapshots whatever had focus at the render where `open` flips true — the edge guard lives in the hook,
    // so a busy/error re-render while open cannot re-snapshot a control inside the dialog.
    const onCloseAutoFocus = useReturnFocusOnClose(open);

    return (
        <AlertDialog.Root open={open} onOpenChange={(next) => (next ? undefined : onKeep())}>
            <AlertDialog.Portal>
                <AlertDialog.Overlay className="fixed inset-0 z-50 bg-scrim" />
                <AlertDialog.Content
                    aria-modal="true"
                    onCloseAutoFocus={onCloseAutoFocus}
                    className="@container/dialog fixed left-1/2 top-1/2 z-50 flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-lg bg-paper-overlay p-6 shadow-lg"
                >
                    <AlertDialog.Title className="text-section-title text-ink">{title}</AlertDialog.Title>
                    <AlertDialog.Description className="text-body text-ink-muted">{body}</AlertDialog.Description>
                    {error === undefined || busy ? null : (
                        <p role="alert" className="text-body text-danger-text">
                            {error}
                        </p>
                    )}
                    {busy && busyLabel !== undefined ? (
                        <span role="status" className="text-meta text-ink-muted">
                            {busyLabel}
                        </span>
                    ) : null}
                    <div className="flex flex-col-reverse gap-3 @[25rem]/dialog:flex-row @[25rem]/dialog:justify-end">
                        <AlertDialog.Cancel
                            type="button"
                            className={`${buttonSurfaceClass('secondary')} w-full @[25rem]/dialog:w-auto`}
                        >
                            <Icon name={keep.icon ?? 'x'} size={20} />
                            <span>{keep.label}</span>
                        </AlertDialog.Cancel>
                        <Button
                            variant="destructive"
                            tone="confirm"
                            icon={confirm.icon}
                            busy={busy}
                            width="fill"
                            onPress={onConfirm}
                        >
                            {confirm.label}
                        </Button>
                    </div>
                </AlertDialog.Content>
            </AlertDialog.Portal>
        </AlertDialog.Root>
    );
};
