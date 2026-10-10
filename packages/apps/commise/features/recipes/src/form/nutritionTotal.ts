/**
 * @module @commise/features-recipes/form — the Ingredients section's running total as ONE view (build spec §7.5.6),
 * drawn at the section's foot at every width and at the section index's rail foot at `@wide`. Both read it from here,
 * so the two places cannot disagree on a figure or a word.
 *
 * Pure and platform-agnostic.
 *
 * @pattern Presentation Model — the total's state and words, derived from the draft and the editor's one nutrition read
 */
import type { Locale } from '@commise/i18n';

import { rangeDerivedNotice } from '../detail/model.js';
import { fillTemplate } from '../format/fillTemplate.js';
import type { RecipeFormMessages } from './messages.js';
import { nutritionCountOf, recipeNutritionTotal } from './nutrition.js';
import type { IngredientNutrition } from './nutritionLookup.js';
import type { RecipeFormValues } from './values.js';

/** The total as both places draw it. */
export type NutritionTotalView =
    /** Nothing has answered: skeleton text, never a partial figure. */
    | { readonly kind: 'loading' }
    /** The read failed: the failure and Try again, never a figure (a total from no lines reads as a fact). */
    | { readonly kind: 'failed' }
    | {
          readonly kind: 'ready';
          /** "612 cal per serving · 7 of 9 counted", or "Nutrition appears as you match ingredients." — never "0 cal". */
          readonly line: string;
          /** R38: the disclosure a total computed from one bound of a range owes. */
          readonly rangeNotice: string | undefined;
      };

/**
 * The running total's view. Pure.
 *
 * @param values - The draft.
 * @param nutrition - The editor's nutrition read.
 * @param locale - The active locale, for the figure.
 * @param m - The form's copy.
 * @returns The view.
 */
export const nutritionTotalViewOf = (
    values: RecipeFormValues,
    nutrition: Pick<IngredientNutrition, 'lookup' | 'read'>,
    locale: Locale,
    m: Pick<
        RecipeFormMessages,
        'nutritionEmpty' | 'nutritionCounted' | 'nutritionRangeDerivedLow' | 'nutritionRangeDerivedHigh'
    >,
): NutritionTotalView => {
    if (nutrition.read !== 'ready') {
        return { kind: nutrition.read };
    }

    const total = recipeNutritionTotal(values, nutrition.lookup);
    const count = nutritionCountOf(values, nutrition.lookup);

    return {
        kind: 'ready',
        line:
            count.counted === 0
                ? m.nutritionEmpty
                : fillTemplate(m.nutritionCounted, {
                      cal: new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(total.calories),
                      counted: count.counted,
                      total: count.total,
                  }),
        rangeNotice: rangeDerivedNotice(total, { low: m.nutritionRangeDerivedLow, high: m.nutritionRangeDerivedHigh }),
    };
};
