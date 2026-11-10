/**
 * `refusedLinesOf` — the refusal sheet's lines, built from any list of recipe lines (a recipe's own, or one saved version's)
 * and the lines the server refused. The detail page and the version history share it, so the match rule lives once.
 */
import { describe, expect, it } from 'vitest';

import { refusedLinesOf, type RefusableLine } from '../refusedLinesOf.js';

const line = (over: Partial<RefusableLine>): RefusableLine => ({
    quantity: { kind: 'exact', value: 1 },
    unit: 'tbsp',
    ...over,
});

describe('refusedLinesOf', () => {
    it('names a refused line with its amount and the cook’s words', () => {
        const lines = [
            line({ foodId: 'food_a', displayText: 'My spice mix', quantity: { kind: 'exact', value: 2 } }),
            line({ foodId: 'food_b', name: 'Salt' }),
        ];

        expect(refusedLinesOf(lines, [{ sortOrder: 0, foodId: 'food_a' }], 'en')).toEqual([
            { rowId: '0', foodId: 'food_a', amount: '2 tbsp', words: 'My spice mix' },
        ]);
    });

    it('falls back to the line’s name when it has no display text', () => {
        expect(
            refusedLinesOf([line({ foodId: 'food_a', name: 'Oat milk' })], [{ sortOrder: 0, foodId: 'food_a' }], 'en'),
        ).toEqual([{ rowId: '0', foodId: 'food_a', amount: '1 tbsp', words: 'Oat milk' }]);
    });

    it('breaks a tie between two lines of one food by sortOrder', () => {
        const lines = [
            line({ foodId: 'food_a', displayText: 'first' }),
            line({ foodId: 'food_a', displayText: 'second' }),
        ];

        expect(refusedLinesOf(lines, [{ sortOrder: 1, foodId: 'food_a' }], 'en').map((row) => row.words)).toEqual([
            'second',
        ]);
    });

    it('prefers the line’s own ingredient id as the row id and drops a food the lines no longer hold', () => {
        const lines = [line({ ingredientId: 'ing_1', foodId: 'food_a', displayText: 'x' })];

        expect(refusedLinesOf(lines, [{ sortOrder: 0, foodId: 'food_gone' }], 'en')).toEqual([]);
        expect(refusedLinesOf(lines, [{ sortOrder: 0, foodId: 'food_a' }], 'en')[0]?.rowId).toBe('ing_1');
    });
});
