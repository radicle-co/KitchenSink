/**
 * @module @commise/ui/keyboard-lift — lifts a window-high frame's content above the keyboard, for the Sheet's engine frame.
 *
 * `KeyboardAvoidingView` reads its frame relative to its PARENT and the keyboard relative to the screen, which holds only
 * in "a box that starts at the top of the window" (`KeyboardAvoider`). The Sheet's engine places its frame with a
 * transform inside a padded backdrop, so that arithmetic fell short on a device: the panel rose, but its action stayed
 * behind the keyboard. This measures instead: where the box's BOTTOM EDGE is in the window, and where the keyboard's TOP is
 * on the screen, and pads by the overlap. An edge-to-edge window has the same origin as the screen on both platforms, so
 * no offset between the two can leave the foot behind the keyboard. The padding does not change the box's own size, so
 * the measure holds.
 *
 * The box fills its parent and stands the content at its foot, centred across: the frame the Sheet's panel sits in. It must
 * start at the window's top, because a box that starts lower ends below the screen, and the lift would then measure an
 * overlap larger than the keyboard is tall (Pixel 6: a window-high box padded down by the status bar ended 48.76 dp off the
 * screen). The status bar's room is `topInset`, taken inside the box.
 *
 * ⚠️ A box that moves (the engine's transform while it slides in) measures where it is NOW; the lift re-measures when the
 * keyboard shows, hides or moves, and when the box lays out. It is owed a device check while a field opens the keyboard
 * before the slide ends.
 *
 * An orchestration component: it decides how far the content rises, and draws nothing of its own.
 *
 * @pattern Adapter over React Native's `Keyboard` and `measureInWindow` — the overlap is the one rule, owned here
 */
import { useEffect, useRef, useState, type FC, type ReactNode } from 'react';
import { Keyboard, Platform } from 'react-native';
import { YStack, type TamaguiElement } from 'tamagui';

import { keyboardOverlap } from './keyboardOverlap.js';

/** Props for {@link KeyboardLift}. */
export interface KeyboardLiftProps {
    readonly children: ReactNode;
    /**
     * The room the status bar takes at the head of the box, in dp. The box is as tall as the window and starts at its top, so
     * its foot IS the screen's foot and the keyboard's overlap is the keyboard's own height at most. The panel stands in what is
     * left between this and the lift.
     */
    readonly topInset: number;
    /**
     * The bottom system bar's room, in dp. The window is edge to edge, so the box extends under the navigation bar, and
     * Android's keyboard `height` EXCLUDES that bar: the foot must rise by the height plus this (Pixel 6: 288.38 + 48). It is
     * also the most the lift may ever rise past the keyboard's reported height, which bounds a bad measurement.
     */
    readonly bottomInset: number;
}

/** Where the keyboard is on the screen. */
interface KeyboardFrame {
    readonly top: number;
    readonly height: number;
}

/** The keyboard's frame, or `null` while none is up. */
function readKeyboardFrame(): KeyboardFrame | null {
    const metrics = Keyboard.isVisible() ? Keyboard.metrics() : undefined;

    return metrics === undefined ? null : { top: metrics.screenY, height: metrics.height };
}

/** Track the keyboard's frame. iOS reports its end position in the Will events, every other platform in the Did events. */
function useKeyboardFrame(): KeyboardFrame | null {
    const [top, setTop] = useState<KeyboardFrame | null>(readKeyboardFrame);

    useEffect(() => {
        const [show, hide] =
            Platform.OS === 'ios'
                ? (['keyboardWillShow', 'keyboardWillHide'] as const)
                : (['keyboardDidShow', 'keyboardDidHide'] as const);
        const shown = Keyboard.addListener(show, (event) =>
            setTop({ top: event.endCoordinates.screenY, height: event.endCoordinates.height }),
        );
        const hidden = Keyboard.addListener(hide, () => setTop(null));

        return () => {
            shown.remove();
            hidden.remove();
        };
    }, []);

    return top;
}

export const KeyboardLift: FC<KeyboardLiftProps> = ({ children, topInset, bottomInset }) => {
    const frame = useKeyboardFrame();
    // A ref, the sanctioned kind: measuring a host node's place in the window has no declarative form.
    const box = useRef<TamaguiElement>(null);
    const [bottom, setBottom] = useState<number | null>(null);

    const measure = (): void => {
        box.current?.measureInWindow((_x, y, _width, height) => setBottom(y + height));
    };

    // @sideEffect Measures the host node again whenever the keyboard shows, hides or moves.
    useEffect(measure, [frame]);

    return (
        <YStack
            ref={box}
            onLayout={measure}
            flex={1}
            width="100%"
            justifyContent="flex-end"
            alignItems="center"
            pointerEvents="box-none"
            // NATIVE-STYLE-ADAPTER: the overlap is a measured keyboard height, a platform value with no token.
            paddingTop={topInset}
            paddingBottom={keyboardOverlap(bottom, frame?.top ?? null, (frame?.height ?? 0) + bottomInset)}
        >
            {children}
        </YStack>
    );
};
