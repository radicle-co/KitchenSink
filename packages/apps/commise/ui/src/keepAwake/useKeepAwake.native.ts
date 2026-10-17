/**
 * @module @commise/ui/keep-awake — `useKeepAwake` (native): hold the screen awake while `on`, through `expo-keep-awake`.
 *
 * Each holder activates a tag of its own (`useId`), so releasing it never releases another holder. `expo-keep-awake`'s
 * own `useKeepAwake` is unconditional for the component's life, and this one must follow a switch, so it uses the
 * activate/deactivate pair instead.
 *
 * @pattern Adapter over `expo-keep-awake`
 */
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useEffect, useId } from 'react';

/**
 * Keep the screen awake while `on`.
 *
 * @param on - Whether the cook asked for the screen to stay on.
 * @sideEffect Activates and deactivates the device's keep-awake under this holder's tag.
 */
export function useKeepAwake(on: boolean): void {
    const tag = useId();

    useEffect(() => {
        if (!on) {
            return undefined;
        }

        // A failure leaves the screen to its own timeout, which is the state the cook started from.
        activateKeepAwakeAsync(tag).catch(() => undefined);

        return () => {
            deactivateKeepAwake(tag).catch(() => undefined);
        };
    }, [on, tag]);
}
