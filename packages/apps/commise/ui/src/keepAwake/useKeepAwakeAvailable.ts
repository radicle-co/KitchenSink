'use client';

/**
 * @module @commise/ui/keep-awake — whether this page can keep the screen awake (web): a secure context with the Screen
 * Wake Lock API. The server render answers `false`, so the toggle appears only after hydration and never mismatches.
 */
import { useSyncExternalStore } from 'react';

import { browserWakeLockEnvironment, canHoldWakeLock } from './wakeLock.js';

/** The capability never changes during a page's life, so there is nothing to subscribe to. */
const subscribeNever = (): (() => void) => () => undefined;

/** The capability as the running page reports it. */
const capability = (): boolean => {
    const env = browserWakeLockEnvironment();

    return env !== undefined && canHoldWakeLock(env);
};

/**
 * Whether this page can keep the screen awake.
 *
 * @returns `true` once hydrated in a page that can hold a screen wake lock.
 */
export function useKeepAwakeAvailable(): boolean {
    return useSyncExternalStore(subscribeNever, capability, () => false);
}
