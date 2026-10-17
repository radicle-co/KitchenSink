/**
 * @module @commise/ui/sheet — swipe the native sheet down to dismiss it.
 *
 * The swipe area takes every touch that starts on it and that no control inside it takes, so Close still takes its
 * tap. ⛔ It cannot wait for the move: React Native's `Modal` takes any touch start nothing inside it took
 * (`Libraries/Modal/Modal.js`, `_shouldSetResponder`), and once something holds the touch the responder system asks only
 * its ancestors whether they want it, so a move claim inside a sheet is never asked. The sheet follows a drag only
 * while it is downward and mostly vertical (`isDownwardDrag`); a release past `isDismissingSwipe`'s threshold dismisses
 * it, and anything else puts it back, instantly under reduce motion. A host that declines the close leaves the sheet
 * where the drag ended; no host does today, and the next open starts fresh.
 *
 * The responder is created ONCE, because recreating it mid-gesture drops the gesture's state. So its callbacks only
 * RECORD the outcome, through a state setter whose identity never changes; an effect acts on it with an Effect
 * Event, which reads the current render's `onDismiss` and reduce-motion answer. No ref holds a callback.
 *
 * @pattern Adapter over React Native's `PanResponder` — the release rule is the `isDismissingSwipe` Specification.
 */
import { useEffect, useEffectEvent, useState } from 'react';
import { Animated, PanResponder, type GestureResponderHandlers } from 'react-native';

import { isDismissingSwipe, isDownwardDrag } from './swipeDismiss.js';

/** How a gesture ended. Each one is a new object, so two identical outcomes in a row are two state changes. */
interface Release {
    readonly outcome: 'dismiss' | 'snapBack';
}

/**
 * Follow and dismiss a downward swipe.
 *
 * @param onDismiss - Called when a release passes the dismiss threshold.
 * @param reduceMotion - The platform's reduce-motion answer; the sheet springs back only when it is `false`.
 * @returns The handlers for the swipe area, and the sheet's vertical offset.
 * @sideEffect Animates the returned offset.
 */
export function useSwipeToDismiss(
    onDismiss: () => void,
    reduceMotion: boolean | undefined,
): { readonly panHandlers: GestureResponderHandlers; readonly translateY: Animated.Value } {
    const [translateY] = useState(() => new Animated.Value(0));
    const [release, setRelease] = useState<Release | null>(null);

    const [responder] = useState(() => {
        const record = (outcome: Release['outcome']): void => setRelease({ outcome });

        return PanResponder.create({
            onStartShouldSetPanResponder: () => true,
            onPanResponderMove: (_event, { dx, dy }) => translateY.setValue(isDownwardDrag(dx, dy) ? dy : 0),
            onPanResponderRelease: (_event, { dx, dy, vy }) =>
                record(isDownwardDrag(dx, dy) && isDismissingSwipe(dy, vy) ? 'dismiss' : 'snapBack'),
            onPanResponderTerminate: () => record('snapBack'),
        });
    });

    const settle = useEffectEvent((outcome: Release['outcome']): void => {
        if (outcome === 'dismiss') {
            onDismiss();
        } else if (reduceMotion === false) {
            // No overshoot: a bounce past rest lifts the sheet's bottom edge off the screen (§S8.1).
            Animated.spring(translateY, { toValue: 0, overshootClamping: true, useNativeDriver: true }).start();
        } else {
            translateY.setValue(0);
        }
    });

    useEffect(() => {
        if (release !== null) {
            settle(release.outcome);
        }
    }, [release]);

    return { panHandlers: responder.panHandlers, translateY };
}
