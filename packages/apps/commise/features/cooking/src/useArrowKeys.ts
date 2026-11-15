'use client';

/**
 * @module useArrowKeys — ← and → move between steps on the web, when no modifier is held and focus is not in a field.
 * The buttons stay.
 *
 * @pattern Headless hook — an Adapter from `keydown` on the document to a step move
 */
import { useEffect, useEffectEvent } from 'react';

/** What each key does. */
export interface ArrowKeyHandlers {
    readonly forward: () => void;
    readonly back: () => void;
}

/** Whether an event target is a place the cook types, where the arrow keys move the caret. Pure. */
function isField(target: EventTarget | null): boolean {
    return (
        target instanceof HTMLElement &&
        (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
    );
}

/**
 * Listen for ← and →.
 *
 * @param handlers - What each key does, or `undefined` while the keys do nothing (Done).
 * @sideEffect Listens for `keydown` on the document while mounted and `handlers` is defined.
 */
export function useArrowKeys(handlers: ArrowKeyHandlers | undefined): void {
    const active = handlers !== undefined;
    // An Effect Event reads the latest handlers, so the listener is added once, not again on every move.
    const onKeyDown = useEffectEvent((event: KeyboardEvent): void => {
        if (
            handlers === undefined ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            event.shiftKey ||
            isField(event.target)
        ) {
            return;
        }

        if (event.key === 'ArrowRight') {
            handlers.forward();
        } else if (event.key === 'ArrowLeft') {
            handlers.back();
        }
    });

    useEffect(() => {
        if (!active) {
            return undefined;
        }

        const listener = (event: KeyboardEvent): void => onKeyDown(event);
        document.addEventListener('keydown', listener);

        return () => document.removeEventListener('keydown', listener);
    }, [active]);
}
