/**
 * Unit tests for the draft's nutrition projection (`form/nutrition.ts`).
 *
 * REWRITTEN for plan 002 V1 B5 (blueprint Decision 3: one source of nutrition). The draft no longer carries per-100 g
 * figures or portions — they arrived only on lines picked in this session, so an opened recipe totalled to nothing.
 * The catalog figures now come from the background batch read through a lookup, and the per-row calorie chip is gone
 * (plan 002 R30: calories live in the panel). What these tests pin is that the total is still recipe-core's ONE
 * aggregator, fed the lookup's figures.
 */
import { describe, expect, it } from 'vitest';

import { computeRecipeNutrition } from '@kitchensink/recipe-core';
import { makeFilledRecipeFormValues, withLineKeys, withLineKey } from '../../__fixtures__/index.js';
import { lineCatalogOf, recipeNutritionTotal, toNutritionLine, userStatedFiguresOf } from '../nutrition.js';
import type { FoodNutritionRef, LineNutritionLookup, LookupEntry } from '../nutritionLookup.js';

const RICE: FoodNutritionRef = { kind: 'root', id: 'rice' };
const OIL: FoodNutritionRef = { kind: 'root', id: 'oil' };
const RICE_ENTRY: LookupEntry = {
    state: 'found',
    catalog: { caloriesPer100g: 130, proteinGPer100g: 2.7, carbsGPer100g: 28, fatGPer100g: 0.3 },
};
const OIL_ENTRY: LookupEntry = {
    state: 'found',
    catalog: { caloriesPer100g: 884, portions: [{ unit: 'tbsp', gramsPerUnit: 13.5 }] },
};
const lookup: LineNutritionLookup = (ref) =>
    ref.id === RICE.id ? RICE_ENTRY : ref.id === OIL.id ? OIL_ENTRY : { state: 'pending' };

describe('lineCatalogOf', () => {
    it('reads a line\u2019s catalog figures from the lookup by its food ref', () => {
        const line = withLineKey({
            ingredientId: 'i',
            name: 'Rice',
            quantity: 300,
            unit: 'g',
            isUserEntered: false,
            foodRef: RICE,
        });

        expect(lineCatalogOf(line, lookup)).toEqual({
            caloriesPer100g: 130,
            proteinGPer100g: 2.7,
            carbsGPer100g: 28,
            fatGPer100g: 0.3,
        });
    });

    it('is undefined for a line with no ref, and for a ref still loading', () => {
        const noRef = withLineKey({ ingredientId: 'i', name: 'Mix', quantity: 1, isUserEntered: true });
        const loading = withLineKey({
            ingredientId: 'i',
            name: 'X',
            quantity: 1,
            isUserEntered: false,
            foodRef: { kind: 'root', id: 'x' },
        });

        expect(lineCatalogOf(noRef, lookup)).toBeUndefined();
        expect(lineCatalogOf(loading, lookup)).toBeUndefined();
    });
});

/**
 * Finding #7 (plan 002 V1): the editor withholds what the detail read withholds. recipe-service's `isWithheldLine`
 * keeps the catalog figures of a line the verification gate contradicted or has not judged yet; on the wire those
 * lines read `NEEDS_REVIEW` or `PENDING_VERIFICATION`, and the read still sends their `foodId`. Only the CATALOG
 * contribution is withheld: figures the cook stated still count, as on the server.
 */
describe('lineCatalogOf — withholds a line the verification gate has not cleared', () => {
    it.each(['NEEDS_REVIEW', 'PENDING_VERIFICATION'] as const)(
        'withholds the catalog figures of a %s line whose ref the lookup answered',
        (status) => {
            const line = withLineKey({
                ingredientId: 'i',
                name: 'Rice',
                quantity: 300,
                unit: 'g',
                isUserEntered: false,
                foodRef: RICE,
                resolutionStatus: status,
            });

            expect(lineCatalogOf(line, lookup)).toBeUndefined();
        },
    );

    it.each(['RESOLVED', 'AMBIGUOUS'] as const)('still reads the catalog figures of a %s line', (status) => {
        const line = withLineKey({
            ingredientId: 'i',
            name: 'Rice',
            quantity: 300,
            unit: 'g',
            isUserEntered: false,
            foodRef: RICE,
            resolutionStatus: status,
        });

        expect(lineCatalogOf(line, lookup)).toMatchObject({ caloriesPer100g: 130 });
    });
});

