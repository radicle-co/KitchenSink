import type { WakeLockDisposer, WakeLockPort } from '@kitchensink/cooking-core';

/**
 * Web adapter for the Cooking Mode wake lock (FR-035 / REQ-007, REQ-CN-002).
 *
 * Implements the `WakeLockPort` contract from `@kitchensink/cooking-core` using the browser Screen
 * Wake Lock API. Its native counterpart is `wakeLock.native.ts`; both expose the same
 * acquire-returns-a-disposer shape so the calling hook is identical on both platforms.
 *
 * Three properties are deliberate and load-bearing:
 *
 * 1. **Nothing is registered at module scope.** `@commise/web` server-renders, so a top-level
 *    `document.addEventListener` would throw `ReferenceError: document is not defined` on import and
 *    take down the route — not merely skip the lock.
 * 2. **The listener is owned by the disposer.** The OS drops a wake lock whenever the tab is
 *    backgrounded, so the lock must be re-acquired on return; but a listener that outlives the session
 *    would keep re-acquiring long after the user left Cooking Mode, defeating REQ-CN-002.
 * 3. **Absence of the API is not an error.** FR-035 degrades silently on an unsupported browser.
 */

/** Marker used only for readability at the call site. */
const NOOP_DISPOSER: WakeLockDisposer = async () => {};

/**
 * Acquires a screen wake lock for the current cooking session.
 *
 * @returns A disposer that removes the visibility listener and releases the lock.
 * @sideEffect Touches `navigator.wakeLock` and adds a `visibilitychange` listener for the lock's lifetime.
 */
export const acquireWebWakeLock: WakeLockPort = async (): Promise<WakeLockDisposer> => {
    // `typeof` guards rather than truthiness checks: under SSR the identifiers are not merely falsy,
    // they are undeclared, and referencing them throws.
    if (typeof document === 'undefined' || typeof navigator === 'undefined' || !('wakeLock' in navigator)) {
        return NOOP_DISPOSER;
    }

    let sentinel: WakeLockSentinel | null = null;
    let disposed = false;

    const request = async (): Promise<void> => {
        try {
            sentinel = await navigator.wakeLock.request('screen');
        } catch {
            // A rejected request (permissions policy, battery saver, tab not visible) must not break
            // Cooking Mode — the user simply loses the screen-awake convenience.
            sentinel = null;
        }
    };

    const onVisibility = (): void => {
        // `disposed` guards the race where the session ends while an async re-acquire is in flight;
        // without it the lock could be re-taken after the disposer already ran.
        if (!disposed && document.visibilityState === 'visible' && sentinel === null) {
            void request();
        }
    };

    await request();
    document.addEventListener('visibilitychange', onVisibility);

    return async (): Promise<void> => {
        disposed = true;
        document.removeEventListener('visibilitychange', onVisibility);
        const current = sentinel;
        sentinel = null;

        try {
            await current?.release();
        } catch {
            // Releasing an already-released sentinel throws in some browsers; the lock is gone either
            // way, and a failed release must not propagate into the caller's unmount path.
        }
    };
};
