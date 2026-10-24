/**
 * The label-nutrient map's macro entries are the nutrient definitions' dictionary entries (curated catalog plan
 * KTD-23): `Energy`/`kcal` and the other four macros are written once, in `nutrientIdentity.ts`.
 *
 * Every entry is spelled as the USDA adapter canonicalizes a nutrient (`canonicalizeNutrientName`,
 * `canonicalizeUnit`), so a label value and a USDA value for one nutrient are one `(name, unit)` (the
 * `CatalogSnapshot` port's one-spelling promise).
 */
import { describe, expect, it } from 'vitest';

import { canonicalizeNutrientName, canonicalizeUnit } from '../../../sources/usda/usda.adapter.js';
import { LABEL_NUTRIENT_MAP } from '../labelNutrientMap.js';
import { NUTRIENT_DEFINITIONS, type NutrientDefinitionKey } from '../nutrientIdentity.js';

/** A definition's dictionary entry, as the label map holds it. */
function entryOf(key: NutrientDefinitionKey): { name: string; unit: string } {
    return { name: NUTRIENT_DEFINITIONS[key].name, unit: NUTRIENT_DEFINITIONS[key].unit };
}

describe('LABEL_NUTRIENT_MAP', () => {
    it.each([
        ['calories', 'energyKcal'],
        ['protein', 'protein'],
        ['fat', 'fat'],
        ['carbohydrates', 'carbohydrateByDifference'],
        ['fiber', 'fibre'],
    ] as const)('holds %s as the %s definition’s dictionary entry', (label, definition) => {
        expect(LABEL_NUTRIENT_MAP[label]).toStrictEqual(entryOf(definition));
    });

    it('spells every entry as the adapter canonicalizes it', () => {
        const spelled = Object.entries(LABEL_NUTRIENT_MAP).filter(
            ([, entry]) =>
                entry.name !== canonicalizeNutrientName(entry.name) || entry.unit !== canonicalizeUnit(entry.unit),
        );

        expect(spelled.map(([key]) => key)).toEqual([]);
    });

    /** Rewritten for the canonical spelling: the six non-macro names that carried an element symbol or NLEA. */
    it('holds its other entries in canonical spelling', () => {
        const macros = new Set(['calories', 'protein', 'fat', 'carbohydrates', 'fiber']);
        const others = Object.fromEntries(Object.entries(LABEL_NUTRIENT_MAP).filter(([key]) => !macros.has(key)));

        expect(others).toStrictEqual({
            saturatedFat: { name: 'Fatty acids, total saturated', unit: 'g' },
            transFat: { name: 'Fatty acids, total trans', unit: 'g' },
            cholesterol: { name: 'Cholesterol', unit: 'mg' },
            sodium: { name: 'Sodium, na', unit: 'mg' },
            sugars: { name: 'Sugars, total including nlea', unit: 'g' },
            addedSugar: { name: 'Sugars, added', unit: 'g' },
            calcium: { name: 'Calcium, ca', unit: 'mg' },
            iron: { name: 'Iron, fe', unit: 'mg' },
            potassium: { name: 'Potassium, k', unit: 'mg' },
            vitaminD: { name: 'Vitamin d (d2 + d3)', unit: 'µg' },
        });
    });
});
