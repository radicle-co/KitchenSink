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
 * ## One read rule per macronutrient (curated catalog plan KTD-21, KTD-23)
 *
 * - **Calories** are the first definition in {@link ENERGY_READ_ORDER} that states a per-100g number: Energy
 *   (1008), else Atwater Specific (2048), else Atwater General (2047). An energy trace states no number, so the
 *   next definition answers.
 * - **Carbohydrate** is `totalCarbohydrate`, read by INFOODS tag, where a trace counts as 0.
 * - **Protein and fat** are their own definition's number. A trace is absent, never 0.
 *
 * @pattern Policy — the one place stored nutrient rows become the per-100g macros; carbohydrate delegates to
 *   `totalCarbohydrate`, which is already the policy for that macro
 * @module
 */

import type { StoredNutrientAmount } from '../dao/food.dao.js';
import { LABEL_NUTRIENT_MAP, type LabelNutrientKey } from './labelNutrientMap.js';
import {
    ENERGY_READ_ORDER,
    INFOODS,
    NUTRIENT_DEFINITIONS,
    totalCarbohydrate,
    type InfoodsTag,
} from './nutrientIdentity.js';

/** The minimum shape this module needs from a stored nutrient row. */
export interface NutrientRow {
    /** Nutrient display name as stored (already canonicalized on ingest). */
    readonly nutrient: string;
    /** The dictionary entry's INFOODS tag, or `null` where INFOODS defines none (KTD-23). */
    readonly infoodsTag: string | null;
    /** Amount at source fidelity, or `undefined` for a trace mark, which states no number (R53). */
    readonly amount: number | undefined;
    /** Whether the source printed a trace or below-limit mark in place of a number. */
    readonly trace: boolean;
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

    return selectByNameAndUnit(rows, target.name, target.unit);
}

/**
 * The per-100g number of the first row with this name and unit. A trace states no number, so it never answers.
 * Pure.
 *
 * @param rows - The food's stored nutrient rows.
 * @param name - The dictionary name.
 * @param unit - The dictionary unit.
 * @returns The amount, or `undefined`.
 */
function selectByNameAndUnit(rows: readonly NutrientRow[], name: string, unit: string): number | undefined {
    const wantedName = normalizeName(name);
    const wantedUnit = normalizeUnit(unit);

    return rows.find(
        (row) =>
            row.basis === PER_100G &&
            row.amount !== undefined &&
            normalizeName(row.nutrient) === wantedName &&
            normalizeUnit(row.unit) === wantedUnit,
    )?.amount;
}

/**
 * A food's calories per 100 g (KTD-21): the first energy definition in {@link ENERGY_READ_ORDER} that states a
 * number. The two Atwater definitions carry no INFOODS tag, so each is matched by its dictionary name and unit.
 * Pure.
 *
 * @param rows - The food's stored nutrient rows.
 * @returns The calories, or `undefined` when no energy definition states a per-100g number.
 */
function selectCalories(rows: readonly NutrientRow[]): number | undefined {
    for (const key of ENERGY_READ_ORDER) {
        const amount = selectByNameAndUnit(rows, NUTRIENT_DEFINITIONS[key].name, NUTRIENT_DEFINITIONS[key].unit);

        if (amount !== undefined) {
            return amount;
        }
    }

    return undefined;
}

const STORED_TAGS: ReadonlySet<string> = new Set(Object.values(INFOODS));

/**
 * Whether a stored tag is one the catalog defines. Pure.
 *
 * @param tag - The dictionary entry's tag.
 * @returns `true` for a tag in {@link INFOODS}.
 */
function isInfoodsTag(tag: string | null): tag is InfoodsTag {
    return tag !== null && STORED_TAGS.has(tag);
}

/**
 * A food's carbohydrate per 100 g (KTD-23), read by tag from its per-100g rows. Pure.
 *
 * @param rows - The food's stored nutrient rows.
 * @returns `totalCarbohydrate` over the stated values and the trace marks.
 */
function selectCarbohydrate(rows: readonly NutrientRow[]): number | undefined {
    const values: Partial<Record<InfoodsTag, number>> = {};
    const traces = new Set<InfoodsTag>();

    for (const row of rows) {
        if (row.basis !== PER_100G || !isInfoodsTag(row.infoodsTag)) {
            continue;
        }

        if (row.amount !== undefined) {
            values[row.infoodsTag] = row.amount;
        } else if (row.trace) {
            traces.add(row.infoodsTag);
        }
    }

    return totalCarbohydrate(values, traces);
}

/**
 * Project a food's nutrient rows into the per-100g macro set. Pure, total.
 *
 * @param rows - The food's stored nutrient rows.
 * @returns The projection; any macro with no qualifying row is absent.
 */
export function projectNutrition(rows: readonly NutrientRow[]): NutritionProjection {
    return {
        caloriesPer100g: selectCalories(rows),
        proteinGPer100g: selectPer100g(rows, 'protein'),
        carbsGPer100g: selectCarbohydrate(rows),
        fatGPer100g: selectPer100g(rows, 'fat'),
    };
}

/**
 * Project stored rows, converting each driver string once. Pure, total.
 *
 * This is the one seam from `numeric` strings to numbers. A NULL amount stays `undefined`: `Number(null)` is 0,
 * which would publish a trace as a measured zero.
 *
 * @param rows - The food's rows as `food_nutrient_view` returns them.
 * @returns The projection.
 */
export function projectStoredNutrition(rows: readonly StoredNutrientAmount[]): NutritionProjection {
    return projectNutrition(
        rows.map((row) => ({
            nutrient: row.nutrient,
            infoodsTag: row.infoodsTag,
            amount: row.amount === null ? undefined : Number(row.amount),
            trace: row.trace,
            unit: row.unit,
            basis: row.basis,
        })),
    );
}
