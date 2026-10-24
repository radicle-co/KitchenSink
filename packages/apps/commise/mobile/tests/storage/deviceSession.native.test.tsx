/**
 * The end of a cook's device session on mobile (ADR-0057, ADR-0054): the shared `endDeviceSession` bound to the app's
 * ONE store. Two copies of the clear, one per app, had drifted (staff-code-quality, 2026-10-09 review); and the drafts
 * and the outbox each memoize one serial writer per store OBJECT, so a second adapter object would be a second writer.
 * AsyncStorage is swapped for the domain's own memory adapter; its storage behaviour is that package's subject.
 */
import { appendIntent, loadOutbox, outboxMutatorFor } from '@kitchensink/sync';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/storage/outboxStore.js', async () => ({
    createNativeOutboxStore: (await vi.importActual<typeof import('@kitchensink/sync')>('@kitchensink/sync'))
        .createMemoryOutboxStore,
}));

// The recent searches live in AsyncStorage too (owner ruling 2026-10-17); an in-memory double stands in for the native module.
const { asyncStorage } = vi.hoisted(() => ({ asyncStorage: { store: new Map<string, string>() } }));

vi.mock('@react-native-async-storage/async-storage', () => ({
    default: {
        getItem: async (key: string) => asyncStorage.store.get(key) ?? null,
        setItem: async (key: string, value: string) => {
            asyncStorage.store.set(key, value);
        },
        removeItem: async (key: string) => {
            asyncStorage.store.delete(key);
        },
    },
}));

const { recentSearchesKeyFor } = await import('@commise/features-recipes');
const { endDeviceSession, nativeDeviceStore } = await import('../../src/storage/deviceSession.js');
const { editorDraftsFor } = await import('@commise/features-recipes/editor');

const memento = (recipeRef: string) => ({
    recipeRef,
    baseVersion: null,
    values: {
        title: 'Soup',
        description: '',
        cuisine: '',
        tags: [],
        dietaryFlags: [],
        servings: 2,
        prepTimeMinutes: 0,
        cookTimeMinutes: 0,
        visibility: 'public' as const,
        ingredients: [],
        steps: [],
    },
    pendingRebinds: [],
    savedAt: '2026-10-09T10:00:00.000Z',
});

describe('endDeviceSession (mobile)', () => {
    it('⛔ removes one cook`s drafts and outbox from the one device store, and keeps another cook`s', async () => {
        for (const subject of ['user_a', 'user_b']) {
            await editorDraftsFor(nativeDeviceStore, subject)?.save(memento('local:recipe:a'));
            await outboxMutatorFor(nativeDeviceStore, subject).mutate((log) =>
                appendIntent(log, {
                    entity: 'recipe',
                    intentKind: 'update',
                    localId: 'rec_1',
                    dependsOn: [],
                    payload: {},
                }),
            );
        }

        await endDeviceSession('user_a');

        expect(await editorDraftsFor(nativeDeviceStore, 'user_a')?.load('local:recipe:a')).toBeUndefined();
        expect((await loadOutbox(nativeDeviceStore, 'user_a')).records).toEqual([]);
        expect(await editorDraftsFor(nativeDeviceStore, 'user_b')?.load('local:recipe:a')).toBeDefined();
        expect((await loadOutbox(nativeDeviceStore, 'user_b')).records).toHaveLength(1);
    });

    it('⛔ removes the cook`s recent searches from AsyncStorage and keeps another cook`s', async () => {
        asyncStorage.store.set(recentSearchesKeyFor('user_a'), JSON.stringify(['soup']));
        asyncStorage.store.set(recentSearchesKeyFor('user_b'), JSON.stringify(['stew']));

        await endDeviceSession('user_a');

        expect([...asyncStorage.store.keys()]).toEqual([recentSearchesKeyFor('user_b')]);
    });
});
