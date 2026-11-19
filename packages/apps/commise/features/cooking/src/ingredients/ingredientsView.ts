/**
 * @module ingredientsView — the ingredients list cooking mode draws, as plain data: the rows scaled to the cook's
 * servings in stored order, which of them are ticked, the heading, and the note that the steps still give the recipe's
 * own amounts. A row's amount is NOT formatted here: the recipe page's own row formats it, so cooking mode and the page
 * cannot show different amounts.
 *
 * @pattern Presentation Model: the screen's data, with no component or hook inside it.
 * @pattern Visitor, satisfied by the `none` or `list` union, which a caller reads with an exhaustive switch.
 */
import { fillTemplate, pluralOf } from '@commise/i18n';
import { allLinesFoodRemoved } from '@commise/features-recipes/cook';
import type { RecipeIngredientView } from '@kitchensink/recipe-core';
import { makeRecipeScaling, scaleIngredients } from '@kitchensink/recipe-core/scaling';

import type { CookingMessages } from '../messages.js';

/** What the list is decided from. */
export interface CookingIngredientsViewInput {
    /** The recipe's ingredient lines, stored order, unscaled. */
    readonly ingredients: readonly RecipeIngredientView[];
    /** The servings the recipe was authored with. */
    readonly baseServings: number;
    /** The servings the cook chose. */
    readonly servings: number;
    /** The ids of the lines ticked, from the cook marks shared with the recipe page. */
    readonly ticked: ReadonlySet<string>;
    /** The copy the list says. */
    readonly copy: Pick<CookingMessages, 'ingredients' | 'step'>;
    /** The locale, for the plural. */
    readonly locale: string;
}

/** One row of the list: the scaled line and whether the cook has ticked it. */
interface CookingIngredientRow {
    readonly ingredient: RecipeIngredientView;
    readonly checked: boolean;
}

/** The list, or the fact that the recipe has none. */
export type CookingIngredientsView =
    | { readonly kind: 'none' }
    | {
          readonly kind: 'list';
          readonly title: string;
          readonly rows: readonly CookingIngredientRow[];
          /** Every line's food is gone, so the rows say so instead of naming amounts. */
          readonly allRemoved: boolean;
          readonly servings: number;
          readonly baseServings: number;
          /** Present only when the servings differ from the recipe's own. */
          readonly scaleNote: string | undefined;
      };

/**
 * Decide the ingredients list. Pure.
 *
 * @param input - The lines, the servings, the ticks and the copy.
 * @returns `none` when the recipe has no ingredient lines, otherwise the list.
 * @throws {RecipeScalingError} When the servings cannot be scaled to or a quantity is unrepresentable: a data defect.
 */
export function cookingIngredientsView(input: CookingIngredientsViewInput): CookingIngredientsView {
    const { ingredients, baseServings, servings, ticked, copy, locale } = input;

    if (ingredients.length === 0) {
        return { kind: 'none' };
    }

    const scaling = makeRecipeScaling(baseServings, servings);
    const title = fillTemplate(pluralOf(copy.ingredients.title, ingredients.length, locale), {
        servings: String(servings),
        count: String(ingredients.length),
    });

    return {
        kind: 'list',
        title,
        rows: scaleIngredients(ingredients, scaling).map((ingredient) => ({
            ingredient,
            checked: ticked.has(ingredient.ingredientId),
        })),
        allRemoved: allLinesFoodRemoved(ingredients),
        servings,
        baseServings,
        scaleNote: scaling.isScaled
            ? fillTemplate(copy.step.scaleNote, { base: String(baseServings), servings: String(servings) })
            : undefined,
    };
}
