/**
 * The closed vocabulary of variant-part attributes (plan KTD-7, naming rule 24).
 *
 * @pattern Enumeration — a closed vocabulary whose DECLARATION ORDER is the contract order
 *
 * The order is not cosmetic. A variant's parts must follow it (the seed format refuses parts out of order),
 * the `food_variant_attribute` pg enum declares the same order (U4's parity test reads this tuple), and a new
 * attribute is added `BEFORE 'origin'`, so origin stays last.
 *
 * ⛔ This module knows nothing about the wire. The food contract carries `attribute` as an OPEN string
 * (KTD-15), so an older reader never breaks on a new attribute. That is why the closed enum lives here and not
 * in a `*.schema.ts` file, which `contract-gen` sweeps into the published contract.
 */
import { z } from 'zod';

/** Every variant attribute, in contract order (naming rule 24, owner ruling 2026-09-30). */
export const VARIANT_ATTRIBUTES = [
    'cut',
    'bone',
    'skin',
    'formOrVariety',
    'babyFoodStage',
    'pack',
    'fat',
    'trim',
    'grade',
    'cookingMethod',
    'salt',
    'sugar',
    'addedNutrients',
    'brand',
    'origin',
] as const;

/** One variant attribute. */
export type VariantAttribute = (typeof VARIANT_ATTRIBUTES)[number];

/** Parses a variant attribute; anything outside the closed set is refused. */
export const variantAttributeSchema = z.enum(VARIANT_ATTRIBUTES);

const RANK: ReadonlyMap<VariantAttribute, number> = new Map(
    VARIANT_ATTRIBUTES.map((attribute, index) => [attribute, index] as const),
);

/**
 * An attribute's position in the contract order. Pure.
 *
 * @param attribute - A variant attribute.
 * @returns Its zero-based rank; parts must be non-decreasing in it.
 */
export function attributeRank(attribute: VariantAttribute): number {
    const rank = RANK.get(attribute);

    if (rank === undefined) {
        throw new Error(`'${attribute}' is not a variant attribute.`);
    }

    return rank;
}
