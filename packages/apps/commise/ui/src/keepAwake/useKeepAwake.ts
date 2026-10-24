'use client';

/**
 * @module @commise/ui/keep-awake — `useKeepAwake` (web): hold the screen awake while `on`, through the Wake Lock
 * adapter. The lock lives in the effect's closure, so it is released by the effect's own cleanup when `on` turns off or
 * the page unmounts — the cook leaving the recipe releases it with no ref and no extra bookkeeping.
 */
import { useEffect } from 'react';

import { browserWakeLockEnvironment, holdScreenWakeLock } from './wakeLock.js';

/**
 * Keep the screen awake while `on`.
 *
 * @param on - Whether the cook asked for the screen to stay on.
 * @sideEffect Requests and releases a screen wake lock.
 */
export function useKeepAwake(on: boolean): void {
    useEffect(() => {
        const env = browserWakeLockEnvironment();

        if (!on || env === undefined) {
            return undefined;
        }

        return holdScreenWakeLock(env);
    }, [on]);
}
