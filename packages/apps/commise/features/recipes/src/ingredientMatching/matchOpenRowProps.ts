/**
 * @module @commise/features-recipes/ingredientMatching — the contract `MatchOpenRow`'s web and native leaves share: the
 * one expanded line on phone and 834, in either flow.
 */
import type { FoodChoiceListProps } from './foodChoiceListProps.js';
import type { LineText } from './matchLine.js';
import type { OpenLineView } from './matchLineView.js';
import type { LineRetryFocus } from './useRetryFocus.js';

/** Props for `MatchOpenRow`: the line, its prompt, and its list's controls (`FoodChoiceList`). */
export interface MatchOpenRowProps extends Omit<FoodChoiceListProps, 'view' | 'landing'> {
    /** The line as the cook wrote it. */
    readonly line: LineText;
    /** What the expanded line shows (`lineRowOf`'s `open` row). */
    readonly view: OpenLineView;
    /** Try again, after a pick that did not save. */
    readonly onRetryPick: () => void;
    /** Where focus goes when Try again is pressed and when its retry fails again (`useRetryFocus`). */
    readonly retry: LineRetryFocus;
}
