'use client';

/**
 * @module useCookingKeepAwake — the screen stays on while the cook is cooking, and while a timer runs or rings.
 *
 * It is a session-level hook: it needs the session's status, so it mounts beside `useCookingSession`, below the
 * read-level switch, where a session exists.
 *
 * @pattern Headless hook — a screen-on hold over the `@commise/ui/keep-awake` adapter
 */
import { useKeepAwake, useKeepAwakeAvailable } from '@commise/ui/keep-awake';
import type { SessionStatus } from '@kitchensink/cooking-core';

/**
 * Hold the screen on while cooking; let go on Done, and on leaving, which unmounts the screen and so this hook.
 *
 * @param status - The session's derived status.
 * @param timerHolds - Whether a timer counts down or rings, which keeps the screen on after Done too (R12a).
 * @returns Whether this device can keep the screen on, so no promise is shown where it cannot.
 * @sideEffect Holds and releases the device's screen-on lock.
 */
export function useCookingKeepAwake(
    status: SessionStatus,
    timerHolds = false,
): { readonly keepAwakeAvailable: boolean } {
    useKeepAwake(status !== 'complete' || timerHolds);

    return { keepAwakeAvailable: useKeepAwakeAvailable() };
}
