'use client';

/**
 * @module auth/LogoutButton — the web sign-out control (U3).
 *
 * **Leaving the app on sign-out is a FULL-DOCUMENT navigation, deliberately** — the same conclusion the
 * account CLOSE and ERASE flows were fixed to (see `AccountCloseForm` / `AccountEraseForm`). Clerk's
 * `signOut({ redirectUrl })` leaves via the Next router, which re-renders the authenticated shell from a
 * client-side payload that was resolved for a session that no longer exists; observed end-to-end on those
 * flows, the viewer was left sitting on an authenticated route for a dead session. So this control awaits
 * `signOut()` (session cookies gone) and only then hard-navigates to the app's public entry, where the root
 * route's own auth gate sends a signed-out caller to the branded welcome hero.
 *
 * B17 — a rejected sign-out is surfaced, never swallowed: the busy state is released and a localized alert
 * appears, so the control is retryable instead of spinning forever on a session that may still be live.
 */
import { useState } from 'react';
import { useClerk } from '@clerk/nextjs';
import { Button } from '@commise/ui/button';
import { useMessages } from '@commise/i18n/react';

import { withBasePath } from '@/lib/basePath';
import { navigateTo } from '@/lib/navigation';
import { authMessages } from '@/components/auth/messages';
import { errorText } from '@/components/auth/authChrome';
import { LogOutIcon } from '@/components/auth/icons';

interface LogoutButtonProps {
    /** Overrides the default localized "Sign out" label (e.g. a page-specific phrasing). */
    children?: React.ReactNode;
}

export function LogoutButton({ children }: LogoutButtonProps) {
    const { session } = useMessages(authMessages);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const { signOut } = useClerk();

    /**
     * End the session, then leave the app with a full document load (see the module doc).
     *
     * @sideEffect Destroys the Clerk session and replaces the current document.
     */
    const handleLogout = async (): Promise<void> => {
        setIsLoading(true);
        setError(null);

        try {
            await signOut();
            // Clerk's own redirect is not basePath-aware (ADR-0001 / U2); prefix it. No-op in production.
            navigateTo(withBasePath('/'));
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
