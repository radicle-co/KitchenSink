import { useAuth as useIdpAuth, useUser } from '@clerk/expo';
import { deriveAuthState, type AuthState } from '@commise/features-account';
import { useMemo } from 'react';

// Re-exported so existing mobile imports (`from '../hooks/useAuth'`) keep resolving the shared
// derivation; the logic itself lives in @commise/features-account (shared with web).
export { deriveAuthState };

export function useAuth(): {
    state: AuthState;
    getToken: () => Promise<string | null>;
    signOut: () => Promise<void>;
} {
    const { isLoaded, isSignedIn, userId, sessionClaims, getToken, signOut } = useIdpAuth();
    const { user } = useUser();

    const state = useMemo<AuthState>(
        () =>
            deriveAuthState({
                isLoaded,
                isSignedIn,
                userId,
                sessionClaims: sessionClaims as Record<string, unknown> | null,
                userPublicMetadata: user?.publicMetadata as Record<string, unknown> | null,
            }),
        [isLoaded, isSignedIn, userId, sessionClaims, user],
    );

    return { state, getToken, signOut };
}
