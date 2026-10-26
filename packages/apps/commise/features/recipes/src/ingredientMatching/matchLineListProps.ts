/**
 * @module @commise/features-recipes/ingredientMatching — the contract `MatchLineList`'s web and native leaves share: a
 * recipe's matched lines, in either flow.
 */
import type { ControlFocus } from '../form/controlFocus.js';
import type { LinePick, MatchLine } from './matchLine.js';
import type { MatchRowHandlers } from './matchRowProps.js';

/** Props for `MatchLineList`. Controlled: which line is open, and what a pick does, are the host's. */
export interface MatchLineListProps extends MatchRowHandlers {
    /** The lines, in the recipe's order. */
    readonly lines: readonly MatchLine[];
    /** The line drawn open (phone and 834: one at a time; Change on a bound line), or `undefined` for none. */
    readonly expandedKey: string | undefined;
    /** The line the side pane shows (1194 and web), marked current in its collapsed row; `undefined` without a pane. */
    readonly currentKey: string | undefined;
    /** Whether search and the review can run. */
    readonly online: boolean;
    /** The pick in flight for the open line, if any. */
    readonly pending: LinePick | undefined;
    /** A request that the open line's Search take focus (after the pick on the line before; `pickFocusOf`). */
    readonly searchFocus: ControlFocus;
}
