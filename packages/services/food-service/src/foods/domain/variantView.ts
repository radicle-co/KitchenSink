/**
 * A live variant as the wire publishes it (curated catalog plan U8, R17, KTD-15): its id, its label's parts and its
 * own calories. A part's ordinal, the variant's item and every citation column stay behind (SC-013).
 *
 * DESIGN PATTERN: Pure projection — total over its input, unaware of the DAO and HTTP.
 *
 * @module
 */
import type { LiveVariant, VariantPartFact } from '../dao/foodVariant.dao.js';
import type { VariantPartView, VariantView } from '../foods.schema.js';
import { projectStoredNutrition } from '../nutrition/nutrientSelection.js';

/**
 * Project one live variant onto the wire. Pure.
 *
 * @param variant - The variant, read with its nutrition.
 * @returns The view; `caloriesPer100g` is absent when the variant's nutrition states no energy (R18).
 */
export function variantViewOf(variant: LiveVariant): VariantView {
    const calories = projectStoredNutrition(variant.nutrients).caloriesPer100g;

    return {
        id: variant.id,
        parts: variantPartViewsOf(variant.parts),
        ...(calories === undefined ? {} : { caloriesPer100g: calories }),
    };
}

/**
 * A label's parts as the wire publishes them: attribute and text, never the ordinal. Pure.
 *
 * @param parts - The parts, in contract order.
 * @returns The views, in the same order.
 */
export function variantPartViewsOf(parts: readonly VariantPartFact[]): VariantPartView[] {
    return parts.map((part) => ({ attribute: part.attribute, text: part.text }));
}
