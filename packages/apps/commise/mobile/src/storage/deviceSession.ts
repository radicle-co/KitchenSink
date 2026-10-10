/**
 * @module mobile/storage — the ONE key/value store the device keeps a cook's editor work in, and its end with their
 * session (ADR-0057, ADR-0054): the editor's drafts and the outbox, both in AsyncStorage and namespaced by the cook. The
 * end itself is `@commise/features-recipes`' `endDeviceSession`, shared with web; this module binds it to this store.
 *
 * ⛔ ONE OBJECT for the app: `draftStoreFor` and `outboxMutatorFor` each memoize one serial writer per store object, so
 * the editor, the outbox observer, `SyncProvider` and the session end share their writers only while they share this.
 *
 * ⚠️ Mobile ends the device session on its own sign-out only (`useSignOutAndVerify`). The web also ends it when Clerk's
 * cook changes under it (`useDeviceSessionScope`), because a tab is signed out from other tabs; whether an expired
 * session on a phone, possibly after days offline, should discard the cook's unsent saves is an owner decision.
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
