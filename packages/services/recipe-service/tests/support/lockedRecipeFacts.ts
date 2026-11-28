import type { RecipeRow } from '../../src/database/schema/index.js';
import type { LockedRecipeFacts } from '../../src/recipes/dal/recipes.dal.js';

/**
 * The facts `RecipesDal.lockSlotFacts` returns for a stored row, for a mocked-DAL double. Typed against
 * `LockedRecipeFacts`, so a column the real query adds is a compile error here and not a silent `undefined` in the double.
 *
 * @param row - The recipe row the double holds.
 * @returns The locked facts of that row.
 */
export function lockedFactsOf(row: RecipeRow): LockedRecipeFacts {
    return {
        visibility: row.visibility,
        status: row.status,
        sourceType: row.sourceType,
        sourceKind: row.sourceKind,
        sourceUrl: row.sourceUrl,
        sourceConfirmedAt: row.sourceConfirmedAt,
        sourceCorrectionHold: row.sourceCorrectionHold,
        statementKind: row.statementKind,
        contentPastedAt: row.contentPastedAt,
        clonedFromId: row.clonedFromId,
        sourceAttribution: row.sourceAttribution,
    };
}
