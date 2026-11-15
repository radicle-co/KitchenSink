/**
 * @module cookingFocusTarget — where the cook's next action is after a tick, written once for both platforms' focus
 * recovery: the focus line while a line is ticked and some line is still unticked, otherwise the forward control (Next
 * step, Start step or Finish).
 */

/** The control that does the cook's next job. */
export type CookingFocusTarget = 'focusLine' | 'forward';

/**
 * The control the cook acts on next.
 *
 * @param step - How many lines of the step are ticked, and whether every one is.
 * @returns The focus line while a line is ticked and one is left to do, otherwise the forward control. Pure.
 */
export function cookingFocusTargetOf({
    tickedCount,
    everyLineTicked,
}: {
    readonly tickedCount: number;
    readonly everyLineTicked: boolean;
}): CookingFocusTarget {
    return tickedCount > 0 && !everyLineTicked ? 'focusLine' : 'forward';
}

/** What decides where the cook's focus goes, on either platform. */
export interface CookingFocusRecoveryInput {
    /** How many times the cook has moved between steps (Cook it again counts). */
    readonly moves: number;
    /** How many lines of the current step are ticked. */
    readonly tickedCount: number;
    /** Whether every line of the current step is ticked. */
    readonly everyLineTicked: boolean;
    /** Whether the session is on Done, which has its own focus move. */
    readonly finished: boolean;
}
