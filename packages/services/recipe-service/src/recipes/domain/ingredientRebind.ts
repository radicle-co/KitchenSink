/**
 * The pure halves of a line rebind (plan 002 U5): which phrase the rebind teaches the corrections store, and how
 * a stored line becomes the request line the update path re-saves.
 *
 * @pattern Data Mapper — pure, over the stored line and its binding
 */
import type { FoodLookupArm } from '../../database/schema/foodLookupArm.js';
import type { IngredientRow } from '../../database/schema/index.js';
import { quantityFromColumns } from '../dal/quantityColumns.js';
import { userNutritionFromColumns } from '../dal/userNutritionColumns.js';
import type { RecipeIngredientInput } from '../recipes.schema.js';

/**
 * The phrase a rebind records a correction for, or `undefined` when it records none.
 *
 * ⛔ R17 is about an UNMATCHED name: the parsed phrase of an imported line, else the name a failed lookup
 * recorded. A line bound to a food with no phrase has no unmatched name — its only name is the catalog's, and
 * teaching "food A's name means food B" would send every later "A" this cook types to B.
 *
 * @param row - The line being rebound.
 * @param arm - Its current binding.
 * @returns The phrase, or `undefined`. Pure.
 */
export function correctionPhraseOf(row: IngredientRow, arm: FoodLookupArm): string | undefined {
    if (row.sourcePhrase !== null) {
        return row.sourcePhrase;
    }

    return arm.kind === 'unresolved' ? arm.failure.name : undefined;
}

/**
 * A stored line as a request line, so the update path can re-save it unchanged (AE11).
 *
 * The transcription — source line, parsed phrase and stated measure — is not a request field; the update path
 * carries it forward for every line whose binding, quantity and unit did not move.
 *
 * @param row - The stored line.
 * @returns The request line. Pure.
 */
export function toLineRequest(row: IngredientRow): RecipeIngredientInput {
    return {
        ingredientId: row.foodLookupId,
        quantity: quantityFromColumns(row),
        // `''` is the column's "unitless"; the request spells it by omitting the key.
        ...(row.unit.length > 0 ? { unit: row.unit } : {}),
        ...(row.displayText !== null ? { notes: row.displayText } : {}),
        ...(row.preparation !== null ? { preparation: row.preparation } : {}),
        ...(row.groupLabel !== null ? { groupLabel: row.groupLabel } : {}),
        ...userNutritionFromColumns(row),
    };
}
