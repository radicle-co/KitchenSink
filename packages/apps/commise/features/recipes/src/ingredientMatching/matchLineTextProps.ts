/**
 * @module @commise/features-recipes/ingredientMatching — the contract `MatchLineText`'s web and native leaves share.
 */
import type { LineText } from './matchLine.js';

/** Props for `MatchLineText`. */
export interface MatchLineTextProps {
    /** The line as the cook wrote it: its measure and its words. */
    readonly line: LineText;
}
