/**
 * Unit tests for `nutritionPanel.ts` — every sub-state of a row's nutrition panel (`ingredientStatusExplanation.md`
 * §6b, SPECIFY.4), and the row-3/row-4 figures fact the row policy reads.
 *
 * ⛔ §6b: the panel must AGREE with the total. The cook's own figures win in the aggregator, so they win here too —
 * that is asserted by running the same line through both and comparing, not by restating the rule.
 */
import { describe, expect, it } from 'vitest';

import { withLineKey } from '../../__fixtures__/index.js';
import { recipeNutritionTotal } from '../nutrition.js';
import type { FoodNutritionRef, LineNutritionLookup, LookupEntry } from '../nutritionLookup.js';
import { nutritionPanelOf, rowFiguresOf } from '../nutritionPanel.js';
import { makeRecipeFormValues } from '../../__fixtures__/index.js';

const REF: FoodNutritionRef = { kind: 'root', id: 'f1' };
const lookupAnswering =
    (entry: LookupEntry): LineNutritionLookup =>
    () =>
        entry;
const bound = (over = {}) =>
    withLineKey({
        ingredientId: 'ing_1',
        name: 'Rice',
        quantity: 100,
        unit: 'g',
        isUserEntered: false,
        foodRef: REF,
        ...over,
    });

describe('nutritionPanelOf', () => {
    it.each([
        ['loading while the read runs', { state: 'pending' } as const, { kind: 'loading' }],
        ['failed when the read failed', { state: 'failed' } as const, { kind: 'failed' }],
        ['failed when food could not be asked (unavailable)', { state: 'unavailable' } as const, { kind: 'failed' }],
        ['no data when food answered with nothing readable (absent)', { state: 'absent' } as const, { kind: 'noData' }],
        [
            'no figures when food answered but publishes none',
            { state: 'found', catalog: { portions: [] } } as const,
            { kind: 'noFigures' },
        ],
        [
            'all four figures',
            {
                state: 'found',
                catalog: { caloriesPer100g: 130, proteinGPer100g: 2.7, carbsGPer100g: 28, fatGPer100g: 0.3 },
            } as const,
            { kind: 'figures', figures: { calories: 130, proteinG: 2.7, carbsG: 28, fatG: 0.3 }, partial: false },
        ],
        [
            'some figures: partial, and an absent one stays ABSENT (never 0)',
            { state: 'found', catalog: { caloriesPer100g: 130, fatGPer100g: 0 } } as const,
            { kind: 'figures', figures: { calories: 130, fatG: 0 }, partial: true },
        ],
    ])('%s', (_label, entry, expected) => {
        expect(nutritionPanelOf(bound(), lookupAnswering(entry))).toEqual(expected);
    });

    it('a line with no food ref has no data to look up (a declaration, or a binding food cannot name a ref for)', () => {
        expect(nutritionPanelOf(bound({ foodRef: undefined }), lookupAnswering({ state: 'pending' }))).toEqual({
            kind: 'noData',
        });
    });

    it('⛔ the cook’s own figures win over the catalog, as they do in the total (§6b)', () => {
        const line = bound({ userCalories: 0, userProteinG: 1 });
        const catalog = { state: 'found', catalog: { caloriesPer100g: 130 } } as const;

        expect(nutritionPanelOf(line, lookupAnswering(catalog))).toEqual({
            kind: 'userStated',
            figures: { calories: 0, proteinG: 1 },
        });
        // The total counts the SAME figure the panel shows: 0 calories, not 130.
        const total = recipeNutritionTotal(
            makeRecipeFormValues({ servings: 1, ingredients: [line] }),
            lookupAnswering(catalog),
        );
        expect(total.calories).toBe(0);
    });
});

describe('nutritionPanelOf — §6b: the panel asks the AGGREGATOR whose figures count (REVIEW F2)', () => {
    it('⛔ a stated protein alone does not make the line the cook\u2019s: the total uses the catalog, so the panel does too', () => {
        const catalog = { state: 'found', catalog: { caloriesPer100g: 130, proteinGPer100g: 2.7 } } as const;
        const line = bound({ userProteinG: 1 });

        expect(nutritionPanelOf(line, lookupAnswering(catalog)).kind).toBe('figures');
    });
});

describe('rowFiguresOf (rows 3 and 4 of SPECIFY.1)', () => {
    it.each([
        [
            'published when any catalog figure is',
            { state: 'found', catalog: { caloriesPer100g: 1 } } as const,
            'published',
        ],
        ['unpublished when food publishes none', { state: 'found', catalog: {} } as const, 'unpublished'],
        ['unknown while loading', { state: 'pending' } as const, undefined],
        ['unknown when the read failed', { state: 'failed' } as const, undefined],
    ])('%s', (_label, entry, expected) => {
        expect(rowFiguresOf(bound(), lookupAnswering(entry))).toBe(expected);
    });
});
