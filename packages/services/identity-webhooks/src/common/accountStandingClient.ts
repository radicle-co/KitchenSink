import { SUSPENDED_METADATA_KEY } from '@kitchensink/clerk-verify';

import { getClerkClient, isAlreadyDeleted } from './identityClient.js';

/**
 * Write or clear the suspended mark in a Clerk user's `public_metadata` (ADR-0081).
 *
 * ⛔ THE THIRD `public_metadata` WRITER, admitted by `metadataSingleWriter.test.ts` on its three conditions: it MERGES
 * (`updateUserMetadata`, never `updateUser({ publicMetadata })`, which replaces the whole object and would erase the
 * user's roles, scopes and test-pool marker), it writes the `suspended` key only, and it is the only metadata write in
 * this module. Clearing writes `null`, which Clerk's deep merge reads as "remove the key"; the verifier treats an absent
 * key, `null` and `false` alike, so a clear can never leave the account suspended.
 *
 * The value written is derived by the caller from the stored status, never from a message, so a redelivered or
 * out-of-order trigger writes the current truth (U10).
 *
 * A user Clerk no longer holds (404) converges as `'absent'`: there is no token to mark.
 *
 * @param userId - The Clerk user id.
 * @param suspended - `true` to mark the account suspended; `false` to clear the mark.
 * @returns `'written'`, or `'absent'` when Clerk no longer holds the user.
 * @throws When Clerk cannot be written for any other reason, so the message redelivers.
 * @sideEffect Merges one key into the user's `public_metadata` through the Clerk admin API.
 */
export const setSuspendedMark = async (userId: string, suspended: boolean): Promise<'written' | 'absent'> => {
    const client = await getClerkClient();

    try {
        await client.users.updateUserMetadata(userId, {
            publicMetadata: { [SUSPENDED_METADATA_KEY]: suspended ? true : null },
        });

        return 'written';
    } catch (error) {
        if (isAlreadyDeleted(error)) {
            return 'absent';
        }

        throw error;
    }
};
