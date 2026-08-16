import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

import type { WakeLockDisposer, WakeLockPort } from '@kitchensink/cooking-core';

/**
 * Native (Expo) adapter for the Cooking Mode wake lock (FR-035 / REQ-007, REQ-CN-002).
 *
 * Implements the same `WakeLockPort` contract as the web adapter in `wakeLock.ts`, so the calling
 * hook is platform-agnostic and a fix on one platform cannot silently miss the other.
 *
 * Two details are load-bearing:
 *
 * 1. **The file must be named `.native.ts`.** Metro resolves the `.native` leaf in preference to the
 *    web sibling; a name it does not recognise (`-rn`, `-native`) would leave mobile silently running
 *    the web implementation, and FR-035 would not work on device at all.
 * 2. **The API is `activateKeepAwakeAsync` / `deactivateKeepAwake`.** `expo-keep-awake@57` exports no
 *    `KeepAwake.activate()`; the tagged form also scopes the lock to Cooking Mode so an unrelated
 *    caller cannot release it.
 */

/** Tag scoping the keep-awake lock to Cooking Mode. */
export const COOKING_WAKE_LOCK_TAG = 'cooking-mode';

/**
 * Acquires an OS keep-awake lock for the current cooking session.
 *
 * @returns A disposer that releases the lock.
 * @sideEffect Holds an OS-level keep-awake lock until the disposer runs.
 */
export const acquireNativeWakeLock: WakeLockPort = async (): Promise<WakeLockDisposer> => {
    try {
        await activateKeepAwakeAsync(COOKING_WAKE_LOCK_TAG);
    } catch {
        // Matching the web adapter: an unavailable keep-awake service degrades FR-035 silently rather
        // than breaking Cooking Mode.
        return async () => {};
    }

    return async (): Promise<void> => {
        deactivateKeepAwake(COOKING_WAKE_LOCK_TAG);
    };
};
