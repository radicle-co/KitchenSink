/**
 * @module @commise/features-recipes/ingredientMatching — the contract `MatchOpenRow`'s web and native leaves share: the
 * one expanded line on phone and 834, in either flow.
 */
import type { FoodChoiceListProps } from './foodChoiceListProps.js';
import type { LineText } from './matchLine.js';
import type { OpenLineView } from './matchLineView.js';

/** Props for `MatchOpenRow`: the line, its prompt, and its list's controls (`FoodChoiceList`). */
export interface MatchOpenRowProps extends Omit<FoodChoiceListProps, 'view'> {
    /** The line as the cook wrote it. */
    readonly line: LineText;
    /** What the expanded line shows (`lineRowOf`'s `open` row). */
    readonly view: OpenLineView;
}
