/**
 * @module @commise/features-recipes — the pinned ingredients bar's state rule, shared by both recipe shells (owner
 * ruling R1, `docs/plans/2026-11-08-pinnedIngredientsBar.md`).
 *
 * The bar is shown only when the ingredients card has scrolled past AND the shell says the page is eligible (web: the
 * recipe has lines; native: it also is the one-column page). The list is open only while the bar is shown, and a list
 * left open when its bar goes away does not reopen when the bar returns.
 *
 * @pattern Headless hook — the rule once, each platform shell supplies only its own two facts.
 */
import { useState } from 'react';

import type { PinnedIngredientsState } from './model.js';

/** What a shell knows about the page. */
export interface PinnedIngredientsGate {
    /** The ingredients card has scrolled above the top chrome. */
    readonly scrolledPast: boolean;
    /** The page can carry the bar at all on this platform and layout. */
    readonly eligible: boolean;
}

/** The pinned bar's state, from where the card is and whether the page can carry the bar. */
export const usePinnedIngredients = ({ scrolledPast, eligible }: PinnedIngredientsGate): PinnedIngredientsState => {
    const [listOpen, setListOpen] = useState(false);
    const shown = scrolledPast && eligible;

    // A list left open when its bar goes away must not reopen when the bar returns: adjust the state during render.
    if (!shown && listOpen) {
        setListOpen(false);
    }

    return { shown, open: listOpen && shown, onOpenChange: setListOpen };
};
