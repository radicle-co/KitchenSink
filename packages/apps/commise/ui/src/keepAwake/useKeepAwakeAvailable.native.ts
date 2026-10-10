/**
 * @module @commise/ui/keep-awake — whether the device can keep the screen awake (native): always, because
 * `expo-keep-awake` is `true` "on all platforms except unsupported web browsers".
 */

/**
 * Whether the device can keep the screen awake.
 *
 * @returns `true`.
 */
export function useKeepAwakeAvailable(): boolean {
    return true;
}
