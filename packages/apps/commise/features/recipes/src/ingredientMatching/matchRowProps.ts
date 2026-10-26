/**
 * @module @commise/features-recipes/ingredientMatching — the contract `MatchRow`'s web and native leaves share, and the
 * one way a settled row's control reaches the host: every control reports with its line's key.
 */
import type { ControlFocus } from '../form/controlFocus.js';
import type { LinePick } from './matchLine.js';
import type { LineRow, SettledAction } from './matchLineView.js';

/** What a line's controls ask of the host, each with the line's key. */
export interface MatchRowHandlers {
    /** Open the line: a collapsed open line was pressed, or Change on a bound one. */
    readonly onOpen: (key: string) => void;
    /** A food, or keeping the line as written, was picked. */
    readonly onPick: (key: string, pick: LinePick) => void;
    /** Search for a food was pressed (the one food picker, prefilled with the line's food words). */
    readonly onSearch: (key: string) => void;
    /** Use this, on a line still being checked: bind its proposal. */
    readonly onUseProposal: (key: string) => void;
    /** Try again, on a line whose options failed. */
    readonly onRetry: (key: string) => void;
    /** See why, after a late review result: the host shows the reason. */
    readonly onSeeWhy: (key: string, reason: string) => void;
}

/** Props for `MatchRow`. */
export interface MatchRowProps extends MatchRowHandlers {
    /** The line's row (`lineRowOf`). */
    readonly row: LineRow;
    /** A request that the open row's Search take focus. Only an open row has a Search to take it. */
    readonly searchFocus: ControlFocus;
}

/**
 * Carry a settled row's control to the host. An exhaustive switch over the action kinds with no default branch, so a
 * new kind is a compile error here.
 *
 * @param action - The control pressed.
 * @param key - Its line.
 * @param handlers - The host's handlers.
 * @sideEffect Calls the one handler the action maps to.
 */
export function runSettledAction(action: SettledAction['kind'], key: string, handlers: MatchRowHandlers): void {
    switch (action) {
        case 'change':
            handlers.onOpen(key);

            return;
        case 'useThis':
            handlers.onUseProposal(key);

            return;
        case 'search':
            handlers.onSearch(key);

            return;
        case 'keepAsWritten':
            handlers.onPick(key, { kind: 'asWritten' });

            return;
        case 'retry':
            handlers.onRetry(key);

            return;
    }
}
