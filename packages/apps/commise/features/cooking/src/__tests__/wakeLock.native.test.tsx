import { beforeEach, describe, expect, it } from 'vitest';

import { getKeepAwakeCalls, resetKeepAwakeCalls } from './expoKeepAwakeStub';
import { COOKING_WAKE_LOCK_TAG, acquireNativeWakeLock } from '../wakeLock.native';

/**
 * T-005 — native (Expo) wake-lock adapter (FR-035 / REQ-007, REQ-CN-002).
 *
 * Guards the regression that would have shipped: the planned file name (`wake-lock-rn.ts`) is not a
 * suffix Metro resolves, so mobile would silently have run the WEB implementation and FR-035 would not
 * have worked on device at all; and the planned `KeepAwake.activate()` is not exported by
 * `expo-keep-awake@57`, so it would not even have compiled.
 */

beforeEach(() => {
    resetKeepAwakeCalls();
});

describe('acquireNativeWakeLock', () => {
    it('activates the keep-awake lock scoped to the cooking-mode tag', async () => {
        await acquireNativeWakeLock();

        expect(getKeepAwakeCalls()).toEqual([{ kind: 'activate', tag: COOKING_WAKE_LOCK_TAG }]);
    });

    it('deactivates with the SAME tag when the disposer runs', async () => {
        const dispose = await acquireNativeWakeLock();
        await dispose();

        // A mismatched tag would leave the lock held forever — the battery drain REQ-CN-002 forbids.
        expect(getKeepAwakeCalls()).toEqual([
            { kind: 'activate', tag: COOKING_WAKE_LOCK_TAG },
            { kind: 'deactivate', tag: COOKING_WAKE_LOCK_TAG },
        ]);
    });

    it('does not deactivate before the disposer is called', async () => {
        await acquireNativeWakeLock();

        expect(getKeepAwakeCalls().some((call) => call.kind === 'deactivate')).toBe(false);
    });

    it('supports repeated acquire/release cycles', async () => {
        const first = await acquireNativeWakeLock();
        await first();
        const second = await acquireNativeWakeLock();
        await second();

        expect(getKeepAwakeCalls().filter((call) => call.kind === 'activate')).toHaveLength(2);
        expect(getKeepAwakeCalls().filter((call) => call.kind === 'deactivate')).toHaveLength(2);
    });

    it('uses a non-empty tag so an unrelated caller cannot release the cooking lock', () => {
        expect(COOKING_WAKE_LOCK_TAG).toBe('cooking-mode');
    });
});
