'use client';

/**
 * @module auth/LogoutButton — the web sign-out control (U3).
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
 */
import { useState } from 'react';
import { Button } from '@commise/ui/button';
import { useMessages } from '@commise/i18n/react';

import { authMessages } from '@/components/auth/messages';
import { errorText } from '@/components/auth/authChrome';
import { LogOutIcon } from '@/components/auth/icons';
import { useSignOutAndLeave } from '@/components/auth/useSignOutAndLeave';

interface LogoutButtonProps {
    /** Overrides the default localized "Sign out" label (e.g. a page-specific phrasing). */
    children?: React.ReactNode;
}

export function LogoutButton({ children }: LogoutButtonProps) {
    const { session } = useMessages(authMessages);
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
            setError(session.signOutFailed);
            setIsLoading(false);
        }
    };

    return (
        <>
            <Button variant="secondary" icon={<LogOutIcon />} onPress={handleLogout} busy={isLoading}>
                {isLoading ? session.signingOut : (children ?? session.signOut)}
            </Button>
            {error !== null && (
                <p role="alert" className={errorText}>
                    {error}
                </p>
            )}
        </>
    );
}
