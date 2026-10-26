/**
 * @module @commise/features-recipes/ingredient-matching — the ONE matched-line model both ingredient-matching flows read
 * (the editor's paste flow, bulk import), for the apps' orchestration: the line, its binding and the send in flight, and
 * the rules every count, "next line" and focus move is built from. The import surfaces themselves are
 * `@commise/features-recipes/import`'s.
 *
 * A package-export entry (the one kind of barrel this repo keeps).
 */
export { isNothingToFix, isOpenLine, matchCountsOf, nextOpenLineKey, pickFocusOf } from './matchLine.js';
export type {
    BoundBy,
    FoodChoice,
    LineBinding,
    LinePick,
    LineText,
    MatchCounts,
    MatchLine,
    PendingSend,
    PickFocus,
    ReviewNote,
} from './matchLine.js';
