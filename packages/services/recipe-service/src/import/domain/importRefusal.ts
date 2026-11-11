/**
 * Which recipes a bulk import REFUSES outright (ADR-0072 §3, owner ruling 2026-11-11): one with no ingredient lines or no
 * steps. It is never paid for, parsed or saved, and it shows as not importable with its reason.
 *
 * DESIGN PATTERN: **Adapter** onto the ONE publish policy's content rule (`unmetContentRequirements`), never a second copy of
 * it. The answer is a STORED fact, set when the item is written (`recipe_import_items.refusal`), because the paying and parsing
 * queries must leave a refused item alone in SQL, where the payload's counts are not at hand.
 */
import type { IMPORT_REFUSALS } from '../../database/schema/recipeImports.js';
import { unmetContentRequirements } from '../../recipes/domain/publishPolicy.js';

/** The reasons an import refuses a recipe: the vocabulary the table's CHECK holds (`IMPORT_REFUSALS`). */
export type ImportRefusal = (typeof IMPORT_REFUSALS)[number];

/** The reason a requirement the recipe lacks is refused for. */
const REFUSAL_OF = { ingredients: 'noIngredients', steps: 'noSteps' } as const satisfies Record<
    'ingredients' | 'steps',
    ImportRefusal
>;

/**
 * Why the import refuses this recipe, or `null` when it does not. The first unmet requirement wins, in the publish order.
 *
 * @param recipe - The recipe as the file stated it.
 * @returns The refusal, or `null`. Pure and total.
 */
export function importRefusalOf(recipe: {
    readonly ingredientLines: readonly unknown[];
    readonly steps: readonly unknown[];
}): ImportRefusal | null {
    const [first] = unmetContentRequirements({
        ingredientCount: recipe.ingredientLines.length,
        stepCount: recipe.steps.length,
    });

    return first === undefined ? null : REFUSAL_OF[first];
}