describe('toNutritionLine', () => {
    it('merges the measure with the catalog figures through recipe-core', () => {
        const line = withLineKey({ ingredientId: 'i', name: 'Rice', quantity: 300, unit: 'g', isUserEntered: false });

        expect(toNutritionLine(line, { caloriesPer100g: 130 })).toEqual({
            quantity: { kind: 'exact', value: 300 },
            unit: 'g',
            caloriesPer100g: 130,
        });
    });

    it('degrades an absent unit to an empty string rather than guessing', () => {
        const line = withLineKey({ ingredientId: 'i', name: 'Rice', quantity: 300, isUserEntered: false });

        expect(toNutritionLine(line, { caloriesPer100g: 130 }).unit).toBe('');
    });
});

describe('userStatedFiguresOf — the ONE "has the cook stated figures" predicate (§6b)', () => {
    it('returns the stated figures, keeping an honest zero', () => {
        const line = withLineKey({
            ingredientId: 'i',
            name: 'Water',
            quantity: 1,
            isUserEntered: true,
            userCalories: 0,
        });

        expect(userStatedFiguresOf(line)).toEqual({ calories: 0 });
    });

    it('is undefined when the cook stated none', () => {
        expect(
            userStatedFiguresOf(withLineKey({ ingredientId: 'i', name: 'W', quantity: 1, isUserEntered: true })),
        ).toBeUndefined();
    });
});

describe('recipeNutritionTotal — the running per-serving total, one aggregator, fed by the lookup', () => {
    const values = makeFilledRecipeFormValues({
        servings: 2,
        ingredients: withLineKeys([
            { ingredientId: 'a', name: 'Rice', quantity: 300, unit: 'g', isUserEntered: false, foodRef: RICE },
            { ingredientId: 'b', name: 'Oil', quantity: 2, unit: 'tbsp', isUserEntered: false, foodRef: OIL },
        ]),
    });

    it('matches computeRecipeNutrition run directly over the same lines and catalog figures', () => {
        const direct = computeRecipeNutrition(
            values.ingredients.map((line) => toNutritionLine(line, lineCatalogOf(line, lookup))),
            values.servings,
        );

        expect(recipeNutritionTotal(values, lookup)).toEqual(direct);
        // Positive control: the figures came from the lookup (300 g rice = 390, 27 g oil = 238.68; per 2 servings).
        expect(recipeNutritionTotal(values, lookup).calories).toBeCloseTo((390 + 238.68) / 2, 1);
        expect(recipeNutritionTotal(values, lookup).isComplete).toBe(true);
    });

    it('is honestly INCOMPLETE while a line\u2019s figures are still loading', () => {
        const loading: LineNutritionLookup = () => ({ state: 'pending' });

        expect(recipeNutritionTotal(values, loading).isComplete).toBe(false);
    });

    it.each(['NEEDS_REVIEW', 'PENDING_VERIFICATION'] as const)(
        'excludes a %s line the lookup answered, and says the total is incomplete',
        (status) => {
            const withheld = makeFilledRecipeFormValues({
                servings: 1,
                ingredients: withLineKeys([
                    { ingredientId: 'a', name: 'Rice', quantity: 300, unit: 'g', isUserEntered: false, foodRef: RICE },
                    {
                        ingredientId: 'b',
                        name: 'Oil',
                        quantity: 2,
                        unit: 'tbsp',
                        isUserEntered: false,
                        foodRef: OIL,
                        resolutionStatus: status,
                    },
                ]),
            });
            const total = recipeNutritionTotal(withheld, lookup);

            // Only the rice: 300 g at 130 kcal / 100 g. The oil's 238.68 is withheld, as the detail read withholds it.
            expect(total.calories).toBeCloseTo(390, 1);
            expect(total.isComplete).toBe(false);
        },
    );

    it('still counts the figures the cook stated on a withheld line', () => {
        const stated = makeFilledRecipeFormValues({
            servings: 1,
            ingredients: withLineKeys([
                {
                    ingredientId: 'b',
                    name: 'Oil',
                    quantity: 2,
                    unit: 'tbsp',
                    isUserEntered: false,
                    foodRef: OIL,
                    resolutionStatus: 'NEEDS_REVIEW',
                    userCalories: 200,
                },
            ]),
        });

        expect(recipeNutritionTotal(stated, lookup).calories).toBe(200);
    });

    it('returns a zero, complete total for an empty ingredient list', () => {
        expect(recipeNutritionTotal(makeFilledRecipeFormValues({ ingredients: [] }), lookup)).toMatchObject({
            calories: 0,
            isComplete: true,
        });
    });
});
