/**
 * @module @commise/features-recipes/editor — what the publish sheet is told about the paste's lines that have no food yet
 * (R23, `docs/design/uiRefreshWorkshop5/redesignCanvas/ingredientMatching.md` "Save"). Publishing with open choices is
 * allowed; the sheet names them, says they are saved as written and do not count toward nutrition, and offers Choose now
 * or Publish anyway.
 *
 * The sheet is asked for ONLY while a line needs a pick (`isOpenLine`). Lines that are only being checked do not stop
 * the cook: `OpenChoicesFacts.openNames` requires at least one name, and a sheet over none would read "0 ingredients have
 * no food yet". (The blueprint opens it on "choose + checking > 0"; that contradicts the sheet's own contract, so the host
 * follows the contract and names the checking lines inside a sheet an open line already earned.)
 *
 * Pure and platform-agnostic.
 *
 * @pattern Specification — `openChoiceFactsOf` is the one rule that decides whether Publish asks first
 */
import { isOpenLine, type MatchLine } from '../ingredientMatching/matchLine.js';
import type { OpenChoicesFacts } from './openChoicesCopy.js';

/** Whether a line holds no food: nothing bound, or bound to "as written". Pure. */
const holdsNoFood = (line: MatchLine): boolean => line.binding?.pick.kind !== 'food';

/**
 * The facts for the publish sheet, or `undefined` when Publish should go straight through. Pure.
 *
 * @param lines - The paste's matched lines, in recipe order.
 * @param total - Every ingredient line of the draft, the paste's included.
 * @returns The open and checking lines' names and how many lines count, or `undefined` while no line needs a pick.
 */
export function openChoiceFactsOf(lines: readonly MatchLine[], total: number): OpenChoicesFacts | undefined {
    const open = lines.filter(isOpenLine);

    if (open.length === 0) {
        return undefined;
    }

    return {
        openNames: open.map((line) => line.line.words),
        checkingNames: lines
            .filter((line) => line.state === 'checking' && line.binding === undefined)
            .map((line) => line.line.words),
        counted: total - lines.filter(holdsNoFood).length,
        total,
    };
}
