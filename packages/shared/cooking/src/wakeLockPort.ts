/**
 * The screen wake-lock **port** for Cooking Mode (FR-035 / REQ-007, REQ-CN-002).
 *
 * `@kitchensink/cooking-core` is platform-free: it depends on no browser API and no Expo SDK. The two
 * real wake-lock implementations are therefore *adapters* that live in the platform-bound feature
 * package (`@commise/features-cooking`) — `wakeLock.ts` uses `navigator.wakeLock`, and
 * `wakeLock.native.ts` uses `expo-keep-awake`. Both satisfy {@link WakeLockPort}, so the session logic
 * and the calling hook are identical on both platforms and neither pulls a platform SDK in here.
 *
 * The contract is **acquire-returns-its-own-disposer** rather than a global `request()`/`release()`
 * pair. That makes the lock's lifetime exactly the caller's: there is no ambient handle for an
 * unrelated caller to release, and no listener that can outlive the session it belongs to.
 */

/** Releases a previously acquired wake lock. Safe to call more than once. */
export type WakeLockDisposer = () => Promise<void>;

/**
 * Acquires a screen wake lock and returns the disposer that releases it.
 *
 * An implementation MUST resolve (never throw) when the platform has no wake-lock capability — FR-035
 * degrades silently rather than breaking Cooking Mode on an unsupported browser.
 */
export type WakeLockPort = () => Promise<WakeLockDisposer>;

/**
 * A wake-lock port for environments with no screen to keep awake — server rendering, tests, and
 * unsupported browsers.
 *
 * @sideEffect None. Present so callers never branch on `undefined`.
 */
export const noopWakeLock: WakeLockPort = async () => async () => {};

/** A balanced acquire/release handle over a {@link WakeLockPort}. */
export interface WakeLockController {
    /** Acquires the lock. Calling twice without an intervening release does NOT acquire a second lock. */
    acquire(): Promise<void>;
    /** Releases the lock if held. Idempotent — releasing when nothing is held is a no-op. */
    release(): Promise<void>;
    /** Whether a lock is currently held. */
    isHeld(): boolean;
}

/**
 * Wraps a {@link WakeLockPort} so acquire/release stay balanced.
 *
 * Cooking Mode enters and exits, backgrounds and foregrounds, and unmounts under React StrictMode
 * (which deliberately double-invokes effects). Without this guard a double `acquire()` would strand
 * the first disposer, leaking a lock that nothing can release and defeating REQ-CN-002's "released on
 * exit" requirement — the battery-drain failure the constraint exists to prevent.
 *
 * @param port - The platform adapter to wrap.
 * @returns A controller whose `acquire`/`release` are safe to call repeatedly and in any order.
 * @sideEffect Holds an OS-level lock between `acquire` and `release`.
 */
export function createWakeLockController(port: WakeLockPort): WakeLockController {
    let disposer: WakeLockDisposer | null = null;
    // Serializes overlapping calls: without it, two `acquire()`s racing before either resolves would
    // both see `disposer === null` and both acquire.
    let pending: Promise<void> = Promise.resolve();

    const enqueue = (work: () => Promise<void>): Promise<void> => {
        pending = pending.then(work, work);

        return pending;
    };

    return {
        acquire: async (): Promise<void> =>
            enqueue(async () => {
                if (disposer !== null) {
                    return;
                }

                disposer = await port();
            }),

        release: async (): Promise<void> =>
            enqueue(async () => {
                if (disposer === null) {
                    return;
                }

                const current = disposer;
                // Cleared BEFORE awaiting so a release that throws cannot leave a stale handle behind
                // that a later `acquire()` would treat as still held.
                disposer = null;
                await current();
            }),

        isHeld: (): boolean => disposer !== null,
    };
}
