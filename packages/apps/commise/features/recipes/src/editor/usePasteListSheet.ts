'use client';

/**
 * @module @commise/features-recipes/editor — the Paste a list sheet's state (build spec §7.5.4), shared by its web and
 * native leaves and by the two places that open it (the section heading's ghost button, and the empty section's
 * secondary button): open or closed, the pasted text and what it counts to, and the add.
 *
 * The sheet stays open until the job is ACCEPTED, then closes with its text cleared; a refused send keeps the sheet and
 * the text, and its failure line, so nothing the cook pasted is lost to a dropped connection. (§7.5.4 closes it on the
 * press; holding it to the job's answer is that rule plus the case where the press does not take.)
 *
 * @pattern Headless hook — the sheet's state and its one command, with no markup
 */
import { extractSourceLink, type SourceLinkExtraction } from '@kitchensink/recipe-core';
import { useState } from 'react';

import { pasteIngredientsOf, type PasteIngredientsModel, type PasteRefusalCopy } from '../form/pasteIngredients.js';
import { isLinkOnly } from '../form/sourceLink.js';
import type { PasteIntoIngredients } from './usePasteIntoIngredients.js';

/** Options for {@link usePasteListSheet}. */
export interface PasteListSheetOptions {
    /** Open at once: Home's first-run Paste ingredients opens the editor with this sheet open (§7.5.4). */
    readonly initiallyOpen: boolean;
    readonly copy: PasteRefusalCopy;
    /**
     * A pasted link line (ADR-0089): the sheet takes it out of the text before it counts or sends a line, and hands what it
     * found up, so the link never becomes an ingredient. Absent where a paste has no Source to set.
     */
    readonly onSource?: (extraction: SourceLinkExtraction) => void;
}

/** The sheet's state. */
export interface PasteListSheet {
    readonly open: boolean;
    readonly setOpen: (open: boolean) => void;
    readonly text: string;
    readonly setText: (text: string) => void;
    /** The count and the refusals, before any round trip. */
    readonly model: PasteIngredientsModel;
    /** The paste is nothing but a link (ADR-0089): nothing to add, so the sheet says what to do instead. */
    readonly linkOnly: boolean;
    /** Send the text as a parse job; nothing happens when it may not be sent. */
    readonly add: () => void;
}

/**
 * The Paste a list sheet's state.
 *
 * @param paste - The section's paste (`usePasteIntoIngredients`).
 * @param options - Whether it opens at once, and the refusals' copy.
 * @returns The state and its commands.
 */
export function usePasteListSheet(paste: PasteIntoIngredients, options: PasteListSheetOptions): PasteListSheet {
    const [open, setOpenState] = useState(() => options.initiallyOpen && paste.available);
    const [text, setText] = useState('');
    // The link line is not an ingredient: it is out of the text the sheet counts and the job reads.
    const extraction = extractSourceLink(text);
    const model = pasteIngredientsOf(extraction.remaining, options.copy);
    // The job a send last waited for: when a new one is accepted the sheet closes. Adjusted during render, React's
    // previous-value form.
    const [seenAccepted, setSeenAccepted] = useState(paste.acceptedCount);

    if (paste.acceptedCount !== seenAccepted) {
        setSeenAccepted(paste.acceptedCount);
        setOpenState(false);
        setText('');
    }

    return {
        open,
        setOpen: (next) => {
            setOpenState(next);

            if (next) {
                paste.clearFailure();
            }
        },
        text,
        setText,
        model,
        linkOnly: isLinkOnly(extraction),
        add: () => {
            if (model.canSubmit && !paste.submitting) {
                options.onSource?.(extraction);
                paste.submit(extraction.remaining);
            }
        },
    };
}
