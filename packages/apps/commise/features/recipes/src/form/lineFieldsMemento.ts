/**
 * @module @commise/features-recipes/form — what the row editor's Cancel puts back.
 *
 * When a row editor opens it captures the line; Cancel puts back the six fields it edits. The binding and status fields
 * (`ingredientId`, `foodId`, `variant`, `resolutionStatus`, `name`, …) are NEVER in the memento, so Cancel cannot undo a
 * food change made through Change. A key absent at capture is absent after the restore, so `recipeFormValuesEqual`
 * still holds and the discard guard sees no change.
 *
 * Pure and platform-agnostic.
 *
 * @pattern Memento — originator side: the line captures and restores its own edited fields
 */
import type { RecipeFormIngredient } from './values.js';

/**
 * The line as the row editor opened it. Only the six fields the row editor edits are ever read back out of it, but the
 * whole line is kept because the discard guard compares drafts as JSON, which is key-order sensitive: restoring the
 * right values in a new key order would still read as an edit.
 */
export interface LineFieldsMemento {
    readonly original: RecipeFormIngredient;
}

/**
 * Snapshot a line. Pure.
 *
 * @param line - The line as the row editor opens.
 * @returns The memento.
 */
export const captureLineFields = (line: RecipeFormIngredient): LineFieldsMemento => ({ original: line });

/**
 * Put the six edited fields back on a line, leaving every other field as it is NOW (so a food change survives). A key
 * absent at capture is absent after, and keys keep their captured order. Pure.
 *
 * @param line - The line now.
 * @param memento - From {@link captureLineFields}.
 * @returns The line with its edited fields as captured.
 */
export const restoreLineFields = (line: RecipeFormIngredient, memento: LineFieldsMemento): RecipeFormIngredient => {
    const { quantity, quantityHigh, unit, displayText, note, preparation, ...kept } = line;

    // The six destructured names are the edited fields; `kept` is everything else, as it is now.
    void [quantity, quantityHigh, unit, displayText, note, preparation];

    return { ...memento.original, ...kept };
};
