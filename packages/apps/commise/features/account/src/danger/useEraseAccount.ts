/**
 * @module danger/useEraseAccount — the ACCOUNT-level erasure command, shared by both apps (plan U2).
 *
 * ⛔ **Why it exists at all.** The app's "erase my data" control called the RECIPE service and nothing else, so an
 * erasure destroyed the viewer's recipes and left the identity row, the Clerk account, the avatar object and food's
 * requester rows intact — a user who had been told their data was erased could sign straight back in. Recipe cannot
 * close that gap: it does not own the user and holds no Clerk secret. Identity does, and
 * `POST /api/v1/users/me/erasure` is what starts the cross-service erasure (identity scrubs its row, then the
 * deletion worker deletes the Clerk account and fans out to recipe and food).
 *
 * Unlike a closure this does NOT sign out: the erase flow owns the exit, because it must only leave once BOTH legs are
 * accepted, and it verifies the session actually ended (ADR-0009).
 *
 * **Why a hook rather than a `useMutation` inlined in the form.** Its sibling, the recipe-side
 * `useRequestAccountErasure`, is a hook from the generated client package, and the erasure form's tests double it at
 * that seam. An inlined mutation has no seam to double. The client is a PARAMETER because it is platform-bound (the
 * identity origin, web's 401 redirect, mobile's token template); each app builds it with its own
 * `useProfileServiceClient`.
 *
 * @pattern Command — a TanStack mutation IS the Command, so nothing is layered on top of it
 */
import { useMutation, type UseMutationResult } from '@tanstack/react-query';

import type { EraseAccountResult, ProfileServiceClient } from '../profileServiceClient.js';

/**
 * The account-erasure command. Irreversible: on success the Clerk account is queued for deletion and the viewer's
 * data is erased across every service that holds it.
 *
 * @param client - The platform's identity client.
 * @returns The TanStack mutation for `POST /api/v1/users/me/erasure`.
 * @sideEffect Issues an authenticated request that irreversibly destroys the signed-in account.
 */
export function useEraseAccount(client: ProfileServiceClient): UseMutationResult<EraseAccountResult, Error, void> {
    return useMutation({ mutationFn: async () => client.eraseMe() });
}
