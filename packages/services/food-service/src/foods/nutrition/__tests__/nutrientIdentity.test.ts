/**
 * Nutrient identity by definition (plan R53, KTD-23): a value is stored under the INFOODS tag of its own
 * definition, and total carbohydrate has one read rule (owner, 2026-09-30).
 *
 * USDA's carbohydrate is by difference, so it already includes fibre. CIQUAL's, CoFID's and BLS's are available
 * carbohydrate, which excludes fibre. Storing both under one name is an error no reader can detect.
 */
import { describe, expect, it } from 'vitest';

import { canonicalizeNutrientName, canonicalizeUnit } from '../../../sources/usda/usda.adapter.js';
import {
    INFOODS,
    NUTRIENT_DEFINITIONS,
    USDA_NUTRIENT_ID_DEFINITIONS,
    totalCarbohydrate,
    type InfoodsTag,
} from '../nutrientIdentity.js';

describe('NUTRIENT_DEFINITIONS — each stored definition, its tag and its dictionary entry (KTD-23)', () => {
    it('holds exactly the ten definitions the catalog stores', () => {
        expect(NUTRIENT_DEFINITIONS).toStrictEqual({
            energyKcal: { tag: 'ENERC_KCAL', name: 'Energy', unit: 'kcal' },
            energyKj: { tag: 'ENERC_KJ', name: 'Energy', unit: 'kj' },
            protein: { tag: 'PROCNT', name: 'Protein', unit: 'g' },
            fat: { tag: 'FAT', name: 'Total lipid (fat)', unit: 'g' },
            carbohydrateByDifference: { tag: 'CHOCDF', name: 'Carbohydrate, by difference', unit: 'g' },
            carbohydrateAvailable: { tag: 'CHOAVL', name: 'Carbohydrate, available', unit: 'g' },
            carbohydrateAvailableMonosaccharides: {
                tag: 'CHOAVLM',
                name: 'Carbohydrate, available (monosaccharide equivalents)',
                unit: 'g',
            },
            fibre: { tag: 'FIBTG', name: 'Fiber, total dietary', unit: 'g' },
            energyKcalAtwaterSpecific: { tag: null, name: 'Energy (atwater specific factors)', unit: 'kcal' },
            energyKcalAtwaterGeneral: { tag: null, name: 'Energy (atwater general factors)', unit: 'kcal' },
        });
    });

    it('writes every name and unit in the form the dictionary folds to, so no duplicate dictionary row appears', () => {
        for (const [key, definition] of Object.entries(NUTRIENT_DEFINITIONS)) {
            expect(canonicalizeNutrientName(definition.name), `${key} name`).toBe(definition.name);
            expect(canonicalizeUnit(definition.unit), `${key} unit`).toBe(definition.unit);
        }
    });

    it('gives every definition its own dictionary entry and every tag to one definition', () => {
        const definitions = Object.values(NUTRIENT_DEFINITIONS);
        const entries = new Set(definitions.map((definition) => `${definition.name}\u0000${definition.unit}`));
        const tags = definitions.flatMap((definition) => (definition.tag === null ? [] : [definition.tag]));

        expect(entries.size).toBe(definitions.length);
        expect(new Set(tags).size).toBe(tags.length);
    });
});

describe('USDA_NUTRIENT_ID_DEFINITIONS — the FDC nutrient ids the catalog reads (KTD-23)', () => {
    it('maps each of the eight ids to its definition, the two Atwater energies to definitions of their own', () => {
        expect(USDA_NUTRIENT_ID_DEFINITIONS).toStrictEqual(
            new Map([
                [1008, 'energyKcal'],
                [1062, 'energyKj'],
                [1003, 'protein'],
                [1004, 'fat'],
                [1005, 'carbohydrateByDifference'],
                [1079, 'fibre'],
                [2048, 'energyKcalAtwaterSpecific'],
                [2047, 'energyKcalAtwaterGeneral'],
            ]),
        );
    });

    it('answers nothing for a nutrient_nbr, which FNDDS files under the same column name', () => {
        // 208 is energy's `nutrient_nbr`; the map is keyed by `nutrient.csv`'s `id`.
        expect(USDA_NUTRIENT_ID_DEFINITIONS.get(208)).toBeUndefined();
    });
});

