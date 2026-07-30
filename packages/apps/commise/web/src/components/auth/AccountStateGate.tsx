'use client';

import type { ReactNode } from 'react';
import { useAuth, useUser } from '@clerk/nextjs';
import { useMessages } from '@commise/i18n/react';
import { deriveAuthState } from '@commise/features-account';

import { AccountStateNotice } from '@/components/auth/AccountStateNotice';
import { authMessages } from '@/components/auth/messages';

interface AccountStateGateProps {
    children: ReactNode;
}

/**
 * Web counterpart of the mobile `AuthGate` blocked-state handling: derives the account state from
 * the same shared `deriveAuthState` and refuses to render protected content for suspended or
 * impersonated sessions. Unauthenticated access is already handled upstream by `middleware.ts`
 * (redirect to sign-in), so this gate only guards the signed-in blocked states.
 *
 * ⚠️ It does NOT gate the clerk-js LOAD window on web, unlike its mobile counterpart — do not rely on it for
 * that. `@clerk/nextjs` feeds `deriveState` an SSR `initialState`, so while clerk-js is still loading the
 * derivation falls back to that server state (which carries a `userId`) and `isLoaded` reads `true`, making the
 * `'loading'` branch below effectively unreachable here. Anything that needs a LOADED Clerk — notably
 * `useClerk().signOut`, which resolves without revoking anything before load — must handle that itself: see
 * docs/architecture/decisions/0009-clerk-signout-load-gate.md.
 *
 * The identity service is the real enforcement boundary; this mirrors mobile so the security state
 * is not silently omitted on web (cross-platform parity).
 */
export function AccountStateGate({ children }: AccountStateGateProps) {
    const { state: stateCopy } = useMessages(authMessages);
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
        return (
            <p role="status" className="text-body-md text-slate">
                {stateCopy.loading}
            </p>
        );
    }

    if (state.status === 'blocked') {
        return <AccountStateNotice message={state.reason} />;
    }

    return <>{children}</>;
}
