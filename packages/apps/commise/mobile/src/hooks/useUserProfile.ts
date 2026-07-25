/**
 * `useUserProfile` / `useUpdateProfile` / `useDeleteAccount` — the mobile read/update/delete of the
 * signed-in viewer's identity profile (`GET`/`PATCH`/`DELETE /v1/users/me`), mirroring the web hook
 * (`web/src/hooks/useUserProfile.ts`) so both platforms gate identically (CODING_STANDARDS §14).
 *
 * DA10-c: all three now go through the typed `ProfileServiceClient`, constructed once per render via
 * `useProfileServiceClient`. Its `TokenSource` callback reproduces the EXACT prior per-call token policy:
 * the profile READ always force-refreshes (Clerk session tokens live ~60s; a query that refetches after the
 * app returns from background can otherwise send an expired cached token and 401 — the web server
 * component avoids this by minting a fresh token per SSR request, so this guard is mobile-specific), while
 * the update/delete MUTATIONS allow a cached token. A resolved-but-empty token throws a typed
 * `UnauthorizedError` BEFORE any request is sent — the same fail-fast the old `apiRequest` did.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth as useIdpAuth } from '@clerk/expo';
import { ProfileServiceClient, UnauthorizedError } from '@commise/features-account';
import type { UserUpdateInput } from '@kitchensink/identity-service';
import { useMemo } from 'react';

import { NATIVE_JWT_TEMPLATE } from '../auth/nativeToken.js';
import { API_BASE_URL } from '../services/api.js';

const PROFILE_KEY = ['user', 'me'] as const;

/** Build (and memoize per Clerk identity) the typed profile client used by every hook below. */
function useProfileServiceClient(): ProfileServiceClient {
    const { getToken } = useIdpAuth();

    return useMemo(
        () =>
            new ProfileServiceClient({
                baseUrl: API_BASE_URL,
                token: async (options) => {
                    const token = await getToken({
                        template: NATIVE_JWT_TEMPLATE,
                        skipCache: options?.forceRefresh ?? false,
                    });

                    if (!token) {
                        throw new UnauthorizedError('Not authenticated', 'unauthenticated');
                    }

                    return token;
                },
            }),
        [getToken],
    );
}

export function useUserProfile() {
    const { isSignedIn } = useIdpAuth();
    const client = useProfileServiceClient();

    return useQuery({
        queryKey: PROFILE_KEY,
        // Force a fresh session token for the profile fetch — see the module doc comment.
        queryFn: () => client.getMe({ forceRefresh: true }),
        enabled: Boolean(isSignedIn),
        staleTime: 2 * 60 * 1000,
    });
}

export function useUpdateProfile() {
    const client = useProfileServiceClient();
    const qc = useQueryClient();

    return useMutation({
        mutationFn: (body: UserUpdateInput) => client.patchMe(body),
        onSuccess: () => qc.invalidateQueries({ queryKey: PROFILE_KEY }),
    });
}

export function useDeleteAccount() {
    const { signOut } = useIdpAuth();
    const client = useProfileServiceClient();

    return useMutation({
        mutationFn: async () => {
            await client.deleteMe();
            await signOut();
        },
    });
}
