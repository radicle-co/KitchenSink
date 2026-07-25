'use client';

import { useState, useTransition } from 'react';
import { useClerk } from '@clerk/nextjs';
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

    if (!showConfirm) {
        return (
            <button type="button" onClick={() => setShowConfirm(true)} aria-label="Delete your account">
                Delete Account
            </button>
        );
    }

    return (
        <div role="dialog" aria-labelledby="delete-confirm-title" aria-modal="true">
            <h3 id="delete-confirm-title">Confirm Account Deletion</h3>
            <p>This action cannot be undone. All your data will be permanently deleted.</p>
            {error && <p role="alert">{error}</p>}
            <button type="button" onClick={handleDelete} disabled={isPending} aria-busy={isPending}>
                {isPending ? 'Deleting...' : 'Confirm Deletion'}
            </button>
            <button type="button" onClick={() => setShowConfirm(false)}>
                Cancel
            </button>
        </div>
    );
}
