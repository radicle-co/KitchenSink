/**
 * The native adapter for the recent-search port: AsyncStorage behind an async pair that never rejects. `removeItem` is the
 * leg the owner ruling of 2026-10-17 (`docs/design/uiOverhaul/ownerDecisions.md`) adds, so a verified sign-out can forget
 * a user's history.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { asyncStorage } = vi.hoisted(() => ({
    asyncStorage: {
        store: new Map<string, string>(),
        failRemove: false,
    },
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
    default: {
        getItem: async (key: string) => asyncStorage.store.get(key) ?? null,
        setItem: async (key: string, value: string) => {
            asyncStorage.store.set(key, value);
        },
        removeItem: async (key: string) => {
            if (asyncStorage.failRemove) {
                throw new Error('native module unavailable');
            }

            asyncStorage.store.delete(key);
        },
    },
}));

const { nativeRecentSearchStore } = await import('../../src/storage/recentSearchStore.js');

beforeEach(() => {
    asyncStorage.store.clear();
    asyncStorage.failRemove = false;
});

describe('nativeRecentSearchStore', () => {
    it('removeItem deletes the key and leaves the others', async () => {
        asyncStorage.store.set('k.a', '["soup"]');
        asyncStorage.store.set('k.b', '["stew"]');

        await nativeRecentSearchStore.removeItem('k.a');

        expect([...asyncStorage.store.keys()]).toEqual(['k.b']);
    });

    it('⛔ removeItem resolves (never rejects) when the native module fails', async () => {
        asyncStorage.failRemove = true;

        await expect(nativeRecentSearchStore.removeItem('k')).resolves.toBeUndefined();
    });
});
