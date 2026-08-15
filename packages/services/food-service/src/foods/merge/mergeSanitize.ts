/**
 * Merge-boundary input validation/sanitization (T-164, FR-ADP-2/FR-ADP-3) — a defense-in-depth second
 * pass over the adapter's own validation. **Reject-not-store at the value grain**: a malformed nutrient
 * or portion value is dropped (never persisted) while the rest of the candidate survives; a candidate
 * with no usable name is dropped whole so the food still resolves from the remaining candidates.
 *
 * Sanitization is silent (it drops rather than throws) so one bad value cannot fail an otherwise-
 * resolvable food. The DB `CHECK`s (`amount >= 0`, `gram_weight > 0`) are the durable backstop; this
 * pass keeps a bad value from ever reaching them.
 *
 * @implements FR-ADP-2 FR-ADP-3
 */
import type { CanonicalCandidate, CanonicalNutrient, CanonicalPortion } from '../../sources/foodSourceAdapter.js';

/** A non-negative arbitrary-precision decimal (matches the DB `amount >= 0` numeric domain). */
const NON_NEGATIVE_DECIMAL = /^\d+(\.\d+)?$/;

/**
 * Whether a nutrient value is storable: a present name + unit and a parseable non-negative amount
 * (mirrors the `food_nutrients.amount >= 0` CHECK, DB-6). A `-7` or `abc` amount is rejected here so it
 * never reaches the database.
 */
function isStorableNutrient(nutrient: CanonicalNutrient): boolean {
    return (
        nutrient.name.trim() !== '' &&
        nutrient.unit.trim() !== '' &&
        NON_NEGATIVE_DECIMAL.test(nutrient.amount) &&
        (nutrient.basis === 'per_100g' || nutrient.basis === 'per_serving')
    );
}

/**
 * Whether a portion is storable: a present label and a strictly-positive parseable gram weight (mirrors
 * the `food_portions.gram_weight > 0` CHECK, DB-6).
 */
function isStorablePortion(portion: CanonicalPortion): boolean {
    return (
        portion.label.trim() !== '' && NON_NEGATIVE_DECIMAL.test(portion.gramWeight) && Number(portion.gramWeight) > 0
    );
}

/**
 * Sanitize candidates at the merge boundary, dropping malformed values and nameless candidates
 * (reject-not-store, FR-ADP-2/FR-ADP-3). Invalid nutrient/portion values are removed from an otherwise-
 * valid candidate; a candidate with no usable name is dropped whole so the food still resolves from the
 * remaining candidates.
 *
 * @param candidates - The raw canonical candidates from the fan-out.
 * @returns The cleaned candidates safe to merge + persist.
 */
export function sanitizeCandidates(candidates: readonly CanonicalCandidate[]): CanonicalCandidate[] {
    const clean: CanonicalCandidate[] = [];

    for (const candidate of candidates) {
        if (candidate.name.trim() === '') {
            continue;
        }

        clean.push({
            ...candidate,
            nutrients: candidate.nutrients.filter(isStorableNutrient),
            portions: candidate.portions.filter(isStorablePortion),
        });
    }

    return clean;
}
