/**
 * @module @commise/features-recipes/ingredientMatching — the contract `MatchLineList`'s web and native leaves share: a
 * recipe's matched lines, in either flow.
 */
import type { ControlFocus } from '../common/controlFocus.js';
import type { MatchLine, PendingSend } from './matchLine.js';
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
    /** What the host is sending, and for which line: it reads busy on that line alone. */
    readonly pending: { readonly key: string; readonly send: PendingSend } | undefined;
    /** A request that the open line's Search take focus (after the pick on the line before; `pickFocusOf`). */
    readonly searchFocus: ControlFocus;
}
