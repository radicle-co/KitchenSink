/**
 * The WEB adapter for the shared `RecentSearchStore` port (U7 recent searches) — `window.localStorage`
 * behind the port's async `getItem`/`setItem` pair.
 *
 * Two hazards this exists to absorb, both of which would otherwise surface as a crashed discovery page:
 *  - **No `window`.** Discovery renders on the server first; `localStorage` does not exist there. A server
 *    render simply reports "nothing stored" (the client hydrates the real history).
 *  - **Storage that throws.** Reading or writing `localStorage` throws outright when the browser has storage
 *    disabled or the origin is over quota (Safari private mode is the classic case) — not on some later
 *    promise, on the property access itself. A lost search history is a lost convenience; it must never be
 *    an error the surface has to handle, so every failure degrades to "nothing stored"/"not written".
 *
 * Module-level singleton on purpose: the identity of the store is a `useEffect` dependency inside
 * `useRecentSearches`, so a fresh object per render would re-read storage on every render.
 */
import type { RecentSearchStore } from '@commise/features-recipes';

/** The browser's `localStorage`, or `undefined` when it is unavailable (server render, or access throws). */
function localStorageOrUndefined(): Storage | undefined {
    if (typeof window === 'undefined') {
        return undefined;
    }

    try {
        return window.localStorage;
    } catch {
        return undefined;
    }
}

/** The `localStorage`-backed recent-search store for the web app. */
export const webRecentSearchStore: RecentSearchStore = {
    /**
     * Read the stored history payload.
     *
     * @param key - The storage key.
     * @returns The raw payload, or `null` when unavailable/unset.
     * @sideEffect Reads `window.localStorage`.
     */
    getItem: async (key: string): Promise<string | null> => {
        try {
            return localStorageOrUndefined()?.getItem(key) ?? null;
        } catch {
            return null;
        }
    },
    /**
     * Persist the history payload, silently doing nothing when storage is unavailable or full.
     *
     * @param key - The storage key.
     * @param value - The payload to store.
     * @sideEffect Writes `window.localStorage`.
     */
    setItem: async (key: string, value: string): Promise<void> => {
        try {
            localStorageOrUndefined()?.setItem(key, value);
        } catch {
            // Best-effort: a history we cannot persist is not an error worth surfacing.
        }
    },
};
