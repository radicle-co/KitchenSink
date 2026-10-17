/**
 * @module @kitchensink/sync — whether a browser tab's `sessionStorage` is a COPY another live tab also holds.
 *
 * Duplicate Tab copies `sessionStorage`, and the web outbox journal lives there (owner ruling D7, ADR-0057 §3). Both tabs
 * would then send the same queued create on reconnect, and the server would make two recipes. A create carries no
 * version token and the owner's ruling allows no client id and no server change, so the copy has to know it is one.
 *
 * Each live tab holds a Web Lock named by an instance id it keeps in its own session storage. The lock dies with the
 * document; the id survives a reload and is copied by a duplicate. So, on the first ask:
 *
 * - no id: a fresh tab, not a copy;
 * - an id whose lock is free: this tab reloaded, not a copy (the old document released the lock);
 * - an id whose lock another tab holds: a copy.
 *
 * A tab that is not a fresh one's owner mints a new id and holds that lock, so a duplicate of a duplicate is caught too.
 *
 * ⛔ EVERY DOUBT ANSWERS "COPY". Without Web Locks a reload cannot be told from a duplicate, and a storage that throws
 * cannot be read. A false "copy" parks the cook's pending create and asks them; a false "not a copy" sends it twice.
 *
 * ⚠️ The lock is held by a callback that never settles, not by React: a component's cleanup (StrictMode runs one at
 * mount) would otherwise release it while the tab is still live.
 *
 * @pattern Proxy — the Web Locks and Web Storage APIs behind one memoized question, asked once per document
 */
import type { WebStorageLike } from './webStorageStore.js';

/** The one `LockManager.request` overload the probe uses: ask without waiting. */
export interface LockManagerLike {
    readonly request: (
        name: string,
        options: { readonly ifAvailable: true },
        callback: (lock: unknown) => unknown,
    ) => Promise<unknown>;
}

/** Where the probe finds what it needs, each resolved at the first ask, so building it touches nothing. */
export interface TabCopyProbeSources {
    /** The browser's lock manager (`navigator.locks`), or `undefined` where Web Locks is not available. */
    readonly locksOf: () => LockManagerLike | undefined;
    /** The tab's session storage. */
    readonly storageOf: () => WebStorageLike;
    /** A new instance id (`crypto.randomUUID`). */
    readonly mintId: () => string;
}

/** Where the tab keeps its instance id. */
const INSTANCE_KEY = 'commise.tab.instance';

/** The lock a live tab holds for an instance id. */
function lockNameFor(id: string): string {
    return `commise.tab.${id}`;
}

/**
 * Take the instance's lock if it is free, and hold it for the document's life.
 *
 * @sideEffect Requests a Web Lock; a granted one is never released.
 */
function holdIfFree(locks: LockManagerLike, id: string): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
        locks
            .request(lockNameFor(id), { ifAvailable: true }, (lock) => {
                if (lock === null) {
                    resolve(false);

                    return undefined;
                }

                resolve(true);

                // Held until the document goes.
                return new Promise<never>(() => undefined);
            })
            .catch(reject);
    });
}

/**
 * The tab's copy probe, for `createWebStorageStore`'s `isCopy`.
 *
 * @param sources - The lock manager, the session storage and the id source.
 * @returns A function answering whether the storage may be a copy; it probes once, and every later call gets that
 *     answer. @sideEffect The first call reads and writes the instance id and takes a Web Lock.
 */
export function createTabCopyProbe(sources: TabCopyProbeSources): () => Promise<boolean> {
    let answer: Promise<boolean> | undefined;

    const probe = async (): Promise<boolean> => {
        const locks = sources.locksOf();

        if (locks === undefined) {
            return true;
        }

        const storage = sources.storageOf();
        const held = storage.getItem(INSTANCE_KEY);

        if (held !== null && (await holdIfFree(locks, held))) {
            return false;
        }

        const fresh = sources.mintId();

        storage.setItem(INSTANCE_KEY, fresh);
        await holdIfFree(locks, fresh);

        return held !== null;
    };

    return () => {
        answer ??= probe().catch(() => true);

        return answer;
    };
}
