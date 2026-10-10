/**
 * @module @kitchensink/sync — a Web Storage adapter for the key/value port.
 *
 * Built for the web editor's work in `sessionStorage` (owner ruling D7, ADR-0057): its draft, and the outbox journal of
 * its pending writes, which must live exactly as long as the draft (a journal that died with a reload while its draft
 * survived let the editor send a create twice). Both survive a reload in the same tab and end when the tab closes. ⛔
 * D7 is a narrow exception to the owner's ruling of 2026-09-17 that the browser keeps no durable app data: ids and form
 * values only, and the editor is the outbox's only writer.
 *
 * ⛔ STORAGE IS RESOLVED ON EVERY CALL, AND EVERY THROW BECOMES A REJECTION. Web Storage is synchronous and throws: a
 * full quota on `setItem`, a browser that blocks storage on the `sessionStorage` getter itself, and no `window` at all
 * during a server render. Constructing this adapter touches nothing, and a caller of the port only ever sees a
 * rejected promise.
 *
 * @pattern Adapter — the synchronous `Storage` API behind the asynchronous `OutboxStore` port
 */
import type { OutboxStore } from './outboxStore.js';

/** The three `Storage` members the adapter uses. */
export type WebStorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Options for {@link createWebStorageStore}. */
export interface WebStorageStoreOptions {
    /** Whether the storage may be a copy another live tab holds (`createTabCopyProbe`); see `OutboxStore.isCopy`. */
    readonly isCopy?: () => Promise<boolean>;
}

/**
 * Adapt Web Storage to the port.
 *
 * @param storageOf - Returns the storage to use, e.g. `() => window.sessionStorage`. Called per operation.
 * @param options - The copy probe, for storage a duplicated tab copies.
 * @returns The store. @sideEffect Its methods read and write the storage `storageOf` returns.
 */
export function createWebStorageStore(
    storageOf: () => WebStorageLike,
    options: WebStorageStoreOptions = {},
): OutboxStore {
    return {
        getItem: async (key) => storageOf().getItem(key),
        setItem: async (key, value) => {
            storageOf().setItem(key, value);
        },
        removeItem: async (key) => {
            storageOf().removeItem(key);
        },
        ...(options.isCopy === undefined ? {} : { isCopy: options.isCopy }),
    };
}
