/**
 * `useDeleteAccount` — the mobile account CLOSE (`DELETE /api/v1/users/me`), mirroring the web `AccountCloseForm` so
 * both platforms gate identically (CODING_STANDARDS §14).
 *
 * ⚠️ NOT the erasure command. `useEraseAccount` is the irreversible cross-service destruction (plan U2); this
 * closes the account and signs out. The two are kept apart deliberately — see that hook's docstring for the
 * defect that came of conflating them.
 *
 * The exit is the app's ONE sign-out command, {@link useSignOutAndVerify} (ADR-0009): it proves the session ended
 * and only then ends the device session (ADR-0057). It runs inside the mutation, so a closure whose exit failed is
 * this mutation's error and the danger zone reports it — the closure is accepted by then, so silence would strand
 * the cook signed in to a closed account.
 *
 * DA10-c: goes through the typed `ProfileServiceClient` from {@link useProfileServiceClient}; a mutation
 * accepts a cached token.
 *
 * @pattern Command — a TanStack mutation over the closure, then the verified sign-out, ordered by `useClosureSequence`
 */
import { useClosureSequence } from '@commise/features-account';

import { useProfileServiceClient } from './useProfileServiceClient.js';
import { useSignOutAndVerify } from './useSignOutAndVerify.js';

/**
 * @returns The closure mutation; its `error` is a `ClosureStepError` naming the step that failed.
 * @sideEffect Closes the signed-in account, then ends the session and the device session.
 */
export function useDeleteAccount() {
    const { signOutAndVerify } = useSignOutAndVerify();
    const client = useProfileServiceClient();

    return useClosureSequence({ close: () => client.deleteMe(), leave: signOutAndVerify });
}
