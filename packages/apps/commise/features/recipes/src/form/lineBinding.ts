/**
 * @module @commise/features-recipes/form — the fields of a draft ingredient line that its BINDING decides, and the
 * one way to replace them (`docs/design/ingredientStatusExplanation.md` §4a).
 *
 * A re-point (Change food, a details pick) swaps what the line is bound to and nothing the cook wrote: quantity, unit,
 * preparation, section, notes and the cook's own figures stay (§4b). Pure and platform-agnostic.
 *
 * @pattern Value Object — {@link LineBinding}, the binding half of a line, which always names a food
 */
import type { RecipeFormIngredient } from './values.js';

/** The binding half of a line. It always names a food, so a re-point to nothing is not expressible (§4a). */
export type LineBinding = Pick<
    RecipeFormIngredient,
    'name' | 'isUserEntered' | 'resolutionStatus' | 'unresolvedReason' | 'foodId' | 'variant'
> & { readonly ingredientId: string };

/**
 * The line re-pointed at `binding`. Every binding fact of the old line goes, including one the new binding does not
 * state: a stale `unresolvedReason` would route the row to the old binding's remedy. Pure.
 *
 * @param line - The line to re-point.
 * @param binding - What it is now bound to.
 * @returns The line with the new binding and everything else unchanged.
 */
export const withLineBinding = (line: RecipeFormIngredient, binding: LineBinding): RecipeFormIngredient => {
    const {
        ingredientId: _ingredientId,
        name: _name,
        isUserEntered: _isUserEntered,
        resolutionStatus: _resolutionStatus,
        unresolvedReason: _unresolvedReason,
        foodId: _foodId,
        variant: _variant,
        ...written
    } = line;

    return { ...written, ...binding };
};
