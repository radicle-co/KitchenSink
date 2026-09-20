/**
 * The NATIVE outbox store — the mobile adapter for `@kitchensink/sync`'s storage port.
 *
 * ⛔ IT LIVES HERE, NOT IN THE DOMAIN. `@kitchensink/sync` is deliberately platform-free — no React, no
 * TanStack, no React Native — so the app supplies the adapter rather than the domain importing a platform.
 * That is also what keeps the domain's tests runnable with nothing but node.
 *
 * ⛔ PERSISTENCE IS MOBILE-ONLY (owner ruling). Web takes the volatile in-memory store, so no recipe body is
 * left at rest in a browser profile — IndexedDB is readable by any script on the origin, and a key held in
 * that same origin defends against nothing.
 *
 * ⚠️ AsyncStorage, mirroring `recentSearchStore.ts` next door: already a declared dependency, already in
 * production use, no new native module and no dev-client rebuild. SQLite would be the choice only if the
 * outbox ever needed a cross-record transaction — it does not, because one intent is one key and an
 * unreadable key is quarantined rather than trusted.
 *
 * ⚠️ NO APP-LEVEL ENCRYPTION, deliberately: the OS provides full-disk encryption and app sandboxing, and
 * `expo-secure-store` is a keychain — semantically wrong and needlessly slow for bulk data. The sibling
 * store records the same reasoning for a smaller payload.
 */
import type { OutboxStore } from '@kitchensink/sync';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * The native outbox store.
 *
 * @returns A store backed by AsyncStorage. @sideEffect Reads and writes device storage.
 */
export function createNativeOutboxStore(): OutboxStore {
    return {
        getItem: async (key: string) => AsyncStorage.getItem(key),
        setItem: async (key: string, value: string) => AsyncStorage.setItem(key, value),
        removeItem: async (key: string) => AsyncStorage.removeItem(key),
    };
}
