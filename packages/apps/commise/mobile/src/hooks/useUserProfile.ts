/**
 * `useUserProfile` — the mobile READ of the signed-in viewer's identity profile (`GET /api/v1/users/me`),
 * mirroring the web hook (`web/src/hooks/useUserProfile.ts`) so both platforms gate identically
 * (CODING_STANDARDS §14).
 *
 * DA10-c: goes through the typed `ProfileServiceClient`, built by the shared {@link useProfileServiceClient}
 * factory (which owns the identity origin and the native token policy, so the avatar presign cannot drift
 * from it). This READ force-refreshes its token; the update/delete/erase MUTATIONS accept a cached one — see
 * `useUpdateProfile`, `useDeleteAccount` and `useEraseAccount`.
 *
 * B12: the profile query key + `staleTime` come from `@commise/features-account`'s `profileQueries` factory —
 * the same shared cache policy the web hook consumes — instead of a locally duplicated `PROFILE_KEY`
 * constant and `staleTime` literal.
 */
import { useQuery } from '@tanstack/react-query';
import { useAuth as useIdpAuth } from '@clerk/expo';
import { profileQueries } from '@commise/features-account';

import { useProfileServiceClient } from './useProfileServiceClient.js';

export function useUserProfile() {
    const { isSignedIn } = useIdpAuth();
    const client = useProfileServiceClient();

    return useQuery({
        // Force a fresh session token for the profile fetch — see the module doc comment.
        ...profileQueries(client).me({ forceRefresh: true }),
        enabled: Boolean(isSignedIn),
    });
}
