'use client';

/**
 * @module useCookingFocusRecovery — keeps keyboard focus on the cooking screen when the control that held it goes away.
 * Ticking a line moves its row out of the list, and Cook again unmounts the Done button, so the browser would drop
 * focus to the page. After a tick or a move, if focus was dropped, it goes to the next place the cook acts: the first
 * unticked line while some line is still unticked, otherwise the forward control (Next step, Start step or Finish).
 *
 * @pattern Headless hook — an Adapter over the DOM focus API, which has no declarative form
 */
import { useEffect } from 'react';

import { COOKING_FOCUS_LINE_ID } from './CookingLineRow.js';
import { COOKING_NAV_ID } from './CookingNav.js';
import { cookingFocusTargetOf, type CookingFocusRecoveryInput } from './cookingFocusTarget.js';

/** Whether focus was dropped to the page: nothing on the screen holds it. */
const focusDropped = (): boolean => document.activeElement === null || document.activeElement === document.body;

/**
 * Move focus to the cook's next action when it was dropped.
 *
 * @param input - The tick and move state this effect runs on.
 * @sideEffect Moves DOM focus, without scrolling, and only when focus was dropped after a tick or a move.
 */
export function useCookingFocusRecovery({
    moves,
    tickedCount,
    everyLineTicked,
    finished,
}: CookingFocusRecoveryInput): void {
    useEffect(() => {
        // On opening nothing was dropped: the page keeps its own focus.
        if (finished || (moves === 0 && tickedCount === 0) || !focusDropped()) {
            return;
        }

        const target =
            cookingFocusTargetOf({ tickedCount, everyLineTicked }) === 'focusLine'
                ? document.getElementById(COOKING_FOCUS_LINE_ID)
                : [...(document.getElementById(COOKING_NAV_ID)?.querySelectorAll('button') ?? [])].at(-1);

        if (target instanceof HTMLElement) {
            target.focus({ preventScroll: true });
        }
    }, [moves, tickedCount, everyLineTicked, finished]);
}
