/**
 * @module mobile/storage — the ONE key/value store the device keeps a cook's editor work in, and its end with their
 * session (ADR-0057, ADR-0054): the editor's drafts and the outbox, both in AsyncStorage and namespaced by the cook. The
 * end itself is `@commise/features-recipes`' `endDeviceSession`, shared with web; this module binds it to this store.
 *
 * ⛔ ONE OBJECT for the app: `draftStoreFor` and `outboxMutatorFor` each memoize one serial writer per store object, so
 * the editor, the outbox observer, `SyncProvider` and the session end share their writers only while they share this.
 *
 * ⛔ A PHONE KEEPS A COOK'S UNSENT SAVES WHEN THEIR SESSION EXPIRES, and clears them only on a verified sign-out, an
 * account close or an erase (`useSignOutAndVerify`); a decision the owner delegated, recorded in
 * `docs/plans/2026-10-13-004-fix-stuck-save-and-session-expiry-plan.md` ("Owner ruling (2026-10-13)", decision 6). An
 * expired session (days offline, or a revoked one) takes the
 * cook's `userId` to `null` without any sign-out, and the drafts and outbox are their work: they stay under their own
 * `*.v1.{subject}` keys, which another cook on the phone cannot read, and drain after THEY sign in again. A write the
 * expiry caught parks as `401` and resumes; it is never an unknown outcome (`TokenMintFailedError`). The web differs on
 * purpose: it also ends the session when Clerk's cook changes (`useDeviceSessionScope`), because a tab is signed out
 * from other tabs and its draft lives only as long as the tab (ADR-0057, ADR-0054 §4). Do not add the web's scope here
 * to "match" it. A cook who never signs in again leaves their keys on the phone until the app's data is cleared; that
 * residue is accepted.
 */
import { endDeviceSession as endStoredDeviceSession } from '@commise/features-recipes';

import { createNativeOutboxStore } from './outboxStore.js';

/** The device's one store for the cook's editor work: AsyncStorage, surviving a relaunch. */
export const nativeDeviceStore = createNativeOutboxStore();

/**
 * End a cook's device session: their drafts, their outbox and both quarantines.
 *
 * @param subject - The cook who was signed in (Clerk `userId`), or `undefined` when nobody was.
 * @sideEffect Removes keys from AsyncStorage, through each store's own writer.
 */
export function endDeviceSession(subject: string | undefined): Promise<void> {
    return endStoredDeviceSession(nativeDeviceStore, subject);
}
