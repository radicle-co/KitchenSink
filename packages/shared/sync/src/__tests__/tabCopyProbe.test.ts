/**
 * The tab-copy probe: whether this document's `sessionStorage` was copied from another live tab (Duplicate Tab copies it,
 * the outbox journal included, ADR-0057 §3). Written from the reviewers' finding before the probe existed: two tabs each
 * drained the same pending create, and the server made two recipes.
 *
 * Each live tab holds a Web Lock named by an instance id kept in its session storage. A tab that finds an id whose lock
 * another tab holds is a copy. Mutation lens: a probe that always answered `false`, never re-minted, or asked the lock
 * without `ifAvailable` fails one of these.
 */
import { describe, expect, it } from 'vitest';

import { createTabCopyProbe, type LockManagerLike } from '../tabCopyProbe.js';
import type { WebStorageLike } from '../webStorageStore.js';

/** A browser's lock manager: a held lock is never released, as a live tab's is not. Records every request. */
interface FakeLocks extends LockManagerLike {
    readonly requests: unknown[];
    readonly held: Set<string>;
}

function fakeLocks(held: Set<string> = new Set()): FakeLocks {
    const requests: unknown[] = [];

    return {
        requests,
        held,
        request: (name, options, callback) => {
            requests.push({ name, options });

            if (held.has(name)) {
                return Promise.resolve(callback(null));
            }

            held.add(name);

            return Promise.resolve(callback({ name }));
        },
    };
}

/** One tab's session storage. `copy` duplicates it, as the browser does on Duplicate Tab. */
interface FakeStorage extends WebStorageLike {
    readonly copy: () => FakeStorage;
}

function fakeStorage(cells: Map<string, string> = new Map()): FakeStorage {
    return {
        getItem: (key) => cells.get(key) ?? null,
        setItem: (key, value) => {
            cells.set(key, value);
        },
        removeItem: (key) => {
            cells.delete(key);
        },
        copy: () => fakeStorage(new Map(cells)),
    };
}

function mintFrom(ids: string[]): () => string {
    return () => ids.shift() ?? 'exhausted';
}

describe('createTabCopyProbe', () => {
    it('a tab opened fresh is not a copy, and takes a lock under a new instance id', async () => {
        const locks = fakeLocks();
        const storage = fakeStorage();

        const copied = await createTabCopyProbe({
            locksOf: () => locks,
            storageOf: () => storage,
            mintId: mintFrom(['a']),
        })();

        expect(copied).toBe(false);
        expect(locks.requests).toStrictEqual([{ name: 'commise.tab.a', options: { ifAvailable: true } }]);
    });

    it('a reload is not a copy: the old document released its lock, and the tab keeps its instance id', async () => {
        const storage = fakeStorage();
        await createTabCopyProbe({ locksOf: () => fakeLocks(), storageOf: () => storage, mintId: mintFrom(['a']) })();
        // The reload: the same storage, a new document, the old document's locks gone.
        const locks = fakeLocks();

        const copied = await createTabCopyProbe({
            locksOf: () => locks,
            storageOf: () => storage,
            mintId: mintFrom(['b']),
        })();

        expect(copied).toBe(false);
        expect(locks.requests).toStrictEqual([{ name: 'commise.tab.a', options: { ifAvailable: true } }]);
    });

    /**
     * ⛔ A DUPLICATE FINDS THE ORIGINAL'S ID HELD, so it is a copy. It then takes a lock of its own under a new id, or a
     * duplicate of the duplicate would find a free lock under the copied id and read itself as the original.
     */
    it('⛔ a duplicated tab is a copy, and a duplicate of the duplicate is one too', async () => {
        const locks = fakeLocks();
        const original = fakeStorage();
        await createTabCopyProbe({ locksOf: () => locks, storageOf: () => original, mintId: mintFrom(['a']) })();
        const duplicate = original.copy();

        const first = await createTabCopyProbe({
            locksOf: () => locks,
            storageOf: () => duplicate,
            mintId: mintFrom(['b']),
        })();
        const second = await createTabCopyProbe({
            locksOf: () => locks,
            storageOf: () => duplicate.copy(),
            mintId: mintFrom(['c']),
        })();

        expect([first, second]).toStrictEqual([true, true]);
        expect(locks.held).toStrictEqual(new Set(['commise.tab.a', 'commise.tab.b', 'commise.tab.c']));
    });

    it('a duplicate whose original has closed is not a copy: nobody else can send its journal', async () => {
        const original = fakeStorage();
        await createTabCopyProbe({ locksOf: () => fakeLocks(), storageOf: () => original, mintId: mintFrom(['a']) })();

        const copied = await createTabCopyProbe({
            locksOf: () => fakeLocks(),
            storageOf: () => original.copy(),
            mintId: mintFrom(['b']),
        })();

        expect(copied).toBe(false);
    });

    /** Without Web Locks a tab cannot tell a reload from a duplicate, so every first read treats the journal as a copy. */
    it('⛔ without Web Locks, every probe answers that the journal may be a copy', async () => {
        const copied = await createTabCopyProbe({
            locksOf: () => undefined,
            storageOf: () => fakeStorage(),
            mintId: mintFrom(['a']),
        })();

        expect(copied).toBe(true);
    });

    it('probes once per document: a second ask gets the first answer and takes no second lock', async () => {
        const locks = fakeLocks();
        const probe = createTabCopyProbe({
            locksOf: () => locks,
            storageOf: () => fakeStorage(),
            mintId: mintFrom(['a', 'b']),
        });

        const answers = [await probe(), await probe()];

        expect(answers).toStrictEqual([false, false]);
        expect(locks.requests).toHaveLength(1);
    });

    it('a storage that throws answers "copy" rather than rejecting: the safe direction parks, it never sends twice', async () => {
        const copied = await createTabCopyProbe({
            locksOf: () => fakeLocks(),
            storageOf: () => {
                throw new Error('storage blocked');
            },
            mintId: mintFrom(['a']),
        })();

        expect(copied).toBe(true);
    });
});
