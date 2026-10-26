/**
 * @module @commise/features-recipes/ingredientMatching — the copy a matched line's view reads, in the active locale: the
 * line's own words and the picker's words for a food's parts. One place assembles the two sets, so no leaf builds the
 * pair on its own.
 */
import { useMessages } from '@commise/i18n/react';

import { recipeMessages } from '../messages.js';
import type { MatchCopy } from './matchLineView.js';
import { matchLineMessages } from './messages.js';

/**
 * The matched line's copy, in the active locale.
 *
 * @returns The copy `lineRowOf` and `choiceListViewOf` read.
 */
export function useMatchCopy(): MatchCopy {
    return { line: useMessages(matchLineMessages), details: useMessages(recipeMessages).ingredientDetails };
}
