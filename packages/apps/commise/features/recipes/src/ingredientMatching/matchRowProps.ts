/**
 * @module @commise/features-recipes/ingredientMatching — the contract of `MatchRow`, the one dispatch from a line's row to
 * the leaf that draws it: every control reports to the host with its line's key.
 */
import type { ControlFocus } from '../common/controlFocus.js';
import type { LinePick } from './matchLine.js';
import type { LineRow } from './matchLineView.js';
import type { LineRetryFocus } from './useRetryFocus.js';

/** What a line's controls ask of the host, each with the line's key. */
export interface MatchRowHandlers {
    /** Open the line: a collapsed open line was pressed, or Change on a bound one. */
    readonly onOpen: (key: string) => void;
    /** A food, or keeping the line as written, was picked. The host raises its pending send in this call. */
    readonly onPick: (key: string, pick: LinePick) => void;
    /** Search for a food was pressed (the one food picker, prefilled with the line's food words). */
    readonly onSearch: (key: string) => void;
    /** Use this, on a line still being checked: bind its proposal. */
    readonly onUseProposal: (key: string) => void;
    /** Try again, on a line whose options failed. */
    readonly onRetry: (key: string) => void;
    /**
     * Try again, on a line whose last send did not save: send it again.
     * Keep the line drawn while the retry is in flight (expanded, or shown in the pane)
     * and move focus on (`pickFocusOf`) when it saves, not when Try again is pressed:
     * Try again hands focus to the control the retry made busy (`useRetryFocus`), which must still be on screen.
     */
    readonly onRetryPick: (key: string) => void;
    /** See why, after a late review result: the host shows the reason. */
    readonly onSeeWhy: (key: string, reason: string) => void;
}

/** Props for `MatchRow`. */
export interface MatchRowProps extends MatchRowHandlers {
    /** The line's row (`lineRowOf`). */
    readonly row: LineRow;
    /** A request that the open row's list take focus. Only an open row has a list to take it. */
    readonly focus: ControlFocus;
    /** Where focus goes when the line's Try again is pressed and when its retry fails again (`useRetryFocus`). */
    readonly retry: LineRetryFocus;
}
