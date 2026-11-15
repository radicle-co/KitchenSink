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

/** What decides where focus goes. */
export interface CookingFocusRecoveryInput {
    /** How many times the cook has moved between steps. */
    readonly moves: number;
    /** How many lines of the current step are ticked. */
    readonly tickedCount: number;
    /** Whether every line of the current step is ticked. */
    readonly everyLineTicked: boolean;
    /** Whether the session is on Done, which has its own focus move. */
    readonly finished: boolean;
}

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

        const surface = document.querySelector('main');
        const target =
            tickedCount > 0 && !everyLineTicked
                ? surface?.querySelector('[role="checkbox"][aria-checked="false"]')
                : [...(surface?.querySelectorAll('nav button') ?? [])].at(-1);

        if (target instanceof HTMLElement) {
            target.focus({ preventScroll: true });
        }
    }, [moves, tickedCount, everyLineTicked, finished]);
}
