/**
 * The wire of `POST /api/v1/ingredients/food-nutrition` (plan 002 U9, R31): food refs in, per-100 g nutrition out.
 *
 * A ref is food's own `foodRefSchema`, so both services share one definition of a root or variant ref. Each entry
 * answers one distinct ref with one of three outcomes, and only `found` carries numbers.
 */
import { describe, expect, it } from 'vitest';

import {
    MAX_FOOD_NUTRITION_REFS,
    ingredientFoodNutritionEntrySchema,
    ingredientFoodNutritionRequestSchema,
    ingredientFoodNutritionResponseSchema,
} from '../ingredients.schema.js';

const ROOT = { kind: 'root', id: '01JFOOD0000000000000000001' } as const;
const VARIANT = { kind: 'variant', id: '01JVARIANT00000000000000001' } as const;

describe('ingredientFoodNutritionRequestSchema', () => {
    it('accepts root and variant refs', () => {
        expect(ingredientFoodNutritionRequestSchema.parse({ refs: [ROOT, VARIANT] })).toStrictEqual({
            refs: [ROOT, VARIANT],
        });
    });

    it(`accepts ${MAX_FOOD_NUTRITION_REFS} refs, food's own ref cap`, () => {
        const refs = Array.from({ length: MAX_FOOD_NUTRITION_REFS }, (_, index) => ({ kind: 'root', id: `f${index}` }));

        expect(ingredientFoodNutritionRequestSchema.safeParse({ refs }).success).toBe(true);
    });

    it.each([
        ['no refs', { refs: [] }],
        [
            `${MAX_FOOD_NUTRITION_REFS + 1} refs`,
            {
                refs: Array.from({ length: MAX_FOOD_NUTRITION_REFS + 1 }, (_, index) => ({
                    kind: 'root',
                    id: `f${index}`,
                })),
            },
        ],
        ['an unknown kind', { refs: [{ kind: 'recipe', id: 'r1' }] }],
        ['a blank id', { refs: [{ kind: 'root', id: '' }] }],
        ['⛔ an unknown key on a ref', { refs: [{ ...ROOT, ownerId: 'u1' }] }],
        ['⛔ an unknown key on the body', { refs: [ROOT], callerId: 'u1' }],
    ])('refuses %s', (_, body) => {
        expect(ingredientFoodNutritionRequestSchema.safeParse(body).success).toBe(false);
    });
});

describe('ingredientFoodNutritionEntrySchema', () => {
    it('parses a found entry with its numbers, its freshness and its portions', () => {
        const found = {
            outcome: 'found',
            ref: ROOT,
            freshness: 'stale',
            caloriesPer100g: 165,
            proteinGPer100g: 31,
            portions: [{ unit: 'cup', gramsPerUnit: 140 }],
        };

        expect(ingredientFoodNutritionEntrySchema.parse(found)).toStrictEqual(found);
    });

    it('keeps a missing number missing on a found entry, never zero', () => {
        const parsed = ingredientFoodNutritionEntrySchema.parse({
            outcome: 'found',
            ref: ROOT,
            freshness: 'fresh',
            portions: [],
        });

        expect(parsed).toStrictEqual({ outcome: 'found', ref: ROOT, freshness: 'fresh', portions: [] });
    });

    it('keeps a found root’s hasVariants (blueprint decision 4)', () => {
        const found = { outcome: 'found', ref: ROOT, freshness: 'fresh', portions: [], hasVariants: false };

        expect(ingredientFoodNutritionEntrySchema.parse(found)).toStrictEqual(found);
    });

    it.each(['absent', 'unavailable'] as const)('parses an %s entry, which carries only its ref', (outcome) => {
        expect(ingredientFoodNutritionEntrySchema.parse({ outcome, ref: VARIANT })).toStrictEqual({
            outcome,
            ref: VARIANT,
        });
    });

    it.each([
        ['a found entry with no freshness', { outcome: 'found', ref: ROOT, portions: [] }],
        ['a found entry with no portions', { outcome: 'found', ref: ROOT, freshness: 'fresh' }],
        ['a negative number', { outcome: 'found', ref: ROOT, freshness: 'fresh', caloriesPer100g: -1, portions: [] }],
        [
            'a hasVariants that is not a boolean',
            { outcome: 'found', ref: ROOT, freshness: 'fresh', portions: [], hasVariants: 'yes' },
        ],
        ['an unknown outcome', { outcome: 'hidden', ref: ROOT }],
        ['an entry with no ref', { outcome: 'absent' }],
    ])('refuses %s', (_, entry) => {
        expect(ingredientFoodNutritionEntrySchema.safeParse(entry).success).toBe(false);
    });
});

describe('ingredientFoodNutritionResponseSchema', () => {
    it('parses one entry per ref', () => {
        const body = {
            entries: [
                { outcome: 'absent', ref: VARIANT },
                { outcome: 'unavailable', ref: ROOT },
            ],
        };

        expect(ingredientFoodNutritionResponseSchema.parse(body)).toStrictEqual(body);
    });
});
