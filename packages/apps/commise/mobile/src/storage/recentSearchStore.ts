/**
 * The NATIVE adapter for the shared `RecentSearchStore` port (U7 recent searches) —
 * `@react-native-async-storage/async-storage`, whose own `getItem`/`setItem` surface the port was
 * deliberately shaped after, so this file is an error-absorbing pass-through and nothing more.
 *
 * AsyncStorage (not `expo-secure-store`): a search history is ordinary, non-sensitive app data, and putting
 * it in the keychain would be both semantically wrong and needlessly slow. Its `tokenCache` neighbour is the
 * right home for secrets; this is not one.
 *
 * Failures are swallowed to "nothing stored"/"not written": if the native module is unavailable (a stale
 * dev client that has not been rebuilt since this dependency was added) the recent-search shortcut is simply
 * absent, and search itself still works exactly as before.
 *
 * Module-level singleton on purpose: the store's identity is a `useEffect` dependency inside
 * `useRecentSearches`, so a fresh object per render would re-read storage on every render.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { RecentSearchStore } from '@commise/features-recipes';

/** The `AsyncStorage`-backed recent-search store for the mobile app. */
export const nativeRecentSearchStore: RecentSearchStore = {
    /**
     * Read the stored history payload.
     *
     * @param key - The storage key.
     * @returns The raw payload, or `null` when unset or unreadable.
     * @sideEffect Reads `AsyncStorage`.
     */
    getItem: async (key: string): Promise<string | null> => {
        try {
            return await AsyncStorage.getItem(key);
        } catch {
            return null;
        }
    },
    /**
     * Persist the history payload, silently doing nothing when the write fails.
     *
     * @param key - The storage key.
     * @param value - The payload to store.
     * @sideEffect Writes `AsyncStorage`.
     */
    setItem: async (key: string, value: string): Promise<void> => {
        try {
            await AsyncStorage.setItem(key, value);
        } catch {
            // Best-effort: a history we cannot persist is not an error worth surfacing.
        }
    },
};
