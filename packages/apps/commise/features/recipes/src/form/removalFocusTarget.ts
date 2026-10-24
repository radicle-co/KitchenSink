/**
 * @module @commise/features-recipes/form — where focus goes after an ingredient row is removed
 * (`docs/design/ingredientStatusExplanation.md` V1 sign-off item 11, §2d).
 *
 * Both row leaves read this one rule, so the two platforms cannot hand focus to different places. Each leaf carries
 * the target out by its own means: keyboard focus on web, the screen-reader cursor on native.
 *
 * Pure and platform-agnostic.
 */
import type { IngredientLineKey } from './lineKey.js';
import type { RecipeFormIngredient } from './values.js';

/** The control that takes focus after a removal. */
export type RemovalFocusTarget =
    /** The named row's open control ("Edit {amount} {food}", build spec §7.5.1): every row has one. */
    | { readonly kind: 'open'; readonly key: IngredientLineKey }
    /** The control after the list: Add ingredient today, the trailing combobox once the add row is one. */
    | { readonly kind: 'trailing' };

/**
 * The control that takes focus once the row at `index` is removed. Pure.
 *
 * Rows are keyed, so the row after the removed one keeps its controls through the removal, and its key names it.
 *
 * @param lines - The draft's lines BEFORE the removal.
 * @param index - The position of the row being removed.
 * @returns The next row's open control, or the trailing control when the removed row was last.
 */
export const removalFocusTarget = (lines: readonly RecipeFormIngredient[], index: number): RemovalFocusTarget => {
    const next = lines[index + 1];

    if (next === undefined) {
        return { kind: 'trailing' };
    }

    return { kind: 'open', key: next.key };
};
