/**
 * @module @commise/ui/dialog-actions — the width memento a frame that MOVES its footer holds for `DialogActions`.
 *
 * Moving a footer between two parents (`BottomSheetPanel`, I7) remounts it, and a fresh native `DialogActions` starts
 * stacked. A footer that is tall stacked and short as a row then changes height across the move, which voids the
 * no-flip-back argument in `layout/pinnedFooter.ts` and can make the footer alternate. The frame holds the width the
 * actions last measured ABOVE the remount; the remounted `DialogActions` seeds its first render from it and is a row at
 * once. Its own layout still wins and is recorded back.
 *
 * React only (no React Native import), so the `@commise/ui/dialog-actions` export resolves on web too. The seed is an
 * opaque number to the frame. No provider: `DialogActions` seeds `null`, as before.
 *
 * @pattern Memento injected through Context — the frame holds the state, the actions restore from it on remount.
 */
import { createContext, useMemo, useState } from 'react';

/** The width `DialogActions` last measured, and how it reports a new one. */
export interface DialogActionsWidthMemento {
    /** The last measured width, or `null` before any layout. */
    readonly width: number | null;
    /** Record a measured width. */
    readonly remember: (width: number) => void;
}

/** What a `DialogActions` below the provider reads and writes. `null`: no frame holds a memento. */
export const DialogActionsWidthContext = createContext<DialogActionsWidthMemento | null>(null);

/**
 * Hold a memento for the footer a frame moves. Wrap ONLY the footer in `DialogActionsWidthContext.Provider` with it, so
 * a `DialogActions` in the body is not seeded.
 *
 * @returns The memento to pass as the provider's value.
 */
export function useDialogActionsWidthMemento(): DialogActionsWidthMemento {
    const [width, remember] = useState<number | null>(null);

    return useMemo(() => ({ width, remember }), [width]);
}
