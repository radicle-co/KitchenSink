'use client';

/**
 * @module auth/useEraseAccount — the ACCOUNT-level erasure command (web; plan U2).
 *
 * ⛔ **Why this exists at all.** The app's "erase my data" control called the RECIPE service and nothing
 * else, so an erasure destroyed the viewer's recipes and left the identity row, the Clerk account, the
 * avatar object and food's requester rows all intact — a user who had been told their data was erased could
 * sign straight back in. Recipe cannot close that gap: it does not own the user and holds no Clerk secret.
 * Identity does, and `POST /api/v1/users/me/erasure` is what starts the cross-service erasure (identity
 * scrubs its row, then the deletion-worker deletes the Clerk account and fans out to recipe and food).
 *
 * **Why a hook rather than a `useMutation` inlined in the form.** Its sibling — the recipe-side
 * `useRequestAccountErasure` — is a hook from the generated client package, and the erasure form's tests
 * double it at that seam. An inlined mutation has no seam to double, so every one of those tests would have
 * to grow a `QueryClientProvider` to exercise behaviour that has nothing to do with query plumbing. Matching
 * the shape of the call it sits beside keeps the component orchestrational and the tests about the flow.
 *
 * Command pattern, per the repo's pattern-first convention: a TanStack mutation IS the Command, so nothing
 * further is layered on top of it.
 */
import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import { useAuth } from '@clerk/nextjs';
import type { EraseAccountResult } from '@commise/features-account';

import { createProfileServiceClient } from '@/lib/identityServiceClient';

/**
 * The account-erasure command. Irreversible: on success the Clerk account is queued for deletion and the
 * viewer's data is erased across every service that holds it.
 *
 * @returns The TanStack mutation for `POST /api/v1/users/me/erasure`.
 * @sideEffect Issues an authenticated request that irreversibly destroys the signed-in account.
 */
export function useEraseAccount(): UseMutationResult<EraseAccountResult, Error, void> {
    const { getToken } = useAuth();

    return useMutation({
        // Adapted, not passed through: Clerk's `GetToken` takes its OWN options object and can resolve
        // `null`, while `TokenSource` promises a string. Handing `getToken` over directly type-errors, and
        // widening `TokenSource` to accept it would let a null token reach the client as the string "null".
        mutationFn: async () =>
            createProfileServiceClient(
                async ({ forceRefresh } = {}) => (await getToken({ skipCache: forceRefresh })) ?? '',
            ).eraseMe(),
    });
}
