/**
 * THE nutrient projection (KTD-3, plan U8) — the one place raw EAV nutrient rows become per-100g macros.
 *
 * ## Why this moved into the food service
 *
 * It used to live in the RECIPE service (`ingredients.service.ts:131`), which is what made "food owns
 * nutrition" untrue: food stored the rows, but the meaning — which row is *the* calorie figure — was decided
 * by a consumer. Two services could therefore disagree about the same food, and one of them did.
 *
 * ## The three ways the old selector was wrong, all of which produce a PLAUSIBLE number
 *
 * None of these fails loudly. Each yields a value a UI renders happily and a human has to notice.
 *
 * 1. **Substring matching on the name.** `name.includes('energy')` matches BOTH the `kcal` row and the `kJ`
 *    row, and USDA supplies both for the same food. Whichever sorted first won, so the same food could read
 *    239 or 1000 — a **4.184× error** presented as a calorie count.
 * 2. **Ignoring the basis.** `nutrientBasisEnum` is `['per_100g','per_serving']`, and branded foods keep
 *    label values as `per_serving` whenever the serving is a millilitre or a count. Selecting by name alone
 *    projects a per-serving figure into a per-100g field.
 * 3. **Ignoring the unit.** `includes('fat')` also matches `Fatty acids, total trans` (g) and, on some
 *    foods, unit-mismatched rows. The unit is part of the identity of the number, not decoration.
 *
 * **Selection is therefore `basis === 'per_100g'` AND canonical name AND unit — all three.** A nutrient
 * available only on a `per_serving` basis reports **absent**, never coerced: we do not know the serving's
 * gram weight at this layer, and inventing one is how the 4.184× class of bug gets re-created with extra
 * steps.
 *
 * @module
 */

import { LABEL_NUTRIENT_MAP, type LabelNutrientKey } from './labelNutrientMap.js';

/** The minimum shape this module needs from a stored nutrient row. */
export interface NutrientRow {
    /** Nutrient display name as stored (already canonicalized on ingest). */
    readonly nutrient: string;
    /** Amount at source fidelity. */
    readonly amount: number;
    /** Unit the amount is expressed in. */
    readonly unit: string;
    /** `per_100g` | `per_serving`. */
    readonly basis: string;
}

/** The per-100g macro projection returned for one food. Every field is absent-able. */
export interface NutritionProjection {
    /** Energy in kcal per 100 g, or `undefined` when no `per_100g` kcal row exists. */
    readonly caloriesPer100g?: number;
    /** Protein in grams per 100 g. */
    readonly proteinGPer100g?: number;
    /** Carbohydrate in grams per 100 g. */
    readonly carbsGPer100g?: number;
    /** Fat in grams per 100 g. */
    readonly fatGPer100g?: number;
}

/** The basis a per-100g projection may read from. Anything else is absent, never converted. */
const PER_100G = 'per_100g';

/**
 * Normalize a nutrient name for comparison: lower-cased and whitespace-collapsed. Pure.
 *
 * Deliberately NOT a fuzzy match. The whole defect class this module exists to remove came from treating
 * "close enough" as equal.
 *
 * @param name - The stored nutrient name.
 * @returns The comparison form.
 */
function normalizeName(name: string): string {
    return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Normalize a unit for comparison: lower-cased, with the micro sign folded to `µ`. Pure.
 *
 * `µg` (U+00B5 MICRO SIGN) and `μg` (U+03BC GREEK SMALL LETTER MU) are different code points that render
 * identically, and sources emit both. An exact-string unit comparison silently rejects half of them.
 *
 * @param unit - The stored unit.
 * @returns The comparison form.
 */
function normalizeUnit(unit: string): string {
    return unit.trim().toLowerCase().replace(/μ/g, 'µ');
}

/**
 * Select the amount for one label nutrient. Pure, total.
 *
 * Matches on **all three** of basis, canonical name and unit — see the module doc for what each one alone
 * lets through.
 *
 * @param rows - The food's stored nutrient rows.
 * @param key - Which label nutrient to select.
 * @returns The per-100g amount, or `undefined` when no row satisfies all three criteria.
 */
export function selectPer100g(rows: readonly NutrientRow[], key: LabelNutrientKey): number | undefined {
    const target = LABEL_NUTRIENT_MAP[key];
    const wantedName = normalizeName(target.name);
    const wantedUnit = normalizeUnit(target.unit);

    const hit = rows.find(
        (row) =>
            row.basis === PER_100G &&
            normalizeName(row.nutrient) === wantedName &&
            normalizeUnit(row.unit) === wantedUnit,
    );

    return hit?.amount;
}

/**
 * Project a food's nutrient rows into the per-100g macro set. Pure, total.
 *
 * @param rows - The food's stored nutrient rows.
 * @returns The projection; any macro with no qualifying row is absent.
 */
export function projectNutrition(rows: readonly NutrientRow[]): NutritionProjection {
    return {
        caloriesPer100g: selectPer100g(rows, 'calories'),
        proteinGPer100g: selectPer100g(rows, 'protein'),
        carbsGPer100g: selectPer100g(rows, 'carbohydrates'),
        fatGPer100g: selectPer100g(rows, 'fat'),
    };
}
