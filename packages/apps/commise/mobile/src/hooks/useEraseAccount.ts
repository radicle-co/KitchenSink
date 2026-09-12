/**
 * The ACCOUNT-level ERASURE command (plan U2) — irreversible, and NOT `useDeleteAccount`.
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
import { useMutation } from '@tanstack/react-query';

import { useProfileServiceClient } from './useProfileServiceClient.js';

export function useEraseAccount() {
    const client = useProfileServiceClient();

    return useMutation({ mutationFn: async () => client.eraseMe() });
}
