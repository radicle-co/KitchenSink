/**
 * The nutrient projection (KTD-3, plan U8).
 *
 * ⛔ Every failure this suite guards produces a PLAUSIBLE NUMBER, not an error. There is no crash, no 500,
 * no red test elsewhere — just a calorie count that is wrong by 4.184×, or a per-serving figure presented as
 * per-100g. That is the entire reason the selection moved into the food service and the entire reason these
 * are pinned to exact values.
 */
import { describe, it, expect } from 'vitest';

import { LABEL_NUTRIENT_MAP, lookupLabelNutrient } from '../labelNutrientMap.js';
import { projectNutrition, selectPer100g, type NutrientRow } from '../nutrientSelection.js';

const row = (over: Partial<NutrientRow> = {}): NutrientRow => ({
    nutrient: 'Protein',
    amount: 12,
    unit: 'g',
    basis: 'per_100g',
    ...over,
});

describe('selectPer100g — the kJ trap', () => {
    it('⛔ picks the kcal energy row, NEVER the kJ row that shares its name', () => {
        // USDA supplies BOTH for one food under the name "Energy". The old selector matched
        // `name.includes('energy')`, so whichever sorted first won and the same food read 239 or 1000 —
        // a 4.184× error rendered as a calorie count.
        const rows = [
            row({ nutrient: 'Energy', amount: 1000, unit: 'kJ' }),
            row({ nutrient: 'Energy', amount: 239, unit: 'kcal' }),
        ];

        expect(selectPer100g(rows, 'calories')).toBe(239);
    });

    it('picks kcal even when the kJ row is listed second', () => {
        const rows = [
            row({ nutrient: 'Energy', amount: 239, unit: 'kcal' }),
            row({ nutrient: 'Energy', amount: 1000, unit: 'kJ' }),
        ];

        expect(selectPer100g(rows, 'calories')).toBe(239);
    });

    it('reports ABSENT when only a kJ row exists — never a converted guess', () => {
        // Converting here would re-create the same class of bug with extra steps, and quietly: the caller
        // cannot tell a measured kcal from a derived one.
        expect(selectPer100g([row({ nutrient: 'Energy', amount: 1000, unit: 'kJ' })], 'calories')).toBeUndefined();
    });
});

describe('selectPer100g — the basis trap', () => {
    it('⛔ reports ABSENT for a nutrient available only per_serving', () => {
        // Branded foods keep label values as `per_serving` whenever the serving is a millilitre or a count.
        // Projecting one into a per-100g field is silently wrong by the serving's size.
        const rows = [row({ nutrient: 'Energy', amount: 150, unit: 'kcal', basis: 'per_serving' })];

        expect(selectPer100g(rows, 'calories')).toBeUndefined();
    });

    it('prefers the per_100g row when both bases are present', () => {
        const rows = [
            row({ nutrient: 'Energy', amount: 150, unit: 'kcal', basis: 'per_serving' }),
            row({ nutrient: 'Energy', amount: 60, unit: 'kcal', basis: 'per_100g' }),
        ];

        expect(selectPer100g(rows, 'calories')).toBe(60);
    });
});

describe('selectPer100g — the name trap', () => {
    it('⛔ does NOT match "Fatty acids, total trans" when selecting total fat', () => {
        // `name.includes('fat')` matched it. Exact canonical names are what stop a trans-fat gram count
        // being served as the food's total fat.
        const rows = [row({ nutrient: 'Fatty acids, total trans', amount: 0.2, unit: 'g' })];

        expect(selectPer100g(rows, 'fat')).toBeUndefined();
    });

    it('matches the canonical total-fat name exactly', () => {
        const rows = [row({ nutrient: 'Total lipid (fat)', amount: 3.3, unit: 'g' })];

        expect(selectPer100g(rows, 'fat')).toBe(3.3);
    });

    it('is case- and whitespace-insensitive, but not fuzzy', () => {
        expect(selectPer100g([row({ nutrient: '  total   LIPID (fat) ', amount: 1, unit: 'G' })], 'fat')).toBe(1);
        expect(selectPer100g([row({ nutrient: 'lipids', amount: 1, unit: 'g' })], 'fat')).toBeUndefined();
    });

    it('folds the two micro signs, which render identically and both occur in the wild', () => {
        // U+00B5 MICRO SIGN vs U+03BC GREEK SMALL LETTER MU. An exact-string unit compare rejects half the
        // sources' vitamin D rows for a reason no one can see by reading the data.
        const greekMu = [row({ nutrient: 'Vitamin D (D2 + D3)', amount: 1.1, unit: 'μg' })];

        expect(selectPer100g(greekMu, 'vitaminD')).toBe(1.1);
    });
});

describe('projectNutrition', () => {
    it('projects the four macros from qualifying rows', () => {
        const rows = [
            row({ nutrient: 'Energy', amount: 239, unit: 'kcal' }),
            row({ nutrient: 'Protein', amount: 27, unit: 'g' }),
            row({ nutrient: 'Carbohydrate, by difference', amount: 0, unit: 'g' }),
            row({ nutrient: 'Total lipid (fat)', amount: 14, unit: 'g' }),
        ];

        expect(projectNutrition(rows)).toEqual({
            caloriesPer100g: 239,
            proteinGPer100g: 27,
            carbsGPer100g: 0,
            fatGPer100g: 14,
        });
    });

    it('distinguishes a genuine ZERO from an absent nutrient', () => {
        // A food with 0 g carbohydrate must report 0, not absent — and a food with no carbohydrate ROW must
        // report absent, not 0. Collapsing the two is how "unknown" becomes "none" on a nutrition label.
        const zero = projectNutrition([row({ nutrient: 'Carbohydrate, by difference', amount: 0, unit: 'g' })]);

        expect(zero.carbsGPer100g).toBe(0);
        expect(projectNutrition([]).carbsGPer100g).toBeUndefined();
    });

    it('reports every macro absent for a food with no rows at all', () => {
        expect(projectNutrition([])).toEqual({
            caloriesPer100g: undefined,
            proteinGPer100g: undefined,
            carbsGPer100g: undefined,
            fatGPer100g: undefined,
        });
    });
});

describe('the label-nutrient map', () => {
    it('pins energy to kcal — the single most consequential entry', () => {
        expect(LABEL_NUTRIENT_MAP.calories).toEqual({ name: 'Energy', unit: 'kcal' });
    });

    it('carries a unit for every entry, because the unit is part of the identity', () => {
        for (const [key, value] of Object.entries(LABEL_NUTRIENT_MAP)) {
            expect(value.unit, `${key} has no unit`).toBeTruthy();
            expect(value.name, `${key} has no name`).toBeTruthy();
        }
    });

    it('returns undefined for an unregistered key rather than an implicit any', () => {
        expect(lookupLabelNutrient('notANutrient')).toBeUndefined();
        expect(lookupLabelNutrient('calories')).toEqual({ name: 'Energy', unit: 'kcal' });
    });

    it('is not fooled by a prototype key', () => {
        expect(lookupLabelNutrient('toString')).toBeUndefined();
        expect(lookupLabelNutrient('constructor')).toBeUndefined();
    });
});
