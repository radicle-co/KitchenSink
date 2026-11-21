/**
 * The phone's store-review record over its one device storage (S12 U2): AsyncStorage is swapped for a memory double, and
 * the real record, the real kept port and the real `endDeviceSession` run over it. What only this binding can show: the
 * plain sign-out's device-session clear (`endDeviceSession`) does NOT reach the record, and `clear` removes one cook only.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/storage/outboxStore.js', async () => ({
    createNativeOutboxStore: (await vi.importActual<typeof import('@kitchensink/sync')>('@kitchensink/sync'))
        .createMemoryOutboxStore,
}));
vi.mock('../../src/observability/sentryErrorReporter.js', () => ({ reportErrorToSentry: vi.fn() }));

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
        getAllKeys: async () => [...asyncStorage.store.keys()],
    },
}));

/** The persisted key is a contract: a rename would orphan every cook's record. */
const STORE_REVIEW_KEY = 'commise.storeReview.v1';

const { endDeviceSession } = await import('../../src/storage/deviceSession.js');
const { nativeStoreReviewRecord } = await import('../../src/storage/storeReviewRecord.js');

describe('the phone`s store-review record', () => {
    it('⛔ survives a plain sign-out: endDeviceSession ends the drafts and the outbox, not the record', async () => {
        await nativeStoreReviewRecord.recordFinish('user_a');
        await nativeStoreReviewRecord.recordRequest('user_a');

        await endDeviceSession('user_a');

        expect(asyncStorage.store.has(STORE_REVIEW_KEY)).toBe(true);
        expect(await nativeStoreReviewRecord.read('user_a')).toMatchObject({ finishes: 1 });
        expect((await nativeStoreReviewRecord.read('user_a'))?.lastRequestAt).toBeDefined();
    });

    it('clears one cook and keeps the other, through the one storage', async () => {
        await nativeStoreReviewRecord.recordFinish('user_b');

        await nativeStoreReviewRecord.clear('user_a');

        expect(await nativeStoreReviewRecord.read('user_a')).toEqual({ finishes: 0 });
        expect(await nativeStoreReviewRecord.read('user_b')).toEqual({ finishes: 1 });
    });

    it('lets two finishes in the same tick both land, through the phone`s serial queue', async () => {
        await Promise.all([
            nativeStoreReviewRecord.recordFinish('user_c'),
            nativeStoreReviewRecord.recordFinish('user_c'),
        ]);

        expect(await nativeStoreReviewRecord.read('user_c')).toEqual({ finishes: 2 });
    });
});
