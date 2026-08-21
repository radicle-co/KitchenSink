/**
 * How much of an ingredient a recipe calls for — as a VALUE OBJECT rather than a nullable scalar.
 *
 * DESIGN PATTERN: Value Object + smart constructor, over a discriminated union whose exhaustive `switch`
 * is the Visitor a caller needs. There is no class and none is wanted: the union IS the type, and
 * {@link statedQuantity} is the only door into it.
 *
 * ## Why the union, and not `quantity` plus a loose `quantityHigh`
 *
 * A recipe line states one of exactly three things, and the pair-of-numbers shape can spell states that
 * are none of them: an upper bound below its lower, an upper bound with no lower, and — the one that
 * shipped — a `0` doing double duty as "the source stated no amount". Modelling the three cases as
 * members makes those unrepresentable rather than merely invalid, so no consumer has to re-check them.
 *
 * ⛔ `absent` is NEVER a zero and never a fabricated `1` (R40). A 1900s cookbook says "butter the size of
 * an egg", and the honest reading of that line is that it states no number — not that it states none of
 * something.
 */

/** A recipe line's stated amount: one value, two bounds, or nothing the source stated. */
export type IngredientQuantity =
    | { readonly kind: 'exact'; readonly value: number }
    | { readonly kind: 'range'; readonly low: number; readonly high: number }
    | { readonly kind: 'absent' };

/** The one representation of "the source stated no amount" (R40, R41). */
export const ABSENT_QUANTITY: IngredientQuantity = Object.freeze({ kind: 'absent' });

/** An amount is a positive, finite number of something; `0`, `-1` and `NaN` are not amounts. */
function isAmount(value: number): boolean {
    return Number.isFinite(value) && value > 0;
}

/**
 * Build the quantity a source line states.
 *
 * @param low - The stated amount, or the lower bound of a stated range.
 * @param high - The upper bound, when the line stated a range (`"2 to 3 cups"`).
 * @returns The value object, or `null` when the bounds describe no amount the source could have stated —
 *   a non-positive or non-finite bound, or an upper bound below its lower. `null` is a PARSE FAILURE the
 *   caller must report, deliberately not a fourth member: "these two numbers disagree" is a fact about
 *   the reading, not a state a recipe can be in. Pure.
 */
export function statedQuantity(low: number, high?: number | null): IngredientQuantity | null {
    if (!isAmount(low)) {
        return null;
    }

    if (high === undefined || high === null) {
        return Object.freeze({ kind: 'exact', value: low });
    }

    if (!isAmount(high) || high < low) {
        return null;
    }

    // A range whose bounds coincide is one value, and one value has ONE representation.
    return high === low ? Object.freeze({ kind: 'exact', value: low }) : Object.freeze({ kind: 'range', low, high });
}

/**
 * The smallest amount the line admits.
 *
 * @param quantity - The stated quantity.
 * @returns The lower bound, or `null` when the source stated no amount. An exact quantity reports itself,
 *   because `"2 cups"` is the range 2 to 2. Pure.
 */
export function quantityLowerBound(quantity: IngredientQuantity): number | null {
    switch (quantity.kind) {
        case 'exact':
            return quantity.value;
        case 'range':
            return quantity.low;
        case 'absent':
            return null;
    }
}

/**
 * The largest amount the line admits.
 *
 * @param quantity - The stated quantity.
 * @returns The upper bound, or `null` when the source stated no amount. Pure.
 */
export function quantityUpperBound(quantity: IngredientQuantity): number | null {
    switch (quantity.kind) {
        case 'exact':
            return quantity.value;
        case 'range':
            return quantity.high;
        case 'absent':
            return null;
    }
}
