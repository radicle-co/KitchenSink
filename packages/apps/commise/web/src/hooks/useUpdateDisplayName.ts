'use client';

/**
 * `useUpdateDisplayName` — the web write of the signed-in viewer's display name (`PATCH /api/v1/users/me`), and the
 * only write the Profile page makes. The mobile twin is `useUpdateProfile`.
 *
 * A TanStack mutation is the Command; on success it invalidates the shared profile key (`profileServiceKeys.me`, the
 * same address the read and the shell's avatar use), so the new name reaches the header, the sidebar's profile row and
 * the Home greeting without a reload. The bearer token is minted per call from Clerk's session, never held: a session
 * token lives about a minute, so one captured at render would be stale by the time a cook finished typing.
 *
 * @pattern Command — a TanStack mutation over the profile PATCH, whose success invalidates the profile read
 */
import { useAuth } from '@clerk/nextjs';
import { profileServiceKeys } from '@commise/features-account';
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import type { UserProfile } from '@kitchensink/schema-identity';

import { createProfileServiceClient } from '@/lib/identityServiceClient';

/**
 * @returns A mutation taking the new display name. It resolves with the updated profile.
 * @sideEffect Sends an authenticated `PATCH` to the identity service and invalidates the profile query.
 */
export function useUpdateDisplayName(): UseMutationResult<UserProfile, Error, string> {
    const { getToken } = useAuth();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (displayName: string) =>
            createProfileServiceClient(async () => (await getToken()) ?? '').patchMe({ displayName }),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: profileServiceKeys.me }),
    });
}
