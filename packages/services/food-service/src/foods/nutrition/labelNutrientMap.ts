/**
 * THE canonical label-nutrient identities (KTD-3, plan U8) — name **and** unit, in one place.
 *
 * This was module-private inside `usda.adapter.ts`, which is why the recipe service could not use it and
 * hand-rolled substring matching instead. Extracting it is what lets the ingest path and the projection
 * agree on what "calories" means, rather than agreeing by coincidence.
 *
 * ⚠️ **The unit is part of the identity, not documentation.** USDA supplies energy twice for the same food —
 * once in `kcal` and once in `kJ` — under the same nutrient name. A selector that matches the name alone
 * picks whichever sorted first, so the same food reads 239 or 1000: a **4.184× error** rendered as a calorie
 * count, with nothing to make it look wrong.
 *
 * The five macro entries are the nutrient definitions' dictionary entries (curated catalog plan KTD-23), so
 * `Energy`/`kcal` is written once, in `nutrientIdentity.ts`. Every name and unit is in the adapter's canonical form
 * (`canonicalizeNutrientName`, `canonicalizeUnit`), so a label value and a USDA value for one nutrient share one
 * `(name, unit)`; the test holds every entry to it.
 *
 * @module
 */
import { NUTRIENT_DEFINITIONS, type NutrientDefinitionKey } from './nutrientIdentity.js';

/** A label-panel nutrient this system projects. */
export type LabelNutrientKey =
    | 'fat'
    | 'saturatedFat'
    | 'transFat'
    | 'cholesterol'
    | 'sodium'
    | 'carbohydrates'
    | 'fiber'
    | 'sugars'
    | 'addedSugar'
    | 'protein'
    | 'calcium'
    | 'iron'
    | 'potassium'
    | 'calories'
    | 'vitaminD';

/**
 * A definition's dictionary entry, without its tag. Pure.
 *
 * @param key - The definition.
 * @returns Its `{ name, unit }`.
 */
function dictionaryEntry(key: NutrientDefinitionKey): { readonly name: string; readonly unit: string } {
    return { name: NUTRIENT_DEFINITIONS[key].name, unit: NUTRIENT_DEFINITIONS[key].unit };
}

/** The canonical stored `{ name, unit }` for each label nutrient. */
export const LABEL_NUTRIENT_MAP: Readonly<Record<LabelNutrientKey, { readonly name: string; readonly unit: string }>> =
    {
        fat: dictionaryEntry('fat'),
        saturatedFat: { name: 'Fatty acids, total saturated', unit: 'g' },
        transFat: { name: 'Fatty acids, total trans', unit: 'g' },
        cholesterol: { name: 'Cholesterol', unit: 'mg' },
        sodium: { name: 'Sodium, na', unit: 'mg' },
        carbohydrates: dictionaryEntry('carbohydrateByDifference'),
        fiber: dictionaryEntry('fibre'),
        sugars: { name: 'Sugars, total including nlea', unit: 'g' },
        addedSugar: { name: 'Sugars, added', unit: 'g' },
        protein: dictionaryEntry('protein'),
        calcium: { name: 'Calcium, ca', unit: 'mg' },
        iron: { name: 'Iron, fe', unit: 'mg' },
        potassium: { name: 'Potassium, k', unit: 'mg' },
        // ⛔ `kcal`, explicitly. The `kJ` row carries the SAME name and a value 4.184× larger.
        calories: dictionaryEntry('energyKcal'),
        vitaminD: { name: 'Vitamin d (d2 + d3)', unit: 'µg' },
    };

/** Every registered label-nutrient key, for exhaustive iteration and runtime narrowing. */
export const LABEL_NUTRIENT_KEYS = Object.keys(LABEL_NUTRIENT_MAP) as readonly LabelNutrientKey[];

/**
 * Look up a label nutrient by an UNTRUSTED key. Pure, total.
 *
 * Exists because the map is keyed by a union rather than `string`: a source's response can carry any label
 * key at all, and indexing the map with it directly is the implicit-`any` hole that made the pre-extraction
 * `Record<string, …>` type unable to catch a typo'd key. Returning `undefined` keeps the caller's existing
 * "unmapped key → skip" branch honest.
 *
 * @param key - A label key from an external source.
 * @returns The canonical `{ name, unit }`, or `undefined` when the key is not one we project.
 */
export function lookupLabelNutrient(key: string): { readonly name: string; readonly unit: string } | undefined {
    return Object.hasOwn(LABEL_NUTRIENT_MAP, key) ? LABEL_NUTRIENT_MAP[key as LabelNutrientKey] : undefined;
}
