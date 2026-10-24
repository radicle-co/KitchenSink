/**
 * @module @commise/features-recipes/form — which pick brings a row the page should show
 * (`docs/design/uiOverhaul/ingredientArrival.md`, behavior 3). A pick on the trailing add row adds a line straight above
 * the add field; the page shows that row with the field, and the row wears a tint until the cook moves on. Both
 * platform leaves read this one fact and keep their own mechanism (`PLATFORM-FORK`): native asks the field reveal host,
 * web asks the `ScrollHost`.
 *
 * Pure and platform-agnostic.
 *
 * @pattern Specification — `rowArrivalOf`, a pure predicate over a settled commit
 */
import type { LineCommitOutcome, LineCommitTarget } from '../hooks/lineCommit.js';
import type { IngredientLineKey } from './lineKey.js';

/** The row that just arrived above the add field. */
export interface RowArrival {
    readonly key: IngredientLineKey;
}

/** What the row editor settled last: where the pick landed and how it ended. */
export interface SettledPick {
    readonly target: LineCommitTarget;
    readonly outcome: LineCommitOutcome;
}

/** What decides whether the last commit still brings an arrival. */
export interface ArrivalContext {
    /** The cook has moved past the commit: typed, picked again, used Change food or cancelled (`movedPast`). */
    readonly movedPast: boolean;
    /** The commit settled while the cook was here, not before the field group mounted or in another section. */
    readonly heard: boolean;
    /**
     * The cook typed in the add field while this pick was in flight: the field holds the new word, and a scroll now
     * would pull it away mid-word.
     */
    readonly interrupted: boolean;
}

/**
 * The arrival a settled commit brings. Pure.
 *
 * @param settled - The last commit that settled, or `undefined`.
 * @param context - Whether the cook moved past it, settled it while here, or typed on while it was in flight.
 * @returns The new row's key; `undefined` for anything but a committed pick on the trailing add row the cook has not
 *     moved past.
 */
export function rowArrivalOf(settled: SettledPick | undefined, context: ArrivalContext): RowArrival | undefined {
    if (
        settled === undefined ||
        context.movedPast ||
        !context.heard ||
        context.interrupted ||
        settled.target.kind !== 'newLine' ||
        settled.outcome.kind !== 'committed'
    ) {
        return undefined;
    }

    return { key: settled.outcome.key };
}
