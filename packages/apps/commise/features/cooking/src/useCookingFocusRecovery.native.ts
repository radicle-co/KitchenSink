/**
 * @module useCookingFocusRecovery — keeps the screen-reader cursor on the cooking screen when the control that held it goes
 * away. Ticking a line moves its row out of the list, and Cook it again unmounts the Done action. After a tick, the cursor
 * goes to the next place the cook acts (designer D13): the new focus line while some line is still unticked, otherwise the
 * forward control (Next step, Start step or Finish). After Cook it again it goes to step 1's forward control. Opening a
 * step and pressing Back or Next leave it where it is.
 *
 * It answers with a request the screen hands to the two controls (`focusRequested`), and the control acknowledges it, so
 * the hook holds no ref and moves nothing itself.
 *
 * @pattern Command — a level-triggered focus request, raised by a tick or a restart and lowered by the control that took it
 */
import { useState } from 'react';

import { cookingFocusTargetOf, type CookingFocusRecoveryInput, type CookingFocusTarget } from './cookingFocusTarget.js';

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
function focusTargetOf(seen: CookingFocusRecoveryInput, now: CookingFocusRecoveryInput): CookingFocusTarget | null {
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

    return cookingFocusTargetOf(now);
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
