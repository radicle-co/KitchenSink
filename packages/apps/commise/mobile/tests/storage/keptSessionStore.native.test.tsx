/**
 * The mobile kept cooking-session store (plan 0003 KTD2, KTD5): AsyncStorage behind the store's port, and one serial
 * queue per lock name as its exclusion. AsyncStorage is swapped for an in-memory double.
 */
import { describe, expect, it, vi } from 'vitest';

const { asyncStorage } = vi.hoisted(() => ({ asyncStorage: { store: new Map<string, string>(), failSets: false } }));

vi.mock('@react-native-async-storage/async-storage', () => ({
    default: {
        getItem: async (key: string) => asyncStorage.store.get(key) ?? null,
        setItem: async (key: string, value: string) => {
            if (asyncStorage.failSets) {
                throw new Error('disk full');
            }

            // A real write yields to the event loop, which is what makes an unqueued pair of writes interleave.
            await new Promise((resolve) => setTimeout(resolve, 0));
            asyncStorage.store.set(key, value);
        },
        removeItem: async (key: string) => {
            asyncStorage.store.delete(key);
        },
        getAllKeys: async () => [...asyncStorage.store.keys()],
    },
}));
vi.mock('../../src/observability/sentryErrorReporter.js', () => ({ reportErrorToSentry: vi.fn() }));

const { nativeKeptPort, nativeKeptSessionStore } = await import('../../src/storage/keptSessionStore.js');

describe('nativeKeptPort', () => {
    it('lists only the keys with the prefix', async () => {
        asyncStorage.store.clear();
        asyncStorage.store.set('cook.v2.a', '1');
        asyncStorage.store.set('other', '1');

        expect(await nativeKeptPort.keys('cook.v2.')).toEqual(['cook.v2.a']);
    });

    it('returns a failed outcome, not a throw, when a write fails', async () => {
        asyncStorage.failSets = true;
        const outcome = await nativeKeptPort.write('cook.v2.a', 'x');
        asyncStorage.failSets = false;

        expect(outcome.ok).toBe(false);
    });

    it('has no external-change subscription: a phone has one process', () => {
        expect(nativeKeptPort.subscribeExternal).toBeUndefined();
    });
});

describe('nativeKeptSessionStore', () => {
    it('⛔ two dispatches in the same tick on the real native runner both survive (qse 3; mutant: no queue)', async () => {
        asyncStorage.store.clear();
        await nativeKeptSessionStore.scope('user_a');

        await Promise.all([
            nativeKeptSessionStore.dispatch({ type: 'tickPage', recipeId: 'r1', ingredientId: 'butter', ticked: true }),
            nativeKeptSessionStore.dispatch({ type: 'tickPage', recipeId: 'r1', ingredientId: 'salt', ticked: true }),
        ]);

        const stored = JSON.parse(asyncStorage.store.get('cook.v2.user_a') ?? '{}');

        expect(stored.entries.r1.ticks).toEqual(['butter', 'salt']);
    });
});
