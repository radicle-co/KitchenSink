/**
 * @module mobile/storage — what the device keeps for one cook, and its end with their session (ADR-0057, ADR-0054): the
 * editor's drafts and the outbox, both in AsyncStorage and namespaced by the cook. Both are removed once a sign-out is
 * PROVEN to have ended the session (`signOutAndVerify`).
 *
 * ⛔ The outbox store is ONE object for the app, handed to `SyncProvider`, so the session end reaches the store the
 * queue actually writes.
 */
import { quarantineKeyFor, storeKeyFor } from '@kitchensink/sync';

import { editorDraftsFor } from './editorDrafts.js';
import { createNativeOutboxStore } from './outboxStore.js';

/** The outbox's store: AsyncStorage, surviving a relaunch. */
export const nativeOutboxStore = createNativeOutboxStore();

/**
 * Remove what the device kept for a cook: their editor drafts (and their quarantine) and their outbox.
 *
 * @param subject - The cook who was signed in (Clerk `userId`), or `undefined` when nobody was.
 * @sideEffect Removes keys from AsyncStorage.
 */
export async function endDeviceSession(subject: string | undefined): Promise<void> {
    if (subject === undefined) {
        return;
    }

    await editorDraftsFor(subject)?.clear();
    await nativeOutboxStore.removeItem(storeKeyFor(subject));
    await nativeOutboxStore.removeItem(quarantineKeyFor(subject));
}
