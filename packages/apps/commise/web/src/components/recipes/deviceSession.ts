'use client';

/**
 * @module @commise/web — what the browser keeps for one cook, and its end with their session (ADR-0057, ADR-0054): the
 * editor's drafts, the outbox journal and the cook marks, all in the tab's session storage. All are removed once a
 * sign-out is PROVEN to have ended the session (`signOutAndVerify`), before the sign-out leaves the page.
 *
 * ⛔ The outbox journal has the DRAFT'S lifetime, on purpose (ADR-0057 §1). Its only writer is the editor, and what it
 * holds are the editor's pending recipe writes — ids and form values, which D7 covers. In memory it died with a reload
 * while the draft survived it: a create on the wire was forgotten, and the reopened editor sent it again — a second
 * recipe. Kept beside the draft, a reload finds the record, the outbox's first read parks it as an unknown outcome, and
 * the cook decides; closing the tab ends both together.
 *
 * ⛔ The outbox store is ONE object for the app, handed to `SyncProvider`, so the session end reaches the store the
 * queue actually writes.
 */
import { clearStoredCookMarks } from '@commise/features-recipes';
import { createWebStorageStore, quarantineKeyFor, storeKeyFor } from '@kitchensink/sync';

import { editorDraftsFor } from '@/components/recipes/editorDrafts';

/** The web outbox's store: the tab's session storage, read at each call, so a server render touches nothing. */
export const webOutboxStore = createWebStorageStore(() => window.sessionStorage);

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
