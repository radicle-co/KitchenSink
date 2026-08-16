import { ALLOWED_SCALE_FACTORS } from '../types.js';
import type { ScaleFactor } from '../types.js';
import { InvalidQuantityError, UnsupportedScaleFactorError } from '../errors.js';

/**
 * Decimal places kept when scaling a quantity.
 *
 * This exists to erase IEEE-754 artifacts (`0.1 * 3` is `0.30000000000000004`), **not** to make a
 * display decision. Six places is deliberately generous: rounding to the 2 places a UI might show
 * would destroy legitimate small culinary quantities such as `0.125` tsp (an eighth). Formatting for
 * humans belongs to the render layer, which owns fraction display.
 */
const QUANTITY_PRECISION = 6;

/**
 * Rounds away floating-point representation error while preserving genuine precision.
 *
 * @param value - The raw product of a quantity and a scale factor.
 * @returns The value rounded to {@link QUANTITY_PRECISION} decimal places.
 */
function roundToDisplayPrecision(value: number): number {
    const factor = 10 ** QUANTITY_PRECISION;

    return Math.round(value * factor) / factor;
}

/**
 * MOD-020 — yield scaling state (FR-034a / REQ-014, REQ-015).
 *
 * SAFETY INVARIANT: this module has **no reference to timer state** and imports no timer module.
 * Cook time does not scale linearly with yield — doubling a batch does not double bake time — so
 * scaling adjusts ingredient quantities only and surfaces an advisory. See spec.md D-002. The
 * invariant is structural, not merely tested: `UTS-020-D2` asserts the import graph.
 */

/**
 * Validates and returns a yield scale factor.
 *
 * @param factor - The requested factor.
 * @returns The factor, narrowed to {@link ScaleFactor}.
 * @throws {UnsupportedScaleFactorError} When `factor` is outside the supported set.
 */
export function setScaleFactor(factor: number): ScaleFactor {
    // Membership in the bounded set, not a range check: it rejects NaN and Infinity for free and
    // makes an unsupported factor unrepresentable downstream.
    const allowed = ALLOWED_SCALE_FACTORS.find((candidate) => candidate === factor);

    if (allowed === undefined) {
        throw new UnsupportedScaleFactorError(factor);
    }

    return allowed;
}

/**
 * Scales one ingredient quantity for the active yield.
 *
 * @param quantity - The recipe's stored quantity.
 * @param factor - The active scale factor.
 * @returns The quantity to display.
 * @throws {InvalidQuantityError} When `quantity` is negative or not finite.
 */
export function scaleQuantity(quantity: number, factor: ScaleFactor): number {
    if (!Number.isFinite(quantity) || quantity < 0) {
        throw new InvalidQuantityError(quantity);
    }

    return roundToDisplayPrecision(quantity * factor);
}

/**
 * Reports whether the "cook times are not scaled" advisory must be shown.
 *
 * @param factor - The active scale factor.
 * @returns `true` whenever the factor is not 1 (REQ-015).
 */
export function shouldShowNotScaledAdvisory(factor: ScaleFactor): boolean {
    return factor !== 1;
}
