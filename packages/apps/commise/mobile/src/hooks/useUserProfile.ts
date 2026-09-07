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

/**
 * The ACCOUNT-level ERASURE command (plan U2) — irreversible, and NOT {@link useDeleteAccount}.
 *
 * ⛔ Why it exists. The app's "erase my data" control called the RECIPE service and nothing else, so an
 * erasure destroyed the viewer's recipes and left the identity row, the Clerk account, the avatar object and
 * food's requester rows intact — the user could sign straight back in to an account they had been told was
 * destroyed. Identity owns the user and is the only service that can start the cross-service erasure
 * (it enqueues the message whose worker deletes the Clerk account and fans out to recipe and food).
 *
 * Unlike `useDeleteAccount` this does NOT sign out: the erase flow owns the exit, because it must only
 * leave once BOTH legs are accepted, and it verifies the session actually ended (ADR-0009).
 *
 * @returns The TanStack mutation for `POST /api/v1/users/me/erasure`.
 * @sideEffect Issues an authenticated request that irreversibly destroys the signed-in account.
 */
export function useEraseAccount() {
    const client = useProfileServiceClient();

    return useMutation({ mutationFn: async () => client.eraseMe() });
}
