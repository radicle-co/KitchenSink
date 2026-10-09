/**
 * @module @commise/features-recipes/form — the Paste steps sheet's state, shared by its web and native leaves: whether
 * the sheet is open, the pasted text, the steps it splits into, and the add that closes it.
 *
 * The text is cleared whenever the sheet closes, by any route, so the next open starts empty.
 *
 * @pattern Headless hook — the sheet's state and its one command, with no markup
 */
import { useState } from 'react';

import { splitPastedSteps } from './pasteSteps.js';

/** The Paste steps sheet's state. */
export interface PasteSteps {
    readonly open: boolean;
    /** Open or close the sheet; closing empties the field. */
    readonly setOpen: (open: boolean) => void;
    readonly text: string;
    readonly setText: (text: string) => void;
    /** The steps the text splits into, as the count and the add read them. */
    readonly steps: readonly string[];
    /** Add the steps and close the sheet; nothing happens with no steps. */
    readonly add: () => void;
}

/**
 * The Paste steps sheet's state.
 *
 * @param onAdd - Called with the split steps when the cook adds them.
 * @returns The state and its commands.
 */
export function usePasteSteps(onAdd: (instructions: readonly string[]) => void): PasteSteps {
    const [open, setOpenState] = useState(false);
    const [text, setText] = useState('');
    const steps = splitPastedSteps(text);

    const setOpen = (next: boolean): void => {
        setOpenState(next);

        if (!next) {
            setText('');
        }
    };

    return {
        open,
        setOpen,
        text,
        setText,
        steps,
        add: () => {
            if (steps.length === 0) {
                return;
            }

            setOpen(false);
            onAdd(steps);
        },
    };
}
