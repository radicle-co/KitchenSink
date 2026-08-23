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
    // the line its gram conversion.
    teaspoonful: 'teaspoon',
    teaspoonfuls: 'teaspoon',
    tablespoonful: 'tablespoon',
    tablespoonfuls: 'tablespoon',
    cupful: 'cup',
    cupfuls: 'cup',
    // R32 — the HISTORICAL volume units, added by U7 alongside the `*ful` family above.
    //
    // ⚠️ This REDRAWS the boundary the R31 comment drew rather than erasing it. That comment excluded
    // `wineglassful` with the rest of the `*ful` words on the grounds that it "names no defined amount".
    // It does: Project Gutenberg #12350's own TABLE OF WEIGHTS AND MEASURES prints `4 tablespoons = 1
    // wine-glass`, and the named external standard covers the rest. `handful`, `spoonful` and `glassful`
    // remain absent, because those genuinely name no amount and supplying one would invent a quantity the
    // source never stated (R40).
    //
    // ⛔ Canonicalising the SPELLING is all that happens here. A historical unit has no
    // ingredient-independent gram weight and `unitToGrams` deliberately returns `null` for one; the
    // equivalence that gives it a value is PER SOURCE BOOK and lives in `@kitchensink/cookbook-import`'s
    // `unitEquivalence.ts`, because two books can print two different values for the same word (an
    // imperial gill is 142 mL against the US customary 118 mL). What this table buys is that the word is
    // spelled ONE way by the time that lookup happens.
    gill: 'gill',
    gills: 'gill',
    wineglass: 'wineglass',
    wineglasses: 'wineglass',
    wineglassful: 'wineglass',
    wineglassfuls: 'wineglass',
    'wine-glass': 'wineglass',
    'wine-glasses': 'wineglass',
    'wine-glassful': 'wineglass',
    'wine-glassfuls': 'wineglass',
    saltspoon: 'saltspoon',
    saltspoons: 'saltspoon',
    saltspoonful: 'saltspoon',
    saltspoonfuls: 'saltspoon',
    dessertspoon: 'dessertspoon',
    dessertspoons: 'dessertspoon',
    dessertspoonful: 'dessertspoon',
    dessertspoonfuls: 'dessertspoon',
    'dessert-spoon': 'dessertspoon',
    'dessert-spoons': 'dessertspoon',
    'dessert spoon': 'dessertspoon',
    'dessert spoons': 'dessertspoon',
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
