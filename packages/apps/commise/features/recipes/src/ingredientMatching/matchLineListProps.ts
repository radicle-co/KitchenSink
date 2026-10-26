/**
 * @module @commise/features-recipes/ingredientMatching — the contract `MatchLineList`'s web and native leaves share: a
 * recipe's matched lines, in either flow.
 */
import type { ControlFocus } from '../common/controlFocus.js';
import type { MatchLine, PendingSend } from './matchLine.js';
import type { MatchRowHandlers } from './matchRowProps.js';

/** What the list's ONE polite live region says: the host words it (`lineChangesOf` plus its counts). */
export interface ListAnnouncement {
    readonly text: string;
    /** Moves at each announcement, so the same words said again are spoken again (`LiveRegion`'s `occurrence`). */
    readonly occurrence: number;
}

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
    /**
     * What the host is sending, by line. Several lines may be sending at once; each reads busy on its own line, and a
     * line that is sending refuses a second pick, its Change and its opening.
     */
    readonly pending: ReadonlyMap<string, PendingSend>;
    /** The lines whose last send did not save. Each says so, with Try again, until a retry is in flight. */
    readonly failed: ReadonlySet<string>;
    /** What the list's one polite live region says now (U9). */
    readonly announcement: ListAnnouncement;
    /** A request that the open line's list take focus (after the pick on the line before; `pickFocusOf`). */
    readonly focus: ControlFocus;
}
