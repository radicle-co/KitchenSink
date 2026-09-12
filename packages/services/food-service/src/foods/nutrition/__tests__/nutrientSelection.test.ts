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
import { NUTRIENT_DEFINITIONS, type NutrientDefinitionKey } from '../nutrientIdentity.js';
import { projectNutrition, projectStoredNutrition, selectPer100g, type NutrientRow } from '../nutrientSelection.js';
import type { StoredNutrientAmount } from '../../dao/food.dao.js';

const row = (over: Partial<NutrientRow> = {}): NutrientRow => ({
    nutrient: 'Protein',
    infoodsTag: null,
    amount: 12,
    trace: false,
    unit: 'g',
    basis: 'per_100g',
    ...over,
});

/**
 * A row stored under one of the catalog's definitions, carrying the dictionary's name, unit and tag exactly as
 * `food_nutrient_view` returns them.
 */
const defined = (
    key: NutrientDefinitionKey,
    amount: number | undefined,
    over: Partial<NutrientRow> = {},
): NutrientRow =>
    row({
        nutrient: NUTRIENT_DEFINITIONS[key].name,
        unit: NUTRIENT_DEFINITIONS[key].unit,
        infoodsTag: NUTRIENT_DEFINITIONS[key].tag,
        amount,
        trace: amount === undefined,
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
            defined('energyKcal', 239),
            defined('protein', 27),
            defined('carbohydrateByDifference', 0),
            defined('fat', 14),
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
        const zero = projectNutrition([defined('carbohydrateByDifference', 0)]);

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

describe('calories — KTD-21: Energy (1008), else Atwater Specific (2048), else Atwater General (2047)', () => {
    it('reads the 1008 row when all three are stored', () => {
        const rows = [
            defined('energyKcalAtwaterGeneral', 120),
            defined('energyKcalAtwaterSpecific', 118),
            defined('energyKcal', 121),
        ];

        expect(projectNutrition(rows).caloriesPer100g).toBe(121);
    });

    it('falls back to 2048 when 1008 is not stored — a Foundation item that carries only the Atwater pair', () => {
        const rows = [defined('energyKcalAtwaterGeneral', 120), defined('energyKcalAtwaterSpecific', 118)];

        expect(projectNutrition(rows).caloriesPer100g).toBe(118);
    });

    it('falls back to 2047 when neither 1008 nor 2048 is stored', () => {
        expect(projectNutrition([defined('energyKcalAtwaterGeneral', 120)]).caloriesPer100g).toBe(120);
    });

    it('treats an energy trace as no figure and falls through to the next definition', () => {
        // A trace mark is below the source's reporting limit. For carbohydrate that sums as 0, but no food's
        // calories are read off a mark: the next definition that states a number answers instead.
        const rows = [defined('energyKcal', undefined), defined('energyKcalAtwaterSpecific', 118)];

        expect(projectNutrition(rows).caloriesPer100g).toBe(118);
    });

    it('reports calories ABSENT when every energy definition is a trace, a kJ row or missing', () => {
        const rows = [defined('energyKcal', undefined), defined('energyKj', 500)];

        expect(projectNutrition(rows).caloriesPer100g).toBeUndefined();
    });

    it('never reads an Atwater figure stated only per serving', () => {
        const rows = [defined('energyKcalAtwaterSpecific', 150, { basis: 'per_serving' })];

        expect(projectNutrition(rows).caloriesPer100g).toBeUndefined();
    });
});

describe('carbohydrate — KTD-23: read by tag through totalCarbohydrate', () => {
    it('reads the by-difference value', () => {
        expect(projectNutrition([defined('carbohydrateByDifference', 13.8)]).carbsGPer100g).toBe(13.8);
    });

    it('counts a by-difference trace as 0, never as absent', () => {
        expect(projectNutrition([defined('carbohydrateByDifference', undefined)]).carbsGPer100g).toBe(0);
    });

    it('sums available carbohydrate and fibre when by-difference is not stored', () => {
        const rows = [defined('carbohydrateAvailable', 10.2), defined('fibre', 2.4)];

        expect(projectNutrition(rows).carbsGPer100g).toBe(12.6);
    });

    it('counts a fibre trace as 0 in that sum', () => {
        const rows = [defined('carbohydrateAvailable', 10.2), defined('fibre', undefined)];

        expect(projectNutrition(rows).carbsGPer100g).toBe(10.2);
    });

    // Livsmedelsdatabasen's carbohydrate is available carbohydrate by difference (CHOAVLDF). A stored row of it must
    // reach the read rule, or a root citing that source would show no carbohydrate.
    it("sums Livsmedelsdatabasen's available carbohydrate by difference and fibre", () => {
        const rows = [defined('carbohydrateAvailableByDifference', 78.1), defined('fibre', 1.2)];

        expect(projectNutrition(rows).carbsGPer100g).toBe(79.3);
    });

    it('reports ABSENT for available carbohydrate with no fibre figure — half a total is not a total', () => {
        expect(projectNutrition([defined('carbohydrateAvailable', 10.2)]).carbsGPer100g).toBeUndefined();
    });

    it('reports ABSENT for a carbohydrate stated only per serving', () => {
        const rows = [defined('carbohydrateByDifference', 30, { basis: 'per_serving' })];

        expect(projectNutrition(rows).carbsGPer100g).toBeUndefined();
    });

    it('reads by TAG: a row bearing the by-difference name but no tag is not a stored definition', () => {
        const rows = [defined('carbohydrateByDifference', 13.8, { infoodsTag: null })];

        expect(projectNutrition(rows).carbsGPer100g).toBeUndefined();
    });
});

describe('a trace on protein or fat', () => {
    it('reports protein ABSENT, never 0 — only carbohydrate sums a trace', () => {
        expect(projectNutrition([defined('protein', undefined)]).proteinGPer100g).toBeUndefined();
    });

    it('reports fat ABSENT, never 0', () => {
        expect(projectNutrition([defined('fat', undefined)]).fatGPer100g).toBeUndefined();
    });
});

describe('projectStoredNutrition — the one seam from the driver strings', () => {
    const stored = (over: Partial<StoredNutrientAmount> = {}): StoredNutrientAmount => ({
        nutrient: NUTRIENT_DEFINITIONS.protein.name,
        unit: NUTRIENT_DEFINITIONS.protein.unit,
        infoodsTag: NUTRIENT_DEFINITIONS.protein.tag,
        basis: 'per_100g',
        amount: '27.125',
        trace: false,
        ...over,
    });

    it('converts the numeric string', () => {
        expect(projectStoredNutrition([stored()]).proteinGPer100g).toBe(27.125);
    });

    it('⛔ keeps a NULL amount absent — `Number(null)` is 0, which would publish a trace as zero protein', () => {
        expect(projectStoredNutrition([stored({ amount: null, trace: true })]).proteinGPer100g).toBeUndefined();
    });

    it('carries the tag and the trace mark through, so a carbohydrate trace still sums as 0', () => {
        const carbTrace = stored({
            nutrient: NUTRIENT_DEFINITIONS.carbohydrateByDifference.name,
            infoodsTag: NUTRIENT_DEFINITIONS.carbohydrateByDifference.tag,
            amount: null,
            trace: true,
        });

        expect(projectStoredNutrition([carbTrace]).carbsGPer100g).toBe(0);
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
