/**
 * @module @commise/ui/layout — the native report that the on-screen keyboard closed. A row in Change food ends on it
 * when nothing new was typed (`docs/design/rowEditorOpenDecisions.md` item 4), because closing the keyboard is how a
 * cook leaves a field on a phone.
 *
 * @pattern Observer — an Adapter over React Native's `Keyboard` `keyboardDidHide` event
 */
import { useEffect, useEffectEvent } from 'react';
import { Keyboard } from 'react-native';

/**
 * Call `onHidden` each time the keyboard closes, while mounted.
 *
 * @param onHidden - Called after the keyboard closes. The newest one is called, and a new one does not subscribe again.
 * @sideEffect Listens for the keyboard closing while mounted.
 */
export function useKeyboardHidden(onHidden: () => void): void {
    const report = useEffectEvent(onHidden);

    useEffect(() => {
        const hidden = Keyboard.addListener('keyboardDidHide', () => {
            report();
        });

        return () => {
            hidden.remove();
        };
    }, []);
}
