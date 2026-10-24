/**
 * @module @commise/ui/screen-reader-focus — move the SCREEN-READER cursor onto a node when a counter the surface owns
 * CHANGES (React Native only).
 *
 * The native twin of `@commise/ui/dialog-focus`'s `useFocusOnSignal`: same contract. A control that disappears because its own action
 * succeeded hands the reading cursor to content that confirms the result. It moves the reading cursor only, never
 * the keyboard. React Native cannot read where that cursor is, so unlike the web hook it cannot check whether the
 * person moved on; the caller's counter advancing only for an outcome the person started is what bounds it.
 *
 * ## Why a ref
 *
 * `AccessibilityInfo.sendAccessibilityEvent` takes a host node and has no declarative form. `seen` is compared and
 * advanced inside the effect, so a discarded render cannot consume the change and a remount does not move the cursor.
 *
 * @pattern Adapter over `moveScreenReaderFocus`, driven by a caller-owned signal
 */
import { useEffect, useRef, type RefObject } from 'react';

import { moveScreenReaderFocus, type ScreenReaderFocusTarget } from './moveScreenReaderFocus.native.js';

/**
 * A ref to attach to the node that takes screen-reader focus when `signal` changes.
 *
 * @param signal - A counter the caller advances for each outcome that should move the cursor. Inert on mount.
 * @returns The ref; attach it to a `Text` or `View`.
 * @sideEffect Sends one accessibility `'focus'` event when `signal` changes.
 */
export function useScreenReaderFocusOnSignal<T extends ScreenReaderFocusTarget>(signal: number): RefObject<T | null> {
    const node = useRef<T | null>(null);
    const seen = useRef(signal);

    useEffect(() => {
        if (seen.current === signal) {
            return;
        }

        seen.current = signal;
        moveScreenReaderFocus(node.current);
    }, [signal]);

    return node;
}
