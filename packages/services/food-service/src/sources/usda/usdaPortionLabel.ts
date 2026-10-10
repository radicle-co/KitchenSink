/**
 * The label one USDA portion row is stored under, shared by the bulk reader and the live adapter so the two
 * agree byte for byte.
 *
 * USDA publishes a portion as separate fields, in three shapes (read from the pinned files on 2026-10-01). SR
 * Legacy states the amount in `amount` and the measure in `modifier` (`4`, `oz`). Foundation states the measure in
 * `measure_unit` and qualifies it in `modifier` (`1.0`, `egg`, `white`). FNDDS states the whole measure in
 * `portion_description` (`1 cup, shredded`), leaves `amount` empty and puts a numeric portion code in `modifier`.
 *
 * The label joins those fields in that order. It must carry the amount, because `food_portions` stores the pair
 * `{ label, gramWeight }` and the gram weight is for the whole amount: the SR row USDA published as 4 oz at 113 g
 * reads as one ounce weighing 113 g without it. Joining USDA's own fields renders what USDA published. It is not
 * an interpretation, which stays the portion normalizer's alone (KTD-3).
 *
 * DESIGN PATTERN: a pure Adapter step, shared by both USDA readers.
 *
 * @module
 */

/** The `measure_unit` name FDC uses for "no household measure". */
const UNDETERMINED_MEASURE_UNIT = 'undetermined';

/** A `portion_description` that states its own amount, as an FNDDS one does. */
const STATES_AN_AMOUNT = /^\d/;

/** A `modifier` that is an FNDDS portion code, never text. */
const PORTION_CODE = /^\d+$/;

/** One USDA portion row, as both readers see it. */
export interface UsdaPortionFields {
    /** USDA's `amount`, or `null` when the row states none (FNDDS). */
    readonly amount: number | null;
    /** The `measure_unit` name, `undetermined` included, or empty when the row's unit is not in the table. */
    readonly measureUnit: string;
    /** USDA's `portion_description`. */
    readonly portionDescription: string;
    /** USDA's `modifier`. */
    readonly modifier: string;
}

/**
 * The label a USDA portion row is stored under. Pure.
 *
 * @param fields - The row.
 * @returns The label, or `null` when the row states no measure a portion can carry: no positive amount, or no
 *   word to measure in.
 */
export function usdaPortionLabel(fields: UsdaPortionFields): string | null {
    const portionDescription = fields.portionDescription.trim();

    if (STATES_AN_AMOUNT.test(portionDescription)) {
        return portionDescription;
    }

    const { amount } = fields;

    if (amount === null || !Number.isFinite(amount) || amount <= 0) {
        return null;
    }

    const measureUnit = fields.measureUnit.trim();
    const modifier = fields.modifier.trim();
    const words = [
        measureUnit.toLowerCase() === UNDETERMINED_MEASURE_UNIT ? '' : measureUnit,
        portionDescription,
        PORTION_CODE.test(modifier) ? '' : modifier,
    ].filter((word) => word !== '');

    return words.length === 0 ? null : `${String(amount)} ${words.join(' ')}`;
}
