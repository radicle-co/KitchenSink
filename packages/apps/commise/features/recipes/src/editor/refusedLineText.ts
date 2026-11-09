/**
 * @module @commise/features-recipes/editor — a refused line as the refusal sheet lists it: the amount, then the cook's own
 * words (or the food's name), the way the editor row reads (private foods spec section 7.2). Pure.
 */
import type { RecipeFormIngredient } from '../form/values.js';

/**
 * @param line - A draft line.
 * @returns "2 tbsp My spice mix": the amount when it has one, its unit when it has one, then the words.
 */
export function refusedLineText(
    line: Pick<RecipeFormIngredient, 'quantity' | 'unit' | 'displayText' | 'name'>,
): string {
    const amount = Number.isFinite(line.quantity) ? String(line.quantity) : '';

    return [amount, line.unit ?? '', line.displayText ?? line.name ?? ''].filter((part) => part !== '').join(' ');
}
