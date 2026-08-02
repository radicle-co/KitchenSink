'use client';

/**
 * @module auth/AccountCloseForm — the account CLOSURE control (web; CR-002 / U4b).
 *
 * Closure is the RECOVERABLE action: it deactivates the account (identity ban + tombstone) but RETAINS the
 * user's data, which can be restored. This supersedes the old `AccountDeleteForm`, whose copy wrongly claimed
 * the same `DELETE /api/v1/users/me` call "permanently deleted" "all your data" — the exact conflation U4b fixes.
 * Irreversible ERASURE is a SEPARATE control ({@link import('./AccountEraseForm.js').AccountEraseForm}).
 *
 * Built on the design-system `ConfirmDialog` (`@commise/ui/confirm-dialog`), which owns the focus trap,
 * Escape/backdrop dismiss, and `role="alertdialog"` wiring. All copy is localized (`accountDangerMessages`),
 * never hard-coded.
 *
 * Leaving the app after closure goes through the app's one sign-out command,
 * {@link import('./useSignOutAndLeave.js').useSignOutAndLeave} — which awaits the revoke and only then
 * replaces the document (a router-level redirect re-renders the authenticated shell from a payload resolved
 * for the session that was just destroyed), and VERIFIES the session actually ended before doing so (B23: a
 * sign-out issued before clerk-js has loaded resolves without revoking anything). A failure to leave surfaces
 * in the same alert as a failure to close — by then the closure has been accepted, so it is never silent.
 */
import { useState, useTransition } from 'react';
import { useMessages } from '@commise/i18n/react';
import { accountDangerMessages } from '@commise/features-account/danger';
import { ConfirmDialog } from '@commise/ui/confirm-dialog';
import { Button } from '@commise/ui/button';

import { createProfileServiceClient } from '@/lib/identityServiceClient';
import { AlertTriangleIcon } from '@/components/auth/icons';
import { errorText } from '@/components/auth/authChrome';
import { useSignOutAndLeave } from '@/components/auth/useSignOutAndLeave';

interface AccountCloseFormProps {
    /** The signed-in viewer's Clerk session token, used to authenticate the closure request. */
    readonly accessToken: string;
}

export function AccountCloseForm({ accessToken }: AccountCloseFormProps) {
    const { close } = useMessages(accountDangerMessages);
    const [open, setOpen] = useState(false);
    const [isPending, startTransition] = useTransition();
    const [error, setError] = useState<string | null>(null);
    const { signOutAndLeave } = useSignOutAndLeave();

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
                await signOutAndLeave();
            } catch {
                // B17 — never fail silently: surface the failure instead of leaving the viewer signed in with
                // no feedback. The message is intentionally generic (never echoes the raw error to the UI).
                setError(close.error);
            }
        });
    };

    return (
        <>
            <Button variant="destructive" icon={<AlertTriangleIcon />} onPress={() => setOpen(true)} busy={isPending}>
                {isPending ? close.busyLabel : close.trigger}
            </Button>
            {error && (
                <p role="alert" className={errorText}>
                    {error}
                </p>
            )}
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
