/**
 * @module @commise/features-recipes/editor — a refused line as the refusal sheet lists it: the amount as the editor row
 * shows it (`formatQuantity`), then the cook's own words (or the food's name) (private foods spec section 7.2). The sheet
 * draws the two parts as the row's own text run (`AmountRun`), so a refused line looks exactly like its row. Pure.
 */
import type { IngredientQuantity } from '@kitchensink/recipe-core';

import { formatQuantity } from '../detail/model.js';

/** The two parts of a refused line. */
export interface RefusedLineParts {
    /** The amount with its unit, as the row shows it; `''` when the line states none. */
    readonly amount: string;
    /** The cook's words, else the food's name. */
    readonly words: string;
}

/**
 * @param line - A line of the recipe, in the shape the row reads.
 * @param locale - The active locale.
 * @returns "2 tbsp" and "My spice mix": the amount when it has one, then the words.
 */
export function refusedLineParts(
    line: {
        readonly quantity: IngredientQuantity;
        readonly unit?: string | undefined;
        readonly displayText?: string | undefined;
        readonly name?: string | undefined;
    },
    locale: string,
): RefusedLineParts {
    return {
        amount: formatQuantity(line.quantity, locale, line.unit),
        words: line.displayText ?? line.name ?? '',
    };
}

/**
 * @param parts - A refused line's parts.
 * @returns One plain string for a control's accessible name: the no-break space inside the amount reads as a space.
 */
export function refusedLineLabel({ amount, words }: RefusedLineParts): string {
    return [amount, words]
        .filter((part) => part !== '')
        .join(' ')
        .replaceAll(' ', ' ');
}
