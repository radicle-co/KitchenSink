/**
 * @module @commise/features-recipes — where cook marks are kept on web: `sessionStorage` (blueprint A13), so they
 * survive a reload in the same tab and end when it closes. Only line keys and a step number are written
 * (`cookMarks.ts`), never recipe content.
 *
 * ⚠️ `docs/design/uiOverhaul/ownerDecisions.md` D7 says its `sessionStorage` exception "covers the editor draft and
 * nothing else", while A13 puts cook marks there too. The two are unreconciled; this adapter follows A13, and the port
 * makes the other answer a change to this file alone.
 *
 * A browser that refuses storage (storage disabled, a private window over quota) keeps a refused write in memory, so a
 * tap is never lost for the page's life.
 *
 * @pattern Adapter over `sessionStorage`, behind the `CookMarksBackend` port
 */
import { isCookMarksKeyOf } from './cookMarks.js';
import { memoryCookMarksBackend, type CookMarksBackend } from './cookMarksStore.js';

/** The part of `Storage` the adapter uses. */
type SessionStorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

/**
 * A backend over a session storage, with memory behind every write it refuses.
 *
 * @param storage - The tab's `sessionStorage`, or `undefined` where there is none.
 * @returns The backend.
 */
export function sessionCookMarksBackend(storage: SessionStorageLike | undefined): CookMarksBackend {
    const refused = memoryCookMarksBackend();

    const storedKeys = (): readonly string[] => {
        if (storage === undefined) {
            return [];
        }

        return Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter(
            (key): key is string => key !== null,
        );
    };

    return {
        getItem: (key) => refused.getItem(key) ?? storage?.getItem(key) ?? null,
        setItem: (key, value) => {
            try {
                if (storage === undefined) {
                    throw new Error('No session storage.');
                }

                storage.setItem(key, value);
                refused.removeItem(key);
            } catch {
                refused.setItem(key, value);
            }
        },
        removeItem: (key) => {
            refused.removeItem(key);
            storage?.removeItem(key);
        },
        keys: () => [...new Set([...storedKeys(), ...refused.keys()])],
    };
}

/**
 * The tab's session storage, where the page can reach it.
 *
 * @returns The storage, or `undefined` on the server or where the browser blocks it (reading it can throw).
 */
function tabSessionStorage(): SessionStorageLike | undefined {
    if (typeof window === 'undefined') {
        return undefined;
    }

    try {
        return window.sessionStorage;
    } catch {
        return undefined;
    }
}

/**
 * The backend this platform keeps cook marks in.
 *
 * @returns A `sessionStorage` backend (memory on the server).
 */
export function defaultCookMarksBackend(): CookMarksBackend {
    return sessionCookMarksBackend(tabSessionStorage());
}

/**
 * Remove every cook's marks from the tab — the sign-out's half of the session scope (D18, ADR-0054). The provider's
 * scope removes them too, but only from an effect, and a sign-out leaves with a full document load that can unload the
 * page first; so the sign-out command calls this once the session is proven ended.
 *
 * @sideEffect Removes keys from `sessionStorage`.
 */
export function clearStoredCookMarks(): void {
    const backend = defaultCookMarksBackend();

    for (const key of backend.keys().filter((stored) => isCookMarksKeyOf(stored))) {
        backend.removeItem(key);
    }
}
