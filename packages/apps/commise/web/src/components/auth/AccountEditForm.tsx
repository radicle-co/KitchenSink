'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { UserUpdateInput, UserProfile } from '@kitchensink/identity-service';

import { createProfileServiceClient } from '@/lib/identityServiceClient';

interface AccountEditFormProps {
    accessToken: string;
    initialProfile: UserProfile;
}

export function AccountEditForm({ accessToken, initialProfile }: AccountEditFormProps) {
    const [isPending, startTransition] = useTransition();
    const [error, setError] = useState<string | null>(null);
    const router = useRouter();

    const [formData, setFormData] = useState<UserUpdateInput>({
        displayName: initialProfile.user.displayName,
        avatarUrl: initialProfile.user.avatarUrl,
    });

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        if (!accessToken) {
            setError('Not authenticated');

            return;
        }

        startTransition(async () => {
            try {
                await createProfileServiceClient(accessToken).patchMe(formData);

                router.refresh();
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Update failed');
            }
        });
    };

    return (
        <form onSubmit={handleSubmit} aria-label="Account edit form">
            <div>
                <label htmlFor="displayName">Display Name</label>
                <input
                    type="text"
                    id="displayName"
                    name="displayName"
                    value={formData.displayName}
                    onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
                    required
                    maxLength={100}
                    aria-describedby={error ? 'edit-error' : undefined}
                />
            </div>
            <div>
                <label htmlFor="avatarUrl">Avatar URL</label>
                <input
                    type="url"
                    id="avatarUrl"
                    name="avatarUrl"
                    value={formData.avatarUrl ?? ''}
                    onChange={(e) => setFormData({ ...formData, avatarUrl: e.target.value || null })}
                    placeholder="https://..."
                />
            </div>
            {error && (
                <p id="edit-error" role="alert">
                    {error}
                </p>
            )}
            <button type="submit" disabled={isPending} aria-busy={isPending}>
                {isPending ? 'Saving...' : 'Save Changes'}
            </button>
        </form>
    );
}
