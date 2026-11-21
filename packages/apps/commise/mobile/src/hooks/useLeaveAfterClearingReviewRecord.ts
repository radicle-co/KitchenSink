/**
 * `useLeaveAfterClearingReviewRecord` — the `leave` step of the account CLOSE and ERASE sequences on the phone: clear this
 * cook's store-review record, then end the session through the app's one sign-out command (S12 U2, plan 0011 KTD2).
 *
 * Both sequences run `useSignOutAndVerify`, so that command cannot tell a close or an erase from a plain sign-out, and a
 * plain sign-out must keep the record. The sequences' composition points can tell, so the clear sits here: after the
 * close or the erasure was accepted (the step before `leave`), before the sign-out, while Clerk still knows the cook.
 * The clear never rejects (the record reports a storage failure itself), so it can never strand a cook signed in to a
 * closed account.
 *
 * @pattern Decorator — the sign-out command, wrapped with one step before it.
 */
import { useAuth } from '@clerk/expo';

import { nativeStoreReviewRecord } from '../storage/storeReviewRecord.js';
import { useSignOutAndVerify } from './useSignOutAndVerify.js';

/**
 * @returns The `leave` step: clears the signed-in cook's record, then signs out and proves it.
 * @sideEffect Removes the cook's store-review entry from the device, then destroys the Clerk session.
 */
export function useLeaveAfterClearingReviewRecord(): () => Promise<void> {
    const { signOutAndVerify } = useSignOutAndVerify();
    const { userId } = useAuth();

    return async () => {
        await nativeStoreReviewRecord.clear(userId ?? undefined);
        await signOutAndVerify();
    };
}
