/**
 * @module @commise/ui/testing/modal-close-event — the event React Native hands a Modal's `onRequestClose`, for a suite
 * that raises Android Back itself (react-native-web does not).
 *
 * It lacks only `target` and `currentTarget`, which are native element handles no test can make; the design system's
 * hosts read neither.
 */
import type { NativeSyntheticEvent } from 'react-native';

export const MODAL_CLOSE_EVENT = {
    nativeEvent: undefined,
    bubbles: false,
    cancelable: false,
    defaultPrevented: false,
    eventPhase: 0,
    isTrusted: true,
    preventDefault: () => undefined,
    isDefaultPrevented: () => false,
    stopPropagation: () => undefined,
    isPropagationStopped: () => false,
    persist: () => undefined,
    timeStamp: 0,
    type: 'requestClose',
} as NativeSyntheticEvent<unknown>;
