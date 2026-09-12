/**
 * @module @commise/ui/dialog-focus — move DOM focus onto a node when a counter the surface owns CHANGES (web).
 *
 * For a control that disappears because its own action succeeded — a failed-refresh notice whose Try again worked —
 * so focus lands on content that confirms the result instead of dropping to <body> (WCAG 2.2 SC 2.4.3). The caller
 * owns the counter and advances it only for the outcome that removes the control; a pull or a background refetch
 * that succeeds never advances it, so it never moves focus.
 *
 * Focus moves through `focusIfLost`: never away from where the person put it. The native twin, which moves the
 * screen-reader cursor, is `@commise/ui/screen-reader-focus`'s `useScreenReaderFocusOnSignal`.
 *
 * ## Why a ref, when this repo near-forbids them
 *
 * `.focus()` has no declarative form. `node` is that handle. `seen` is a previous-value latch compared and advanced
 * INSIDE the effect, the same shape as `useScrollResetOnChange`: an effect runs only for a committed render, so a
 * discarded render can neither consume the change nor advance the latch, and a remount with a non-zero counter does
 * not move focus.
 *
 * @pattern Adapter over the DOM focus API, driven by a caller-owned signal
 */
import { useEffect, useRef, type RefObject } from 'react';

import { focusIfLost } from './focusIfLost.js';

/**
 * A ref to attach to the node that takes focus when `signal` changes.
 *
 * @param signal - A counter the caller advances for each outcome that should move focus. Inert on mount.
 * @returns The ref; attach it to a focusable element (`tabIndex={-1}` for a heading or a line of text).
 * @sideEffect Moves DOM focus when `signal` changes and focus was lost.
 */
export function useFocusOnSignal<T extends HTMLElement>(signal: number): RefObject<T | null> {
    const node = useRef<T | null>(null);
    const seen = useRef(signal);

    useEffect(() => {
        if (seen.current === signal) {
            return;
        }

        seen.current = signal;
        focusIfLost(node.current);
    }, [signal]);

    return node;
}
