/**
 * The Web Storage adapter for the key/value port — what the web editor's draft uses (`sessionStorage`, owner ruling
 * D7, ADR-0057).
 *
 * The port is asynchronous and Web Storage is not. Two things a synchronous API does that a port caller must never
 * see: it THROWS (a full quota, a browser that refuses storage, a `window` that does not exist during a server
 * render), and a throw from a sync call inside an async caller escapes as an exception rather than a rejection.
 */
import { describe, expect, it } from 'vitest';

import { createWebStorageStore } from '../webStorageStore.js';

/** A Map behind the three `Storage` members the adapter uses. */
function fakeStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
    const cells = new Map<string, string>();

    return {
        getItem: (key) => cells.get(key) ?? null,
        setItem: (key, value) => {
            cells.set(key, value);
        },
        removeItem: (key) => {
            cells.delete(key);
        },
    };
}

describe('createWebStorageStore', () => {
    it('round-trips a value and removes it', async () => {
        const storage = fakeStorage();
        const store = createWebStorageStore(() => storage);

        await store.setItem('k', 'v');
        const read = await store.getItem('k');
        await store.removeItem('k');

        expect(read).toBe('v');
        expect(await store.getItem('k')).toBeNull();
    });

    it('⛔ turns a quota error into a rejection, never a synchronous throw', async () => {
        const full = {
            ...fakeStorage(),
            setItem: () => {
                throw new DOMException('quota', 'QuotaExceededError');
            },
        };
        const store = createWebStorageStore(() => full);

        let pending: Promise<void> | undefined;

        expect(() => {
            pending = store.setItem('k', 'v');
        }).not.toThrow();
        await expect(pending).rejects.toThrow('quota');
    });

    /**
     * ⛔ STORAGE IS RESOLVED PER CALL, so constructing the adapter never touches `window`. A server render builds the
     * same tree, and a browser that blocks storage throws on the `sessionStorage` getter itself.
     */
    it('⛔ touches no storage until it is called, and rejects when storage is unavailable', async () => {
        let resolved = 0;
        const store = createWebStorageStore(() => {
            resolved += 1;

            throw new Error('storage is unavailable');
        });

        expect(resolved).toBe(0);
        await expect(store.getItem('k')).rejects.toThrow('storage is unavailable');
    });
});
