/**
 * @module @commise/features-recipes/form — the Paste steps sheet's state, shared by its web and native leaves: whether
 * the sheet is open, the pasted text, the steps it splits into, and the add that closes it.
 *
 * The text is cleared whenever the sheet closes, by any route, so the next open starts empty.
 *
 * @pattern Headless hook — the sheet's state and its one command, with no markup
 */
import { extractSourceLink, type SourceLinkExtraction } from '@kitchensink/recipe-core';
import { useState } from 'react';

import { splitPastedSteps } from './pasteSteps.js';
import { isLinkOnly } from './sourceLink.js';

/** The Paste steps sheet's state. */
export interface PasteSteps {
    readonly open: boolean;
    /** Open or close the sheet; closing empties the field. */
    readonly setOpen: (open: boolean) => void;
    readonly text: string;
    readonly setText: (text: string) => void;
    /** The steps the text splits into, as the count and the add read them. */
    readonly steps: readonly string[];
    /** The paste is nothing but a link (ADR-0089): nothing to add, so the sheet says what to do instead. */
    readonly linkOnly: boolean;
    /** Add the steps and close the sheet; nothing happens with no steps. */
    readonly add: () => void;
}

/**
 * The Paste steps sheet's state.
 *
 * @param onAdd - Called with the split steps when the cook adds them.
 * @param onSource - Called with what a pasted link line was found to be (ADR-0089) when the cook adds the steps: the link is
 *   taken out of the text first, so it is never a step and the count does not include it. Absent where there is no Source.
 * @returns The state and its commands.
 */
export function usePasteSteps(
    onAdd: (instructions: readonly string[]) => void,
    onSource?: (extraction: SourceLinkExtraction) => void,
): PasteSteps {
    const [open, setOpenState] = useState(false);
    const [text, setText] = useState('');
    const extraction = extractSourceLink(text);
    const steps = splitPastedSteps(extraction.remaining);

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
        linkOnly: isLinkOnly(extraction),
        add: () => {
            if (steps.length === 0) {
                return;
            }

            setOpen(false);
            onSource?.(extraction);
            onAdd(steps);
        },
    };
}
