/**
 * @module @commise/ui/screen-reader-focus — move screen-reader focus onto a node as it MOUNTS (React Native only).
 *
 * For a view that appears in place of the control the user last used — a form opening, a duplicate notice
 * replacing a form — so VoiceOver/TalkBack lands on the new content instead of wherever the removed control was.
 * Runs once per mount, never on a re-render: a view that re-renders while the user reads it must not pull the
 * cursor back.
 *
 * @pattern Adapter — mount-time focus over {@link moveScreenReaderFocus}
 */
import { useEffect, useRef, type RefObject } from 'react';

import { moveScreenReaderFocus, type ScreenReaderFocusTarget } from './moveScreenReaderFocus.native.js';

/**
 * A ref to attach to the node that should take screen-reader focus when it mounts.
 *
 * @returns The ref; attach it to a `Text`, `View` or `TextInput`.
 * @sideEffect Sends one accessibility `'focus'` event after the attached node mounts.
 */
export function useScreenReaderFocusOnMount<T extends ScreenReaderFocusTarget>(): RefObject<T | null> {
    const ref = useRef<T>(null);

    useEffect(() => {
        moveScreenReaderFocus(ref.current);
    }, []);

    return ref;
}
