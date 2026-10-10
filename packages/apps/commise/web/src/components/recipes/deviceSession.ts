'use client';

/**
 * @module @commise/web — the ONE key/value store the browser keeps a cook's editor work in, and its end with their
 * session (ADR-0057, ADR-0054): the editor's drafts and the outbox journal, both in the tab's session storage (owner D7,
 * as amended 2026-10-09). The end itself — drafts, journal and the tab's cook marks — is `@commise/features-recipes`'
 * `endDeviceSession`, shared with mobile; this module binds it to this store.
 *
 * ⛔ ONE OBJECT for the app: `draftStoreFor` and `outboxMutatorFor` each memoize one serial writer per store object, so
 * the editor, the outbox observer, `SyncProvider` and the session end share their writers only while they share this.
 *
 * ⛔ The outbox journal has the DRAFT'S lifetime, on purpose (ADR-0057 §3). In memory it died with a reload while the
 * draft survived it: a create on the wire was forgotten, and the reopened editor sent it again — a second recipe.
 *
 * ⛔ A DUPLICATED TAB COPIES IT. Both tabs would then send the same pending create. The store answers `isCopy` through a
 * Web Lock each live tab holds (`createTabCopyProbe`), and the outbox's first read parks the copy's pending creates, so
 * the cook decides. Where Web Locks is missing (an insecure origin), every first read treats the journal as a copy.
 *
 * Storage, locks and ids are resolved at first use, so a server render that imports this touches nothing.
 */
import { endDeviceSession as endStoredDeviceSession } from '@commise/features-recipes';
import { createTabCopyProbe, createWebStorageStore, type LockManagerLike } from '@kitchensink/sync';

/** The browser's Web Locks, or `undefined` where the origin is not secure or the browser predates them. */
function browserLocks(): LockManagerLike | undefined {
    return typeof navigator !== 'undefined' && 'locks' in navigator ? navigator.locks : undefined;
}

/** The web's one store for the cook's editor work: the tab's session storage. */
export const webDeviceStore = createWebStorageStore(() => window.sessionStorage, {
    isCopy: createTabCopyProbe({
        locksOf: browserLocks,
        storageOf: () => window.sessionStorage,
        mintId: () => crypto.randomUUID(),
    }),
});

/**
 * End a cook's device session in this tab: their drafts, their outbox, both quarantines, and every cook mark.
 *
 * @param subject - The cook who was signed in (Clerk `userId`), or `undefined` when nobody was.
 * @sideEffect Removes keys from session storage, through each store's own writer.
 */
export function endDeviceSession(subject: string | undefined): Promise<void> {
    return endStoredDeviceSession(webDeviceStore, subject);
}
