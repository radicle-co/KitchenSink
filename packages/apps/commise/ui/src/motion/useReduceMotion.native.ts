/**
 * @module @commise/ui/motion — the OS reduce-motion preference, read once for the whole design system
 * (React Native only).
 *
 * Every native motion primitive gates on the SAME fact, so it has exactly one reader: the press-scale
 * primitive and the enter transition both consume this hook rather than each subscribing to
 * `AccessibilityInfo` themselves. The return type is deliberately tri-state — React Native can only read the
 * preference asynchronously, and `undefined` (“not known yet”) is a materially different situation from
 * `false` (“known to be off”) for anything that decides an initial visual state. Consumers that genuinely do
 * not care (a press gate, which has nothing to show before the first press) collapse it with `?? false`.
 *
 * On web the equivalent gate is the `motion-safe:` CSS variant — synchronous, declarative, and therefore
 * without a hook.
 */
import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Track the OS reduce-motion preference. This is external-system synchronisation (an accessibility setting
 * that can change at runtime), which is exactly what `useEffect` is for.
 *
 * @returns `true`/`false` once the preference is known, `undefined` while it is still being read.
 * @sideEffect Subscribes to `AccessibilityInfo` reduce-motion changes for the component's lifetime.
 */
export function useReduceMotion(): boolean | undefined {
    const [reduceMotion, setReduceMotion] = useState<boolean | undefined>(undefined);

    useEffect(() => {
        let subscribed = true;
        void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
            if (subscribed) {
                setReduceMotion(enabled);
            }
        });
        // `addEventListener` returns an `EmitterSubscription` on device; some hosts (e.g. the
        // react-native-web test shim) return nothing, so unsubscribe defensively.
        const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion) as
            { remove: () => void } | undefined;

        return () => {
            subscribed = false;
            subscription?.remove();
        };
    }, []);

    return reduceMotion;
}
