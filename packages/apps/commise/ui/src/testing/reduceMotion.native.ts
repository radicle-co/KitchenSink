/**
 * @module @commise/ui/testing/reduce-motion — a dispatchable stand-in for React Native's reduce-motion setting, for suites
 * that need the OS preference to answer, and then to CHANGE after the component mounted.
 *
 * ⛔ WHY THIS HAS TO EXIST. Under `react-native-web` (what every native suite runs) `AccessibilityInfo.addEventListener`
 * hands back nothing and subscribes to a media query that jsdom does not have, so no `reduceMotionChanged` event can reach
 * `useReduceMotion`. Typing a spy on the overloaded method needs a cast on every call site, so the one replacement lives
 * here, assigned through `unknown` as `hardwareBack.native.ts` does for `BackHandler`.
 *
 * ⚠️ It replaces the methods directly, so `restore()` is the caller's job: `vi.restoreAllMocks()` will not undo it.
 */
import { act } from '@testing-library/react';
import { AccessibilityInfo } from 'react-native';

/** What a suite holds: a way to change the preference, and the way back. */
export interface ReduceMotionHandle {
    /** Tell every subscriber the preference changed, inside `act`. */
    readonly change: (reduce: boolean) => void;
    /** Put the real methods back. Call it from `afterEach`. */
    readonly restore: () => void;
}

/**
 * Make `AccessibilityInfo` answer `initial` for reduce motion, and let the suite change it later.
 *
 * @param initial - The answer `isReduceMotionEnabled` resolves with.
 * @returns Its {@link ReduceMotionHandle}.
 * @sideEffect Mutates the shared `AccessibilityInfo` module object until `restore()` is called.
 */
export function installReduceMotion(initial: boolean): ReduceMotionHandle {
    const subscribers = new Set<(reduce: boolean) => void>();
    const original = {
        isReduceMotionEnabled: AccessibilityInfo.isReduceMotionEnabled,
        addEventListener: AccessibilityInfo.addEventListener,
    };
    const target = AccessibilityInfo as { isReduceMotionEnabled: unknown; addEventListener: unknown };

    target.isReduceMotionEnabled = (): Promise<boolean> => Promise.resolve(initial);

    target.addEventListener = (_event: string, subscriber: (reduce: boolean) => void): { remove: () => void } => {
        subscribers.add(subscriber);

        return { remove: () => subscribers.delete(subscriber) };
    };

    return {
        change: (reduce) => {
            act(() => {
                for (const subscriber of subscribers) {
                    subscriber(reduce);
                }
            });
        },
        restore: () => {
            Object.assign(target, original);
            subscribers.clear();
        },
    };
}
