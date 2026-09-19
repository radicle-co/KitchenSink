/**
 * `useUpdateProfile` — the mobile PATCH of the signed-in viewer's identity profile
 * (`PATCH /api/v1/users/me`), mirroring the web hook so both platforms gate identically
 * (CODING_STANDARDS §14).
 *
 * DA10-c: goes through the typed `ProfileServiceClient` built by the shared {@link useProfileServiceClient}
 * factory, which owns the identity origin and the native token policy. A mutation accepts a CACHED token
 * (only the profile READ force-refreshes).
 *
 * B12: the invalidated key comes from `@commise/features-account`'s `profileServiceKeys`, the same shared
 * cache policy the read consumes, rather than a locally duplicated constant.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { profileServiceKeys } from '@commise/features-account';
import type { UserUpdateInput } from '@kitchensink/schema-identity';

import { useProfileServiceClient } from './useProfileServiceClient.js';

export function useUpdateProfile() {
    const client = useProfileServiceClient();
    const qc = useQueryClient();

    return useMutation({
        mutationFn: (body: UserUpdateInput) => client.patchMe(body),
        onSuccess: () => qc.invalidateQueries({ queryKey: profileServiceKeys.me }),
    });
}
