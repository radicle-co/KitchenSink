/**
 * @module @commise/ui/sheet — whether the sheet's exit is still playing, so the window can stay up until it ends.
 *
 * Adjusted during render, React's previous-value form (`useOpenEdges` records why): the render that sees `open` turn false
 * already reports the exit, so the window never reads `visible` false for even one pass and counts a close that did not
 * happen. `wasOpen` is that pass's evidence; `pending` carries it from the next pass until the exit finishes.
 */
import { useState } from 'react';

/** The exit's state. */
export interface SheetExit {
    /** Whether the sheet has closed and its exit has not yet finished. */
    readonly exiting: boolean;
    /** The engine, or the fallback timer, says the exit is over. */
    readonly finishExit: () => void;
}

/**
 * Track the exit that follows a close.
 *
 * @param open - Whether the sheet is open.
 * @param animates - Whether the sheet has an exit to wait for; `false` for a sheet with no engine.
 * @returns Whether an exit is playing, and how to end it.
 */
export function useSheetExit(open: boolean, animates: boolean): SheetExit {
    const [wasOpen, setWasOpen] = useState(open);
    const [pending, setPending] = useState(false);

    if (open !== wasOpen) {
        setWasOpen(open);
        setPending(!open && animates);
    }

    return { exiting: animates && !open && (pending || wasOpen), finishExit: () => setPending(false) };
}