describe('INFOODS', () => {
    it('is the tagged part of NUTRIENT_DEFINITIONS: one tag per tagged definition, and none invented', () => {
        expect(INFOODS).toStrictEqual(
            Object.fromEntries(
                Object.entries(NUTRIENT_DEFINITIONS).flatMap(([key, definition]) =>
                    definition.tag === null ? [] : [[key, definition.tag]],
                ),
            ),
        );
    });

    it('keeps InfoodsTag the union of the eight stored tags', () => {
        type Stored = 'ENERC_KCAL' | 'ENERC_KJ' | 'PROCNT' | 'FAT' | 'CHOCDF' | 'CHOAVL' | 'CHOAVLM' | 'FIBTG';
        // Fails to compile if the derivation widens the tags to `string` or drops one.
        const same: [InfoodsTag] extends [Stored] ? ([Stored] extends [InfoodsTag] ? true : false) : false = true;

        expect(same).toBe(true);
    });

    it('keeps by-difference, available, and available-as-monosaccharides carbohydrate as three definitions', () => {
        expect(INFOODS.carbohydrateByDifference).toBe('CHOCDF');
        expect(INFOODS.carbohydrateAvailable).toBe('CHOAVL');
        expect(INFOODS.carbohydrateAvailableMonosaccharides).toBe('CHOAVLM');
        expect(INFOODS.fibre).toBe('FIBTG');
        expect(INFOODS.energyKj).toBe('ENERC_KJ');
    });
});

describe('totalCarbohydrate', () => {
    it('reads the by-difference value when the source gives one, whatever else it gives', () => {
        expect(totalCarbohydrate({ CHOCDF: 20, CHOAVL: 15, FIBTG: 3 })).toBe(20);
        expect(totalCarbohydrate({ CHOCDF: 0 })).toBe(0);
    });

    it('adds fibre to available carbohydrate when the source gives both', () => {
        expect(totalCarbohydrate({ CHOAVL: 10, FIBTG: 2.5 })).toBe(12.5);
        expect(totalCarbohydrate({ CHOAVL: 0.1, FIBTG: 0.2 })).toBe(0.3);
    });

    it("reads CoFID's monosaccharide-equivalent carbohydrate plus fibre when no other carbohydrate is given", () => {
        expect(totalCarbohydrate({ CHOAVLM: 10, FIBTG: 2 })).toBe(12);
        expect(totalCarbohydrate({ CHOAVL: 9, CHOAVLM: 10, FIBTG: 2 })).toBe(11);
        expect(totalCarbohydrate({ CHOAVLM: 10 })).toBeUndefined();
    });

    it('is absent with available carbohydrate alone, fibre alone, or nothing', () => {
        expect(totalCarbohydrate({ CHOAVL: 10 })).toBeUndefined();
        expect(totalCarbohydrate({ FIBTG: 2 })).toBeUndefined();
        expect(totalCarbohydrate({})).toBeUndefined();
    });

    it('counts a trace or below-limit mark as 0 in the sum, and a by-difference trace as a total of 0', () => {
        expect(totalCarbohydrate({ CHOAVL: 10.5 }, new Set(['FIBTG']))).toBe(10.5);
        expect(totalCarbohydrate({ FIBTG: 2 }, new Set(['CHOAVL']))).toBe(2);
        expect(totalCarbohydrate({ FIBTG: 2 }, new Set(['CHOCDF']))).toBe(0);
        expect(totalCarbohydrate({}, new Set(['CHOAVLM', 'FIBTG']))).toBe(0);
    });

    it('still prefers a stated value over a trace of the same arm, and stays absent with no fibre mark at all', () => {
        expect(totalCarbohydrate({ CHOCDF: 12 }, new Set(['CHOAVL']))).toBe(12);
        expect(totalCarbohydrate({ CHOAVL: 10 }, new Set(['FAT']))).toBeUndefined();
        expect(totalCarbohydrate({ CHOAVLM: 10, FIBTG: 1 }, new Set(['CHOAVL']))).toBe(11);
    });
});
