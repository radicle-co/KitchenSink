/**
 * @module @commise/features-recipes/ingredientMatching — a line's food-choice list view in the reader's copy, for a leaf
 * that is handed the line rather than its view (a flagged line's sheet and pane).
 */
import type { MatchLine } from './matchLine.js';
import { choiceListViewOf, type FoodChoiceListView, type ListPlace } from './matchLineView.js';
import { useMatchCopy } from './useMatchCopy.js';

/**
 * The line's food-choice list, in the active locale's words.
 *
 * @param line - The line.
 * @param place - Whether search can run, and the pick in flight.
 * @returns The list's view.
 */
export function useChoiceListView(line: MatchLine, place: ListPlace): FoodChoiceListView {
    return choiceListViewOf(line, place, useMatchCopy());
}
