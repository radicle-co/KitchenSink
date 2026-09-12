/**
 * Unit tests for an ingredient line's food-resolution bookkeeping (`form/ingredientStatus.ts`).
 *
 * ⚠️ These 2 describe blocks came from `model.test.ts`, which covered all of `form/model.ts`
 * before it was split into one module per concern. No assertion was changed, added or dropped in the
 * move — the suite is redistributed, not rewritten.
 */
import { describe, expect, it } from 'vitest';

import { makeFilledRecipeFormValues } from '../../__fixtures__/index.js';
import { pendingIngredientIds, setIngredientStatusById } from '../ingredientStatus.js';
import type { RecipeFormValues } from '../values.js';

describe('pendingIngredientIds (poll-after-add: which lines still resolve)', () => {
    it('returns only the catalog ids of PENDING lines, de-duplicated', () => {
        const values = makeFilledRecipeFormValues({
            ingredients: [
                { ingredientId: 'p1', name: 'Quinoa', quantity: 1, resolutionStatus: 'PENDING' },
                { ingredientId: 'r1', name: 'Rice', quantity: 1, resolutionStatus: 'RESOLVED' },
                { ingredientId: 'p1', name: 'Quinoa again', quantity: 2, resolutionStatus: 'PENDING' },
                { ingredientId: 'u1', name: 'Ambiguous', quantity: 1, resolutionStatus: 'UNRESOLVED' },
            ],
        });

        // Only PENDING ids, and p1 (twice) collapses to one — RESOLVED/UNRESOLVED are NOT polled.
        expect(pendingIngredientIds(values)).toEqual(['p1']);
    });

    it('never polls a line with no catalog id or with no status', () => {
        const values = makeFilledRecipeFormValues({
            ingredients: [
                { ingredientId: null, name: 'Blank', quantity: 1, resolutionStatus: 'PENDING' },
                { ingredientId: 'x', name: 'Freeform', quantity: 1 },
            ],
        });

        expect(pendingIngredientIds(values)).toEqual([]);
    });
});

describe('setIngredientStatusById (poll-after-add: apply a resolved status)', () => {
    const pendingValues = (): RecipeFormValues =>
        makeFilledRecipeFormValues({
            ingredients: [
                { ingredientId: 'p1', name: 'Quinoa', quantity: 1, resolutionStatus: 'PENDING' },
                { ingredientId: 'p1', name: 'Quinoa', quantity: 2, resolutionStatus: 'PENDING' },
                { ingredientId: 'other', name: 'Rice', quantity: 1, resolutionStatus: 'PENDING' },
            ],
        });

    it('flips EVERY line linked to the id to the new status, leaving other lines untouched', () => {
        const next = setIngredientStatusById(pendingValues(), 'p1', 'RESOLVED');

        expect(next.ingredients.map((l) => l.resolutionStatus)).toEqual(['RESOLVED', 'RESOLVED', 'PENDING']);
    });

    it('returns the SAME reference when the status is unchanged (no render loop)', () => {
        const values = pendingValues();

        // p1 is already PENDING → setting PENDING must be a no-op that preserves referential identity.
        expect(setIngredientStatusById(values, 'p1', 'PENDING')).toBe(values);
    });

    it('returns the SAME reference when no line matches the id', () => {
        const values = pendingValues();

        expect(setIngredientStatusById(values, 'missing', 'RESOLVED')).toBe(values);
    });
});
