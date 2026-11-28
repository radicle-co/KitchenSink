/**
 * @module @commise/ui/cooking-timer-row — the shared contract of the cooking timer row: one frame leaf that holds a
 * body and the row's actions, and one summary part for the body. Every string comes from the caller, already localised.
 *
 * The frame owns the actions and the layout; the body is a slot. S3a puts a {@link CookingTimerSummaryProps} summary in
 * it; a later row that opens another recipe puts a pressable part there instead, composed of the same summary.
 */
import type { ReactNode } from 'react';

/** One action on the row: its accessible name and what it does. */
export interface TimerRowAction {
    /** The control's accessible name, already localised ("Pause Roast timer"). */
    readonly label: string;
    /** Called once per press. */
    readonly onPress: () => void;
    /** The host asks for focus on this action's button (a level; see `IconButtonProps.focusRequested`). */
    readonly focusRequested?: boolean;
    /** Called once the button has taken a requested focus. */
    readonly onFocusRequestHandled?: () => void;
}

/**
 * The row's state. It changes only which glyphs the actions draw and which actions exist: a running timer pauses or
 * cancels, a paused one resumes or cancels, a finished one only stops.
 */
export type CookingTimerRowState =
    | { readonly kind: 'running'; readonly pause: TimerRowAction; readonly cancel: TimerRowAction }
    | { readonly kind: 'paused'; readonly resume: TimerRowAction; readonly cancel: TimerRowAction }
    | { readonly kind: 'done'; readonly stop: TimerRowAction };

/** What the row frame is given. */
export interface CookingTimerRowProps {
    /** Which timer state the row shows, and the actions that state offers. */
    readonly state: CookingTimerRowState;
    /** The row's body, usually a `CookingTimerSummary`. */
    readonly body: ReactNode;
}

/** What the summary part is given. */
export interface CookingTimerSummaryProps {
    /** The time, already formatted ("4:30", "1:09:50"). Never wraps, never truncates. */
    readonly figure: string;
    /** A word for the state ("Paused", "Done"), or absent while the timer runs. */
    readonly status?: string;
    /** What the timer is for and where ("Roast, step 4"). It wraps. */
    readonly meta: string;
    /** The whole summary's accessible name, in words ("Roast, 4 minutes 30 seconds left"). */
    readonly accessibilityLabel: string;
}
