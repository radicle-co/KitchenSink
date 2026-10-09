'use client';

/**
 * @module @commise/web — what the browser keeps for one cook, and its end with their session (ADR-0057, ADR-0054): the
 * editor's drafts in the tab's session storage, and the outbox in memory. Both are namespaced by the cook, and both are
 * removed once a sign-out is PROVEN to have ended the session (`signOutAndVerify`).
 *
 * ⛔ The outbox store is ONE object for the app, handed to `SyncProvider`, so the session end reaches the store the
 * queue actually writes.
 */
import { createMemoryOutboxStore, quarantineKeyFor, storeKeyFor } from '@kitchensink/sync';

import { editorDraftsFor } from '@/components/recipes/editorDrafts';

/** The web outbox's store: volatile, ending with the page. */
export const webOutboxStore = createMemoryOutboxStore();

/**
 * Remove what the browser kept for a cook: their editor drafts (and their quarantine) and their outbox.
 *
 * @param subject - The cook who was signed in (Clerk `userId`), or `undefined` when nobody was.
 * @sideEffect Removes keys from session storage and the outbox store.
 */
export async function endDeviceSession(subject: string | undefined): Promise<void> {
    if (subject === undefined) {
        return;
    }

    await editorDraftsFor(subject)?.clear();
    await webOutboxStore.removeItem(storeKeyFor(subject));
    await webOutboxStore.removeItem(quarantineKeyFor(subject));
}
