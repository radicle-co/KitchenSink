/**
 * @module @commise/features-recipes/form — the contract `PasteChoicePane`'s web and native leaves share: the side pane
 * that steps through the open lines at 1194 and on web.
 */
import type { FoodChoiceListProps } from '../ingredientMatching/foodChoiceListProps.js';
import type { PasteMatchPaneView } from './pasteMatchView.js';

/** Props for `PasteChoicePane`: the pane's view, its line's list controls, and the two steps. */
export interface PasteChoicePaneProps extends Omit<FoodChoiceListProps, 'view'> {
    /** What the pane shows (`pasteMatchPaneViewOf`). */
    readonly view: PasteMatchPaneView;
    /** Previous was pressed: show the open line before this one (`paneStepsOf`'s `previousKey`). */
    readonly onPrevious: () => void;
    /** Next open line was pressed: show the open line after this one. */
    readonly onNext: () => void;
    /** Try again, after a pick in the pane that did not save. */
    readonly onRetryPick: () => void;
}
