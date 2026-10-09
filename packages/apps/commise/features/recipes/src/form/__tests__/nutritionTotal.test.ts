/**
 * Unit tests for `nutritionTotal.ts` — the Ingredients section's running total, one view for the section foot and the
 * rail foot (build spec §7.5.6): loading, failed, nothing counted ("Nutrition appears as you match ingredients.",
 * never "0 cal", F7), counted, and R38's range disclosure.
 */
import { describe, expect, it } from 'vitest';

import { makeRecipeFormValues, withLineKeys } from '../../__fixtures__/index.js';
import { recipeFormMessages } from '../messages.js';
import type { IngredientNutrition, LookupEntry } from '../nutritionLookup.js';
import { nutritionTotalViewOf } from '../nutritionTotal.js';
import type { RecipeFormValues } from '../values.js';

const m = recipeFormMessages.en;

const FLOUR: LookupEntry = {
    state: 'found',
    catalog: { caloriesPer100g: 364, proteinGPer100g: 10, carbsGPer100g: 76, fatGPer100g: 1 },
};

const values = (quantityHigh?: number): RecipeFormValues => ({
    ...makeRecipeFormValues({}),
    servings: 1,
    ingredients: withLineKeys([
        {
            ingredientId: 'ing_flour',
            foodId: 'food_flour',
            name: 'Flour',
            isUserEntered: false,
            quantity: 100,
            unit: 'g',
            ...(quantityHigh === undefined ? {} : { quantityHigh }),
        },
    ]),
});

const nutrition = (read: IngredientNutrition['read'], entry: LookupEntry): IngredientNutrition => ({
    read,
    lookup: () => entry,
    retry: () => undefined,
});

describe('nutritionTotalViewOf', () => {
    it('is loading until the read answers, and shows no figure', () => {
        expect(nutritionTotalViewOf(values(), nutrition('loading', FLOUR), 'en', m)).toEqual({ kind: 'loading' });
    });

    it('is failed with no figure beside it (a total from no lines reads as a fact)', () => {
        expect(nutritionTotalViewOf(values(), nutrition('failed', FLOUR), 'en', m)).toEqual({ kind: 'failed' });
    });

    it('says nutrition appears as ingredients match while nothing is counted: never "0 cal" (F7)', () => {
        const view = nutritionTotalViewOf(values(), nutrition('ready', { state: 'absent' }), 'en', m);

        expect(view).toEqual({ kind: 'ready', line: m.nutritionEmpty, rangeNotice: undefined });
        expect(JSON.stringify(view)).not.toMatch(/\b0 cal/);
    });

    it('states calories per serving and how many lines counted', () => {
        expect(nutritionTotalViewOf(values(), nutrition('ready', FLOUR), 'en', m)).toEqual({
            kind: 'ready',
            line: '364 cal per serving · 1 of 1 counted',
            rangeNotice: undefined,
        });
    });

    it('R38: discloses which bound a range was computed from', () => {
        const view = nutritionTotalViewOf(values(200), nutrition('ready', FLOUR), 'en', m);

        expect(view.kind === 'ready' ? view.rangeNotice : undefined).toBe(m.nutritionRangeDerivedLow);
    });
});
