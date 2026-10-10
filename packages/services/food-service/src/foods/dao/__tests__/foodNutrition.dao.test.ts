/**
 * The fold behind `FoodNutritionDao.upsertValues`: one value per `(header, nutrient)`, the last one given winning.
 *
 * A multi-row `ON CONFLICT DO UPDATE` refuses to touch one row twice, and two source names can resolve to one
 * dictionary entry, so the batch must fold before it is sent — and fold to what the one-at-a-time upserts it replaced
 * left behind, which is the LAST write. The statement itself is proven against Postgres in `nutritionDao.e2e.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import { lastValuePerNutrient, type UpsertNutritionValueInput } from '../foodNutrition.dao.js';

const value = (nutritionId: string, nutrientId: string, amount: string): UpsertNutritionValueInput => ({
    nutritionId,
    nutrientId,
    amount,
    citationId: 'cite-1',
});

describe('lastValuePerNutrient', () => {
    it('keeps the LAST value given for a repeated (header, nutrient)', () => {
        expect(
            lastValuePerNutrient([value('h1', 'protein', '1'), value('h1', 'fat', '2'), value('h1', 'protein', '3')]),
        ).toStrictEqual([value('h1', 'protein', '3'), value('h1', 'fat', '2')]);
    });

    it('keeps one nutrient under two headers as two values', () => {
        expect(lastValuePerNutrient([value('h1', 'protein', '1'), value('h2', 'protein', '2')])).toHaveLength(2);
    });

    it('does not confuse ids whose concatenations collide', () => {
        expect(lastValuePerNutrient([value('ab', 'c', '1'), value('a', 'bc', '2')])).toHaveLength(2);
    });

    it('answers an empty batch with nothing', () => {
        expect(lastValuePerNutrient([])).toStrictEqual([]);
    });
});
