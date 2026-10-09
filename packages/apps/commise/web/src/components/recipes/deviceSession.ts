'use client';

/**
 * @module @commise/web — what the browser keeps for one cook, and its end with their session (ADR-0057, ADR-0054): the
 * editor's drafts and the cook marks in the tab's session storage, and the outbox in memory. All are removed once a
 * sign-out is PROVEN to have ended the session (`signOutAndVerify`), before the sign-out leaves the page.
 *
 * ⛔ The outbox store is ONE object for the app, handed to `SyncProvider`, so the session end reaches the store the
 * queue actually writes.
 */
import { clearStoredCookMarks } from '@commise/features-recipes';
import { createMemoryOutboxStore, quarantineKeyFor, storeKeyFor } from '@kitchensink/sync';

import { editorDraftsFor } from '@/components/recipes/editorDrafts';

/** The web outbox's store: volatile, ending with the page. */
export const webOutboxStore = createMemoryOutboxStore();

/**
 * Remove what the browser kept for a cook: every cook mark (D18 — whoever made them, as the marks store's own sign-out
 * rule does), their editor drafts (and their quarantine) and their outbox.
 *
 * ⛔ The marks are removed HERE and not only by `CookMarksProvider`'s scope: that runs from an effect, and the sign-out
 * leaves with a full document load that can unload the page before it does.
 *
 * @param subject - The cook who was signed in (Clerk `userId`), or `undefined` when nobody was.
 * @sideEffect Removes keys from session storage and the outbox store.
 */
export async function endDeviceSession(subject: string | undefined): Promise<void> {
    clearStoredCookMarks();

    if (subject === undefined) {
        return;
    }

    await editorDraftsFor(subject)?.clear();
    await webOutboxStore.removeItem(storeKeyFor(subject));
    await webOutboxStore.removeItem(quarantineKeyFor(subject));
}
