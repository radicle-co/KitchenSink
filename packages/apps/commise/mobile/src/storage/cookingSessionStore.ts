/**
 * The NATIVE adapter for `@kitchensink/cooking-core`'s {@link CookingSessionStore} port — device storage
 * for the 24h Cooking Mode resume window (FR-033 / REQ-013).
 *
 * **Ports and adapters.** `@kitchensink/cooking-core` is platform-free and owns the SERIALIZED FORM (the
 * versioned envelope, its schema and the resume-window arithmetic); this file owns only *where the bytes
 * live on this platform*. It therefore does no parsing, no versioning and no clock reading — adding any of
 * that here would give the persisted format a second, drift-prone representation.
 *
 * `AsyncStorage`, not `expo-secure-store`: a cooking session is ordinary, non-sensitive app state (a step
 * index, some checked ingredient ids, timer timestamps), and the keychain is both semantically wrong for it
 * and far slower — the session is rewritten on EVERY meaningful change. Its `tokenCache` neighbour is the
 * right home for secrets; this is not one. Mirrors `recentSearchStore.ts`, the app's other AsyncStorage
 * adapter.
 *
 * **Failures are NOT swallowed here**, unlike `recentSearchStore`. The port's contract is explicit that a
 * rejected promise means the storage layer failed and is never the same thing as "there is no session", and
 * `useCookingSession` relies on that distinction: it converts a read fault into a FRESH session (the cook
 * loses their place, not the recipe) and absorbs write faults on its own queue. Mapping a fault to `null`
 * here would erase that choice and, worse, make a broken device silently indistinguishable from a first
 * cook.
 *
 * Module-level singleton on purpose: the store's identity is an effect dependency inside
 * `useCookingSession` (its JSDoc requires referential stability), so a fresh object per render would
 * re-run the restore on every frame.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { CookingSessionStore } from '@kitchensink/cooking-core';

/**
 * Key namespace for persisted cooking sessions.
 *
 * Namespaced because `AsyncStorage` is ONE flat key space shared with every other consumer in the app (the
 * recent-search history, Clerk's own bookkeeping); a bare `recipeId` key would be a collision waiting to
 * happen. Exported so a test can assert the exact key rather than transcribe the prefix.
 */
export const COOKING_SESSION_KEY_PREFIX = 'commise.cooking.session.';

/**
 * The storage key holding one recipe's cooking session.
 *
 * @param recipeId - The recipe whose session is addressed.
 * @returns The namespaced `AsyncStorage` key.
 */
function sessionKey(recipeId: string): string {
    return `${COOKING_SESSION_KEY_PREFIX}${recipeId}`;
}

/** The `AsyncStorage`-backed cooking-session store for the mobile app. */
export const nativeCookingSessionStore: CookingSessionStore = {
    /**
     * Read the serialized session for a recipe.
     *
     * @param recipeId - Recipe whose session to read.
     * @returns The stored payload, or `null` when the device holds none.
     * @sideEffect Reads `AsyncStorage`. Rejects when the store itself fails (never mapped to `null`).
     */
    read: async (recipeId: string): Promise<string | null> => AsyncStorage.getItem(sessionKey(recipeId)),

    /**
     * Write the serialized session for a recipe, replacing any previous entry.
     *
     * @param recipeId - Recipe whose session to write.
     * @param serialized - The payload produced by the core's `serializeSession`.
     * @sideEffect Writes `AsyncStorage`.
     */
    write: async (recipeId: string, serialized: string): Promise<void> => {
        await AsyncStorage.setItem(sessionKey(recipeId), serialized);
    },

    /**
     * Remove any stored session for a recipe. Removing an absent key is not an error.
     *
     * @param recipeId - Recipe whose session to remove.
     * @sideEffect Writes `AsyncStorage`.
     */
    remove: async (recipeId: string): Promise<void> => {
        await AsyncStorage.removeItem(sessionKey(recipeId));
    },
};
