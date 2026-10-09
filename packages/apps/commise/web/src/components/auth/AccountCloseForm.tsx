'use client';

/**
 * @module auth/AccountCloseForm — the account CLOSURE control (web; CR-002 / U4b).
 *
 * Closure is the RECOVERABLE action: it deactivates the account (identity ban + tombstone) but RETAINS the
 * user's data, which can be restored. This supersedes the old `AccountDeleteForm`, whose copy wrongly claimed
 * the same `DELETE /api/v1/users/me` call "permanently deleted" "all your data" — the exact conflation U4b fixes.
 * Irreversible ERASURE is a SEPARATE control (`AccountEraseForm`).
 *
 * Built on the design-system `ConfirmDialog` (`@commise/ui/confirm-dialog`), which owns the focus trap,
 * Escape/backdrop dismiss, and `role="alertdialog"` wiring. All copy is localized (`accountDangerMessages`),
 * never hard-coded.
 *
 * Leaving the app after closure goes through the app's one sign-out command,
 * `useSignOutAndLeave` — which awaits the revoke and only then
 * replaces the document (a router-level redirect re-renders the authenticated shell from a payload resolved
 * for the session that was just destroyed), and VERIFIES the session actually ended before doing so (B23: a
 * sign-out issued before clerk-js has loaded resolves without revoking anything). A failure to leave surfaces
 * in the same alert as a failure to close — by then the closure has been accepted, so it is never silent.
 *
 * ⚠️ It is ORCHESTRATION, which a button plus a dialog does not look like: the account-closing call and the
 * verified sign-out both live inside one handler, and the render body is three elements. Its sibling
 * `AccountEraseForm` already declares the same layer for the same reason — the two danger-zone controls sit
 * on one surface, and a reader who classified one of them as a leaf would put the next write in the wrong
 * place.
 *
 * @pattern Command over the closure sequence — `deleteMe` then the load-safe, VERIFIED sign-out, issued as
 *     one transition so a closed account can never be left holding a live session.
 */
import { useState, useTransition } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useMessages } from '@commise/i18n/react';
import { accountDangerMessages } from '@commise/features-account/danger';
import { ProfileRow } from '@commise/features-account/profile';
import { ConfirmDialog } from '@commise/ui/confirm-dialog';

import { createProfileServiceClient } from '@/lib/identityServiceClient';
import { useSignOutAndLeave } from '@/components/auth/useSignOutAndLeave';

export function AccountCloseForm() {
    const { close } = useMessages(accountDangerMessages);
    const { getToken } = useAuth();
    const [open, setOpen] = useState(false);
    const [isPending, startTransition] = useTransition();
    const [error, setError] = useState<string | null>(null);
    const { signOutAndLeave } = useSignOutAndLeave();

    const handleConfirm = () => {
        setOpen(false);
        setError(null);

        startTransition(async () => {
            try {
                // The token is minted when the request is sent: a session token lives about a minute, so one
                // captured at render would be stale for a cook who read the page first.
                await createProfileServiceClient(async () => (await getToken()) ?? '').deleteMe();
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
            <ProfileRow
                label={isPending ? close.busyLabel : close.trigger}
                hint={close.rowHint}
                tone="danger"
                chevron
                busy={isPending}
                onPress={() => setOpen(true)}
            />
            {error && (
                <p role="alert" className="px-4 pb-3 text-meta text-danger-text">
                    {error}
                </p>
            )}
            <ConfirmDialog
                open={open}
                title={close.title}
                body={close.description}
                confirm={{ label: close.confirm, icon: 'userX' }}
                keep={{ label: close.cancel }}
                onConfirm={handleConfirm}
                onKeep={() => setOpen(false)}
            />
        </>
    );
}
