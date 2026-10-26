/**
 * @module @commise/features-recipes/ingredientMatching — the contract `MatchSettledRow`'s web and native leaves share: a
 * matched line that needs nothing from the cook now, in either flow.
 */
import type { LineText } from './matchLine.js';
import type { SettledAction, SettledLineView } from './matchLineView.js';

/** Props for `MatchSettledRow`. */
export interface MatchSettledRowProps {
    /** The line as the cook wrote it. */
    readonly line: LineText;
    /** What the line shows (`lineRowOf`'s `settled` row). */
    readonly view: SettledLineView;
    /** One of the line's controls was pressed, by its kind. */
    readonly onAction: (action: SettledAction['kind']) => void;
    /** See why, after a late review result. */
    readonly onSeeWhy: () => void;
}
