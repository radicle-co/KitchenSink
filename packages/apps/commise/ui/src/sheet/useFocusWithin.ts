/**
 * @module @commise/ui/sheet — whether focus is inside a container, from the bubbling focus events of its descendants
 * (web only: the native sheet reads no focus, §S8.1).
 *
 * A blur whose `relatedTarget` (the element taking focus) is still inside the container keeps the answer `true`, so
 * moving between two controls in the toolbar does not flicker the collapse.
 *
 * @pattern Adapter over bubbling focus events — no ref: the container is the event's `currentTarget`.
 */
import { useState, type FocusEvent } from 'react';

/**
 * Track focus inside the container the handlers are attached to.
 *
 * @returns Whether focus is inside, and the `onFocus`/`onBlur` handlers for the container.
 */
export function useFocusWithin(): {
    readonly focusWithin: boolean;
    readonly onFocus: () => void;
    readonly onBlur: (event: FocusEvent<HTMLElement>) => void;
} {
    const [focusWithin, setFocusWithin] = useState(false);

    return {
        focusWithin,
        onFocus: () => setFocusWithin(true),
        onBlur: (event) =>
            setFocusWithin(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)),
    };
}
