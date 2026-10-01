/**
 * `useDeleteAccount` — the mobile account CLOSE (`DELETE /api/v1/users/me`), mirroring the web hook so both
 * platforms gate identically (CODING_STANDARDS §14).
 *
 * ⚠️ NOT the erasure command. `useEraseAccount` is the irreversible cross-service destruction (plan U2); this
 * closes the account and signs out. The two are kept apart deliberately — see that hook's docstring for the
 * defect that came of conflating them.
 *
 * DA10-c: goes through the typed `ProfileServiceClient` from {@link useProfileServiceClient}; a mutation
 * accepts a cached token.
 */
import { useMutation } from '@tanstack/react-query';
import { useAuth as useIdpAuth } from '@clerk/expo';

import { useProfileServiceClient } from './useProfileServiceClient.js';

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
