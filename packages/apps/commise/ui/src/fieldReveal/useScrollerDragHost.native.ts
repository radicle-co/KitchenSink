/**
 * @module @commise/ui/field-reveal — the scroller host's side of the drag broadcast (`./scrollerDrag.ts`): the host
 * spreads {@link ScrollerDragHost.onScrollBeginDrag} onto its scroller and provides {@link ScrollerDragHost.subscribe}
 * through `ScrollerDragContext`. React Native reports a drag's start only for the cook's own finger: a programmatic
 * `scrollTo` never fires it, so a reveal or a section jump closes nothing.
 *
 * The listeners live in a `Set` created once in state: its identity never changes, so `subscribe` and the handler keep
 * theirs, and a subscriber's effect runs only when the subscriber's own needs change.
 *
 * @pattern Observer — one subject (the scroller's drag-begin), any number of fields
 */
import { useState } from 'react';

import type { ScrollerDragSubscribe } from './scrollerDrag.js';

/** What the scroller's host wires. */
export interface ScrollerDragHost {
    /** For `ScrollerDragContext`. Its identity never changes. */
    readonly subscribe: ScrollerDragSubscribe;
    /** For the scroller's `onScrollBeginDrag`. Its identity never changes. */
    readonly onScrollBeginDrag: () => void;
}

/**
 * Host the drag broadcast for one scroller.
 *
 * @returns The subscription and the scroller's handler.
 */
export function useScrollerDragHost(): ScrollerDragHost {
    const [host] = useState((): ScrollerDragHost => {
        const listeners = new Set<() => void>();

        return {
            subscribe: (listener) => {
                listeners.add(listener);

                return () => {
                    listeners.delete(listener);
                };
            },
            onScrollBeginDrag: () => {
                for (const listener of [...listeners]) {
                    listener();
                }
            },
        };
    });

    return host;
}
