/**
 * @module @commise/ui/keyboard-lift — where the on-screen keyboard is, for the Sheet's lift and the snackbar host.
 *
 * @pattern Adapter over React Native's `Keyboard` events — the one place the show/hide event names are chosen
 */
import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

/** Where the keyboard is on the screen. */
export interface KeyboardFrame {
    readonly top: number;
    readonly height: number;
}

/** The keyboard's frame, or `null` while none is up. */
function readKeyboardFrame(): KeyboardFrame | null {
    const metrics = Keyboard.isVisible() ? Keyboard.metrics() : undefined;

    return metrics === undefined ? null : { top: metrics.screenY, height: metrics.height };
}

/** Track the keyboard's frame. iOS reports its end position in the Will events, every other platform in the Did events. */
export function useKeyboardFrame(): KeyboardFrame | null {
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
