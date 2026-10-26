/**
 * @module @commise/features-recipes/ingredientMatching — a line's food-choice list view in the reader's copy, for a leaf
 * that is handed the line rather than its view (a flagged line's sheet and pane). One place reads the two copy sets the
 * view needs, so no leaf assembles them on its own.
 */
import { useMessages } from '@commise/i18n/react';

import { recipeMessages } from '../messages.js';
import type { MatchLine } from './matchLine.js';
import { choiceListViewOf, type FoodChoiceListView, type ListPlace } from './matchLineView.js';
import { matchLineMessages } from './messages.js';

/**
 * The line's food-choice list, in the active locale's words.
 *
 * @param line - The line.
 * @param place - Whether search can run, and the pick in flight.
 * @returns The list's view.
 */
export function useChoiceListView(line: MatchLine, place: ListPlace): FoodChoiceListView {
    const copy = { line: useMessages(matchLineMessages), details: useMessages(recipeMessages).ingredientDetails };

    return choiceListViewOf(line, place, copy);
}
