'use client';

/**
 * @module auth/AccountCloseForm — the account CLOSURE control (web; CR-002 / U4b).
 *
 * Closure is the RECOVERABLE action: it deactivates the account (identity ban + tombstone) but RETAINS the
 * user's data, which can be restored. This supersedes the old `AccountDeleteForm`, whose copy wrongly claimed
 * the same `DELETE /v1/users/me` call "permanently deleted" "all your data" — the exact conflation U4b fixes.
 * Irreversible ERASURE is a SEPARATE control ({@link import('./AccountEraseForm.js').AccountEraseForm}).
 *
 * Built on the design-system `ConfirmDialog` (`@commise/ui/confirm-dialog`), which owns the focus trap,
 * Escape/backdrop dismiss, and `role="alertdialog"` wiring. All copy is localized (`accountDangerMessages`),
 * never hard-coded.
 */
import { useState, useTransition } from 'react';
import { useClerk } from '@clerk/nextjs';
import { useMessages } from '@commise/i18n/react';
import { accountDangerMessages } from '@commise/features-account/danger';
import { ConfirmDialog } from '@commise/ui/confirm-dialog';

import { createProfileServiceClient } from '@/lib/identityServiceClient';

interface AccountCloseFormProps {
    /** The signed-in viewer's Clerk session token, used to authenticate the closure request. */
    readonly accessToken: string;
}

export function AccountCloseForm({ accessToken }: AccountCloseFormProps) {
    const { close } = useMessages(accountDangerMessages);
    const [open, setOpen] = useState(false);
    const [isPending, startTransition] = useTransition();
    const [error, setError] = useState<string | null>(null);
    const { signOut } = useClerk();

    const handleConfirm = () => {
        setOpen(false);
        setError(null);

        if (!accessToken) {
            setError(close.error);

            return;
        }

        startTransition(async () => {
            try {
                await createProfileServiceClient(accessToken).deleteMe();
                await signOut({ redirectUrl: '/' });
            } catch {
                // B17 — never fail silently: surface the failure instead of leaving the viewer signed in with
                // no feedback. The message is intentionally generic (never echoes the raw error to the UI).
                setError(close.error);
            }
        });
    };

    return (
        <>
            <button type="button" onClick={() => setOpen(true)} disabled={isPending} aria-busy={isPending || undefined}>
                {isPending ? close.busyLabel : close.trigger}
            </button>
            {error && <p role="alert">{error}</p>}
            <ConfirmDialog
                open={open}
                title={close.title}
                description={close.description}
                confirmLabel={close.confirm}
                cancelLabel={close.cancel}
                destructive
                onConfirm={handleConfirm}
                onCancel={() => setOpen(false)}
            />
        </>
    );
}
