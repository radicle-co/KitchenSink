/**
 * @module @kitchensink/sync — a Web Storage adapter for the key/value port.
 *
 * Built for ONE use: the web editor's draft in `sessionStorage` (owner ruling D7, ADR-0057). It survives a reload in
 * the same tab and ends when the tab closes. ⛔ It is NOT the outbox's web adapter — the outbox stays volatile in the
 * browser (`createMemoryOutboxStore`, owner ruling 2026-09-17), and D7 is a narrow exception for the editor draft
 * alone.
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

/**
 * Adapt Web Storage to the port.
 *
 * @param storageOf - Returns the storage to use, e.g. `() => window.sessionStorage`. Called per operation.
 * @returns The store. @sideEffect Its methods read and write the storage `storageOf` returns.
 */
export function createWebStorageStore(storageOf: () => WebStorageLike): OutboxStore {
    return {
        getItem: async (key) => storageOf().getItem(key),
        setItem: async (key, value) => {
            storageOf().setItem(key, value);
        },
        removeItem: async (key) => {
            storageOf().removeItem(key);
        },
    };
}
