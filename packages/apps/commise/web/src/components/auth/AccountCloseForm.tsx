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
 * sign-out issued before clerk-js has loaded resolves without revoking anything).
 *
 * **The two steps fail differently, and the surface says which (`buildSpec.md` §9.1).** A failed CLOSE leaves the
 * account open: the row goes back to idle and `close.error` invites a retry. A failed EXIT means the account IS
 * closed: the row becomes an inert "Account closed" fact (pressing it again would call `deleteMe` on a closed
 * account), and `close.signOutFailed` plus the ordinary {@link LogoutButton} are the only way forward, exactly the
 * erase recovery. The ban the closure enqueues revokes sessions, so this failure is expected, not rare.
 *
 * ⚠️ It is ORCHESTRATION, which a button plus a dialog does not look like: the account-closing call and the
 * verified sign-out both live inside one handler, and the render body is three elements. Its sibling
 * `AccountEraseForm` already declares the same layer for the same reason — the two danger-zone controls sit
 * on one surface, and a reader who classified one of them as a leaf would put the next write in the wrong
 * place.
 *
 * @pattern Command over the closure sequence — `deleteMe` then the load-safe, VERIFIED sign-out, issued as one
 *     mutation (`useClosureSequence`) that runs to completion after unmount, so a closed account can never be left
 *     holding a live session.
 */
import { useState } from 'react';
import { useMessages } from '@commise/i18n/react';
import { isClosureStepError, useClosureSequence } from '@commise/features-account';
import { accountDangerMessages } from '@commise/features-account/danger';
import { ProfileRow } from '@commise/features-account/profile';
import { ConfirmDialog } from '@commise/ui/confirm-dialog';

import { useProfileServiceClient } from '@/hooks/useProfileServiceClient';
import { LogoutButton } from '@/components/auth/LogoutButton';
import { useSignOutAndLeave } from '@/components/auth/useSignOutAndLeave';

export function AccountCloseForm() {
    const { close } = useMessages(accountDangerMessages);
    const client = useProfileServiceClient();
    const [open, setOpen] = useState(false);
    const { signOutAndLeave } = useSignOutAndLeave();

    const sequence = useClosureSequence({
        // The token is minted when the request is sent: a session token lives about a minute, so one captured at
        // render would be stale for a cook who read the page first.
        close: async () => client.deleteMe(),
        leave: signOutAndLeave,
    });
    // The account is closed and only leaving failed: the row is a fact now, not an action.
    const closed = isClosureStepError(sequence.error, 'exit');
    // B17 — never fail silently. Generic on purpose: the raw error is never echoed to the UI.
    const closeFailed = isClosureStepError(sequence.error, 'close');

    const handleConfirm = () => {
        setOpen(false);
        sequence.mutate();
    };

    return (
        <>
            <ProfileRow
                label={closed ? close.closedLabel : sequence.isPending ? close.busyLabel : close.trigger}
                hint={close.rowHint}
                tone="danger"
                chevron={!closed}
                busy={sequence.isPending}
                inert={closed}
                onPress={() => setOpen(true)}
            />
            {closeFailed && (
                <p role="alert" className="px-4 pb-3 text-meta text-danger-text">
                    {close.error}
                </p>
            )}
            {closed && (
                <>
                    <p role="alert" className="px-4 pb-3 text-meta text-danger-text">
                        {close.signOutFailed}
                    </p>
                    <LogoutButton />
                </>
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
