/**
 * @module @commise/features-recipes/ingredientMatching — the contract `MatchFailureLine`'s web and native leaves share:
 * a matched line's send that did not save, and Try again.
 */
import type { PickFailureView } from './matchLineView.js';

/** Props for `MatchFailureLine`. */
export interface MatchFailureLineProps {
    /** The failure's sentence and Try again's words (`PickFailureView`). */
    readonly failure: PickFailureView;
    /** Try again was pressed: send the line's choice again. */
    readonly onRetry: () => void;
}
