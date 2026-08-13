/**
 * `useUserProfile` / `useUpdateProfile` / `useDeleteAccount` — the mobile read/update/delete of the
 * signed-in viewer's identity profile (`GET`/`PATCH`/`DELETE /api/v1/users/me`), mirroring the web hook
 * (`web/src/hooks/useUserProfile.ts`) so both platforms gate identically (CODING_STANDARDS §14).
 *
 * DA10-c: all three go through the typed `ProfileServiceClient`, built by the shared
 * {@link useProfileServiceClient} factory (which owns the identity origin and the native token policy, so the
 * avatar presign cannot drift from these three). The profile READ force-refreshes its token; the update/delete
 * MUTATIONS accept a cached one.
 *
 * B12: the profile query key + `staleTime` come from `@commise/features-account`'s `profileQueries`
 * factory — the same shared cache policy `useUserProfile` (web) consumes — instead of a locally duplicated
 * `PROFILE_KEY` constant and `staleTime` literal.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth as useIdpAuth } from '@clerk/expo';
import { profileQueries, profileServiceKeys } from '@commise/features-account';
import type { UserUpdateInput } from '@kitchensink/schema-identity';

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

export function useUpdateProfile() {
    const client = useProfileServiceClient();
    const qc = useQueryClient();

    return useMutation({
        mutationFn: (body: UserUpdateInput) => client.patchMe(body),
        onSuccess: () => qc.invalidateQueries({ queryKey: profileServiceKeys.me }),
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
