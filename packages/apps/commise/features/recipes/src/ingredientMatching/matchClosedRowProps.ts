/**
 * @module @commise/features-recipes/ingredientMatching — the contract `MatchClosedRow`'s web and native leaves share: an
 * open line drawn collapsed, in either flow.
 */
import type { LineText } from './matchLine.js';

/** Props for `MatchClosedRow` (`lineRowOf`'s `closed` row). */
export interface MatchClosedRowProps {
    /** The line as the cook wrote it. */
    readonly line: LineText;
    /** What the line needs ("Choose a food · 5 options"). */
    readonly need: string;
    /** The side pane shows this line (1194 and web): it is marked current. Display only; the row does the same thing. */
    readonly current: boolean;
    /** A send for the line is in flight: the row refuses to open (and keeps focus, on web). */
    readonly refusing: boolean;
    /** The line's last send failed: said in attention in place of its need. */
    readonly failure: string | undefined;
    /** The row was pressed: open this line. Never called while refusing. */
    readonly onOpen: () => void;
}
