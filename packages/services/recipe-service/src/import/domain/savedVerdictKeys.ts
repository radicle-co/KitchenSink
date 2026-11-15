/**
 * `savedVerdictKeysOf` — the verdict key to store beside each snapshot line a bulk import just saved (ADR-0072 §4).
 *
 * DESIGN PATTERN: **Specification**, pure. A saved line's verdict lives under a key that the recipe detail derives from the
 * saved line (`verdictKeyOfLine`). The flagged list and the view's `version` read verdicts in SQL, so the import stores that
 * key once, in the save's own transaction, instead of re-deriving a hash for every line on every poll. The derivation is not
 * restated here: this module only decides WHICH lines get one and hands each to the one authority.
 *
 * A line gets none when no verdict about it can exist: it came from no snapshot line, the importer kept it as written, it is
 * bound to no food, or it has no source text.
 */
import { sha256Hex } from '../../common/sha256.js';
import type { IngredientRow } from '../../database/schema/index.js';
import { quantityFromColumns, statedMeasureFromColumns } from '../../recipes/dal/quantityColumns.js';
import { verdictKeyOfLine } from '../../recipes/domain/lineVerdictKey.js';

/** The columns of a saved line the key is derived from. */
export type SavedLineFacts = Pick<
    IngredientRow,
    | 'importLineId'
    | 'boundBy'
    | 'foodLookupId'
    | 'quantity'
    | 'quantityHigh'
    | 'unit'
    | 'sourceLine'
    | 'statedUnit'
    | 'statedQuantity'
    | 'statedQuantityHigh'
>;

/** A key to store for one snapshot line. */
export interface SavedVerdictKey {
    readonly id: string;
    readonly key: string;
}

/**
 * The keys to store for a saved recipe's lines, in line order.
 *
 * @param lines - The persisted lines.
 * @param foodIdOf - The id of the food (root or variant) a line's binding names, or `undefined` for a line kept as written.
 * @returns One entry per line that can have a verdict. Pure.
 */
export function savedVerdictKeysOf(
    lines: readonly SavedLineFacts[],
    foodIdOf: (foodLookupId: string) => string | undefined,
): readonly SavedVerdictKey[] {
    return lines.flatMap((line) => {
        if (line.importLineId === null || line.boundBy === null) {
            return [];
        }

        const key = verdictKeyOfLine(
            {
                quantity: quantityFromColumns(line),
                unit: line.unit,
                sourceLine: line.sourceLine,
                statedMeasure: statedMeasureFromColumns(line),
            },
            foodIdOf(line.foodLookupId),
            sha256Hex,
        );

        return key === undefined ? [] : [{ id: line.importLineId, key }];
    });
}
