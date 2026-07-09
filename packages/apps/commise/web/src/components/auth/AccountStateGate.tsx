'use client';

import type { ReactNode } from 'react';
import { useAuth, useUser } from '@clerk/nextjs';
import { deriveAuthState } from '@commise/features-account';

import { AccountStateNotice } from '@/components/auth/AccountStateNotice';

interface AccountStateGateProps {
    children: ReactNode;
}

/**
 * Web counterpart of the mobile `AuthGate` blocked-state handling: derives the account state from
 * the same shared `deriveAuthState` and refuses to render protected content for suspended or
 * impersonated sessions. Unauthenticated access is already handled upstream by `middleware.ts`
 * (redirect to sign-in), so this gate only guards the signed-in blocked states + the load gap.
 *
 * The identity service is the real enforcement boundary; this mirrors mobile so the security state
 * is not silently omitted on web (cross-platform parity).
 */
export function AccountStateGate({ children }: AccountStateGateProps) {
    const { isLoaded, isSignedIn, userId, sessionClaims } = useAuth();
    const { user } = useUser();

    const state = deriveAuthState({
        isLoaded,
        isSignedIn,
        userId,
        sessionClaims: sessionClaims as Record<string, unknown> | null,
        userPublicMetadata: user?.publicMetadata as Record<string, unknown> | null,
    });

    if (state.status === 'loading') {
        return <p role="status">Loading your account…</p>;
    }

    if (state.status === 'blocked') {
        return <AccountStateNotice message={state.reason} />;
    }

    return <>{children}</>;
}
