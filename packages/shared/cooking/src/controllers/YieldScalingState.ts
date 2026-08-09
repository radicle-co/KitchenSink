import type { ScaleFactor } from '../types.js';

/**
 * MOD-020 — yield scaling state (FR-034a / REQ-014, REQ-015).
 *
 * SAFETY INVARIANT: this module has **no reference to timer state** and imports no timer module.
 * Cook time does not scale linearly with yield — doubling a batch does not double bake time — so
 * scaling adjusts ingredient quantities only and surfaces an advisory. See spec.md D-002. The
 * invariant is structural, not merely tested: `UTS-020-D2` asserts the import graph.
 *
 * @remarks RED GATE STUB — T-017's tests define the contract and currently fail against these
 * stubs. Implementation lands in T-016's green step.
 */

/**
 * Validates and returns a yield scale factor.
 *
 * @param factor - The requested factor.
 * @returns The factor, narrowed to {@link ScaleFactor}.
 * @throws {UnsupportedScaleFactorError} When `factor` is outside the supported set.
 */
export function setScaleFactor(factor: number): ScaleFactor {
    void factor;
    throw new Error('not implemented');
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
    void quantity;
    void factor;
    throw new Error('not implemented');
}

/**
 * Reports whether the "cook times are not scaled" advisory must be shown.
 *
 * @param factor - The active scale factor.
 * @returns `true` whenever the factor is not 1 (REQ-015).
 */
export function shouldShowNotScaledAdvisory(factor: ScaleFactor): boolean {
    void factor;
    throw new Error('not implemented');
}
