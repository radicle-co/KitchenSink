/**
 * @module useCookingFocusRecovery — keeps the screen-reader cursor on the cooking screen when the control that held it goes
 * away. Ticking a line moves its row out of the list, and Cook it again unmounts the Done action. After a tick, or after
 * Cook it again, the cursor goes to the next place the cook acts (designer D13): the new focus line while some line is
 * still unticked, otherwise the forward control (Next step, Start step or Finish). Opening a step and pressing Back or Next
 * leave it where it is.
 *
 * It answers with a request the screen hands to the two controls (`focusRequested`), and the control acknowledges it, so
 * the hook holds no ref and moves nothing itself.
 *
 * @pattern Command — a level-triggered focus request, raised by a tick or a restart and lowered by the control that took it
 */
import { useState } from 'react';

/** The control a request is for. */
export type CookingFocusTarget = 'focusLine' | 'forward';

/** What decides where the cursor goes. */
export interface CookingFocusRecoveryInput {
    /** How many times the cook has moved between steps (Cook it again counts). */
    readonly moves: number;
    /** How many lines of the current step are ticked. */
    readonly tickedCount: number;
    /** Whether every line of the current step is ticked. */
    readonly everyLineTicked: boolean;
    /** Whether the session is on Done, which moves the cursor to its own title. */
    readonly finished: boolean;
}

/** The request: the control that should take the cursor, or `null`, and how a control acknowledges it. */
export interface CookingFocusRecovery {
    readonly target: CookingFocusTarget | null;
    readonly handled: () => void;
}

/**
 * Where the cursor goes after what changed, or `null` for nowhere. Pure.
 *
 * @param seen - The inputs the last request was decided on.
 * @param now - The inputs now.
 */
export function focusTargetOf(
    seen: CookingFocusRecoveryInput,
    now: CookingFocusRecoveryInput,
): CookingFocusTarget | null {
    if (now.finished) {
        return null;
    }

    if (now.moves !== seen.moves) {
        // Only a restart from Done lands here with the cursor lost; Back and Next leave it on their own control.
        return seen.finished ? 'forward' : null;
    }

    if (now.tickedCount === seen.tickedCount) {
        return null;
    }

    return now.tickedCount > 0 && !now.everyLineTicked ? 'focusLine' : 'forward';
}

/**
 * Raise a focus request after a tick or a restart.
 *
 * @param input - The tick and move state the request is decided on.
 * @returns The target to hand to the controls, and the acknowledgement that lowers it.
 */
export function useCookingFocusRecovery(input: CookingFocusRecoveryInput): CookingFocusRecovery {
    const [seen, setSeen] = useState(input);
    const [target, setTarget] = useState<CookingFocusTarget | null>(null);

    // State replaced during render when its inputs change is the documented way to derive a request from a change.
    if (
        seen.moves !== input.moves ||
        seen.tickedCount !== input.tickedCount ||
        seen.everyLineTicked !== input.everyLineTicked ||
        seen.finished !== input.finished
    ) {
        setSeen(input);
        setTarget(focusTargetOf(seen, input));
    }

    return { target, handled: () => setTarget(null) };
}
