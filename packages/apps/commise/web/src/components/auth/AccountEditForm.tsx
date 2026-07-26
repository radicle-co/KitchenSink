'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@commise/ui/button';
import { useMessages } from '@commise/i18n/react';
import type { UserUpdateInput, UserProfile } from '@kitchensink/identity-service';

import { createProfileServiceClient } from '@/lib/identityServiceClient';
import { authMessages } from '@/components/auth/messages';
import { CheckIcon } from '@/components/auth/icons';
import { errorText, field, fieldGroup, fieldLabel } from '@/components/auth/authChrome';

interface AccountEditFormProps {
    accessToken: string;
    initialProfile: UserProfile;
}

export function AccountEditForm({ accessToken, initialProfile }: AccountEditFormProps) {
    const { edit } = useMessages(authMessages);
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
            setError(edit.notAuthenticated);

            return;
        }

        startTransition(async () => {
            try {
                await createProfileServiceClient(accessToken).patchMe(formData);

                router.refresh();
            } catch {
                // B17 — surface a localized, generic failure; never echo the raw error to the UI.
                setError(edit.updateFailed);
            }
        });
    };

    return (
        <form onSubmit={handleSubmit} aria-label={edit.formLabel} className="flex flex-col gap-4">
            <div className={fieldGroup}>
                <label htmlFor="displayName" className={fieldLabel}>
                    {edit.displayNameLabel}
                </label>
                <input
                    type="text"
                    id="displayName"
                    name="displayName"
                    className={field}
                    value={formData.displayName}
                    onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
                    required
                    maxLength={100}
                    aria-describedby={error ? 'edit-error' : undefined}
                    aria-invalid={error ? true : undefined}
                />
            </div>
            <div className={fieldGroup}>
                <label htmlFor="avatarUrl" className={fieldLabel}>
                    {edit.avatarUrlLabel}
                </label>
                <input
                    type="url"
                    id="avatarUrl"
                    name="avatarUrl"
                    className={field}
                    value={formData.avatarUrl ?? ''}
                    onChange={(e) => setFormData({ ...formData, avatarUrl: e.target.value || null })}
                    placeholder={edit.avatarUrlPlaceholder}
                />
            </div>
            {error && (
                <p id="edit-error" role="alert" className={errorText}>
                    {error}
                </p>
            )}
            <div className="flex justify-end">
                <Button type="submit" icon={<CheckIcon />} busy={isPending}>
                    {isPending ? edit.saving : edit.save}
                </Button>
            </div>
        </form>
    );
}
