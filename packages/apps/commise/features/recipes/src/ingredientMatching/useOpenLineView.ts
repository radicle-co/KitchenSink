/**
 * @module @commise/features-recipes/ingredientMatching — an expanded line's view in the reader's copy, for a leaf that
 * is handed the line rather than its view (a flagged line's sheet and pane): its failed send and its food-choice list,
 * built by the same `openLineViewOf` the matched-line list and the paste pane use, so the three say the same.
 */
import type { MatchLine } from './matchLine.js';
import { openLineViewOf, type OpenLineView, type OpenPlace } from './matchLineView.js';
import { useMatchCopy } from './useMatchCopy.js';

/**
 * The line's expanded view, in the active locale's words.
 *
 * @param line - The line.
 * @param place - Whether search can run, the pick in flight, and whether the last send failed.
 * @returns The view; a leaf draws `failure` and `list`.
 */
export function useOpenLineView(line: MatchLine, place: OpenPlace): OpenLineView {
    return openLineViewOf(line, place, useMatchCopy());
}
