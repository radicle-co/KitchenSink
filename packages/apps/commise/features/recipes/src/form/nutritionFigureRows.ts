/**
 * @module @commise/features-recipes/form — the ONE formatting of a nutrition panel's figures, shared by the web and
 * native panel bodies so the two cannot show a figure differently. Pure.
 */
import type { Locale } from '@commise/i18n';

import { fillTemplate } from '../format/fillTemplate.js';
import type { RecipeFormMessages } from './messages.js';
import type { LineFigures } from './nutrition.js';

/** One labelled figure. */
export interface NutritionFigureRow {
    readonly label: string;
    readonly value: string;
}

/** An unpublished figure: punctuation, not copy, explained once by `nutritionFieldUnpublished`. */
const UNPUBLISHED = '—';

/**
 * The panel's figure rows, in a fixed order. Pure.
 *
 * @param figures - The figures to show.
 * @param messages - The form copy for the active locale.
 * @param locale - The active locale, for number formatting.
 * @param dashMissing - Show an em dash for a missing figure (food's figures) or leave it out (the cook's own).
 * @returns The rows.
 */
export const nutritionFigureRows = (
    figures: LineFigures,
    messages: RecipeFormMessages,
    locale: Locale,
    dashMissing: boolean,
): NutritionFigureRow[] => {
    const grams = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
    const calories = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
    const asGrams = (value: number): string =>
        fillTemplate(messages.nutritionGramsTemplate, { value: grams.format(value) });
    const rows: readonly (readonly [string, number | undefined, (value: number) => string])[] = [
        [messages.nutritionCaloriesLabel, figures.calories, (value) => calories.format(value)],
        [messages.nutritionProteinLabel, figures.proteinG, asGrams],
        [messages.nutritionCarbsLabel, figures.carbsG, asGrams],
        [messages.nutritionFatLabel, figures.fatG, asGrams],
    ];

    return rows.flatMap(([label, value, format]) => {
        if (value === undefined) {
            return dashMissing ? [{ label, value: UNPUBLISHED }] : [];
        }

        return [{ label, value: format(value) }];
    });
};
