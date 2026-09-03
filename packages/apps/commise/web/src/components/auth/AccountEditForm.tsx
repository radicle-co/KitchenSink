'use client';

/**
 * @module components/auth/AccountEditForm — the signed-in cook's own profile edit (web).
 *
 * Two labelled fields (display name, avatar URL) over the identity service's `PATCH /users/me`, submitted
 * inside a `useTransition` so the control disables itself for the round-trip, followed by a
 * `router.refresh()` — the server components above this form hold the old profile, so without the refresh a
 * successful save shows the previous name until the next navigation.
 *
 * ⚠️ It is ORCHESTRATION, and it is the archetype of the component that does not look it: a `<form>` with
 * two controlled inputs and a submit button is the shape of a render leaf. The mutation is four lines inside
 * a handler. A render leaf may not fetch or mutate (CLAUDE.md rule 3), so classifying this one as a leaf
 * would mean moving the write out — which is precisely the decision a reader needs the layer stated to make.
 *
 * @pattern Command over the profile PATCH — the write and the `router.refresh()` that makes it visible are
 *     issued as ONE action, so a saved change can never be left invisible on the surface that saved it.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@commise/ui/button';
import { useMessages } from '@commise/i18n/react';
import type { UserUpdateInput, UserProfile } from '@kitchensink/schema-identity';

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
