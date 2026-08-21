/**
 * Measurement-unit normalization + gram conversion, shared by nutrition aggregation (recipes) and portion
 * extraction (ingredients). Pure — no I/O.
 *
 * A recipe line's `unit` and a food's portion label are free text ("cup", "cups", "Tbsp.", "tablespoon"),
 * so both are reduced to a small canonical vocabulary by {@link normalizeUnit} before any comparison. Grams
 * come from one of two places: an EXACT mass unit ({@link MASS_UNIT_TO_GRAMS}, ingredient-independent), or —
 * for a volumetric/count unit (cup/tbsp/clove) whose weight depends on the food — a matching household
 * portion the food service supplied (grams-per-unit).
 */
import type { IngredientPortion } from './recipe.types.js';

/** Canonical unit → grams for the units whose conversion is exact and ingredient-independent (mass). */
export const MASS_UNIT_TO_GRAMS: Readonly<Record<string, number>> = {
    g: 1,
    kg: 1000,
    mg: 0.001,
    oz: 28.3495,
    lb: 453.592,
};

/** Aliases → canonical unit. Everything else normalizes to its lower-cased, de-pluralized self. */
const UNIT_ALIASES: Readonly<Record<string, string>> = {
    gram: 'g',
    grams: 'g',
    g: 'g',
    kilogram: 'kg',
    kilograms: 'kg',
    kg: 'kg',
    milligram: 'mg',
    milligrams: 'mg',
    mg: 'mg',
    ounce: 'oz',
    ounces: 'oz',
    oz: 'oz',
    pound: 'lb',
    pounds: 'lb',
    lb: 'lb',
    lbs: 'lb',
    cup: 'cup',
    cups: 'cup',
    tablespoon: 'tablespoon',
    tablespoons: 'tablespoon',
    tbsp: 'tablespoon',
    tbs: 'tablespoon',
    tbl: 'tablespoon',
    teaspoon: 'teaspoon',
    teaspoons: 'teaspoon',
    tsp: 'teaspoon',
    // R31 — the `*ful` family. A 1900s cookbook writes `teaspoonful`, and the de-pluralization fallback
    // below cannot reach it (no trailing `s`), so it normalized to itself, matched no portion, and cost
    // the line its gram conversion. Exactly these three measures take the suffix; `handful`, `spoonful`
    // and `glassful` name no defined amount and are deliberately absent.
    teaspoonful: 'teaspoon',
    teaspoonfuls: 'teaspoon',
    tablespoonful: 'tablespoon',
    tablespoonfuls: 'tablespoon',
    cupful: 'cup',
    cupfuls: 'cup',
    clove: 'clove',
    cloves: 'clove',
    slice: 'slice',
    slices: 'slice',
    piece: 'piece',
    pieces: 'piece',
    stick: 'stick',
    sticks: 'stick',
    pinch: 'pinch',
    pinches: 'pinch',
};

/**
 * Reduce a raw unit string to its canonical form: lower-cased, trimmed, trailing `.` stripped, known
 * aliases mapped, and an unknown trailing `s` removed (so `carrots` → `carrot`). Pure.
 */
export function normalizeUnit(raw: string): string {
    const cleaned = raw.trim().toLowerCase().replace(/\.$/, '');
    const alias = UNIT_ALIASES[cleaned];

    if (alias !== undefined) {
        return alias;
    }

    // Best-effort de-pluralization for units not in the alias table (e.g. a food-specific "carrots").
    return cleaned.endsWith('s') && cleaned.length > 1 ? cleaned.slice(0, -1) : cleaned;
}

/**
 * Convert `quantity` of `unit` to grams — via an exact mass unit, else a matching household portion. Pure.
 *
 * @returns The gram weight, or `null` when the unit is neither a mass unit nor covered by a portion.
 */
export function unitToGrams(
    quantity: number,
    unit: string,
    portions: readonly IngredientPortion[] = [],
): number | null {
    const normalized = normalizeUnit(unit);

    const massFactor = MASS_UNIT_TO_GRAMS[normalized];

    if (massFactor !== undefined) {
        return quantity * massFactor;
    }

    const portion = portions.find((candidate) => normalizeUnit(candidate.unit) === normalized);

    if (portion !== undefined) {
        return quantity * portion.gramsPerUnit;
    }

    return null;
}
