'use client';

/**
 * @module auth/AccountDeleteForm — the account-deletion "danger zone" control (web; B6/CR-003).
 *
 * A Radix `Dialog` guards the destructive action: Radix owns the focus trap, Escape-to-dismiss, and
 * background inert, so this component hand-rolls none of that (no `role="dialog"` div). Unlike
 * `RecipeDeleteDialog`/`SubscriptionNudge`/`HomeMobileNav` — whose openers are SIBLING controls elsewhere in
 * the tree — the "Delete Account" trigger here is genuinely OWNED: it stays mounted for the component's
 * whole lifetime (Radix's `Portal` layers the confirmation `Content` over it, it never unmounts), so Radix's
 * own default `onCloseAutoFocus` already restores focus to it correctly — no manual `triggerRef`
 * capture/restore needed (see `PullUpdatesDialog`'s module doc for why that default only works for an OWNED
 * trigger, and why the other three B6 dialogs in this task need the manual pattern instead).
 */
import { useState, useTransition } from 'react';
import { useClerk } from '@clerk/nextjs';
import * as Dialog from '@radix-ui/react-dialog';

import { createProfileServiceClient } from '@/lib/identityServiceClient';

interface AccountDeleteFormProps {
    accessToken: string;
    userId: string;
}

export function AccountDeleteForm({ accessToken, userId: _userId }: AccountDeleteFormProps) {
    const [isPending, startTransition] = useTransition();
    const [error, setError] = useState<string | null>(null);
    const [showConfirm, setShowConfirm] = useState(false);
    const { signOut } = useClerk();

    const handleDelete = async () => {
        setError(null);

        if (!accessToken) {
            setError('Not authenticated');

            return;
        }

        startTransition(async () => {
            try {
                await createProfileServiceClient(accessToken).deleteMe();

                await signOut({ redirectUrl: '/' });
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Deletion failed');
            }
        });
    };

    return (
        <Dialog.Root open={showConfirm} onOpenChange={setShowConfirm}>
            <Dialog.Trigger type="button" aria-label="Delete your account">
                Delete Account
            </Dialog.Trigger>
            <Dialog.Portal>
                <Dialog.Overlay />
                <Dialog.Content aria-modal="true">
                    <Dialog.Title>Confirm Account Deletion</Dialog.Title>
                    <p>This action cannot be undone. All your data will be permanently deleted.</p>
                    {error && <p role="alert">{error}</p>}
                    <button type="button" onClick={handleDelete} disabled={isPending} aria-busy={isPending}>
                        {isPending ? 'Deleting...' : 'Confirm Deletion'}
                    </button>
                    <Dialog.Close type="button">Cancel</Dialog.Close>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
