'use client';

/**
 * @module auth/LogoutButton — the web sign-out control: the Profile page's sign-out row.
 *
 * The orchestration half of the sign-out surface: it owns only the control's own state (busy, error) and
 * issues the app's one sign-out command, `useSignOutAndLeave` —
 * which owns the mechanism (Clerk's load-safe `signOut`), the ordering (await the revoke, THEN replace the
 * document), and the post-condition that the session really ended. Read that module before changing anything
 * here; the post-condition guards a real, observed security defect (B23), not a hypothetical one.
 *
 * B17/B23 — a sign-out that fails, OR that resolves without actually ending the session, is surfaced and never
 * swallowed: the busy state is released and a localized alert appears, so the control is retryable instead of
 * marching the viewer to the public page on a session that is still live.
 *
 * @pattern Command over the app's one sign-out use case, `useSignOutAndLeave` — that module owns the mechanism, the
 *     ordering and the session-ended post-condition (ADR-0009); this leaf owns only busy and error.
 */
import { useState } from 'react';
import { ProfileRow, profileMessages } from '@commise/features-account/profile';
import { useMessages } from '@commise/i18n/react';

import { useSignOutAndLeave } from '@/components/auth/useSignOutAndLeave';

export function LogoutButton() {
    const t = useMessages(profileMessages);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const { signOutAndLeave } = useSignOutAndLeave();

    /**
     * Issue the sign-out command, surfacing a rejection instead of stranding the viewer (see the module doc).
     *
     * @sideEffect Destroys the Clerk session and replaces the current document.
     */
    const handleLogout = async (): Promise<void> => {
        setIsLoading(true);
        setError(null);

        try {
            await signOutAndLeave();
        } catch {
            // Generic on purpose — never echoes the raw error to the viewer.
            setError(t.signOutFailed);
            setIsLoading(false);
        }
    };

    return (
        <>
            {/* An ink row, not red: signing out is not destructive (`buildSpec.md` §9.1). */}
            <ProfileRow
                label={isLoading ? t.signingOut : t.signOut}
                tone="ink"
                chevron={false}
                busy={isLoading}
                onPress={() => void handleLogout()}
            />
            {error !== null && (
                <p role="alert" className="px-4 pb-3 text-meta text-danger-text">
                    {error}
                </p>
            )}
        </>
    );
}
