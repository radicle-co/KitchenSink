/**
 * @module @commise/ui/testing/platform-os: the one way a native test runs code as iOS or as Android.
 *
 * `Platform.OS` is `'web'` under react-native-web, so a test of a platform-dependent value (the touch floor is 44 on
 * iOS and 48 on Android) has to set it, and put it back. Pass the OS as a table row (`it.each(['ios', 'android'])`) so
 * a 44/48 mix-up fails on one of the two rows.
 *
 * @pattern Test Double (Stub) — a scoped override of `Platform.OS`
 */
import { Platform } from 'react-native';

/** The platforms a native leaf branches on. */
export type NativeOs = 'ios' | 'android';

/**
 * Runs `run` with `Platform.OS` set to `os`, then restores it, even when `run` throws.
 *
 * @param os - The platform to report.
 * @param run - The code to run as that platform.
 * @returns What `run` returns.
 * @sideEffect Writes `Platform.OS` for the duration of the call.
 */
export function withPlatformOs<T>(os: NativeOs, run: () => T): T {
    const original = Platform.OS;
    Object.defineProperty(Platform, 'OS', { value: os, configurable: true });

    try {
        return run();
    } finally {
        Object.defineProperty(Platform, 'OS', { value: original, configurable: true });
    }
}
