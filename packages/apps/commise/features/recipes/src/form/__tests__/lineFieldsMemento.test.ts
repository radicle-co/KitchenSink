/**
 * `lineFieldsMemento.ts` — what the row editor's Cancel puts back.
 *
 * What these prove: a capture then a restore is the identity on the six fields the row editor edits, a key that was
 * ABSENT at capture is ABSENT after the restore (so `recipeFormValuesEqual` still holds and the discard guard sees no
 * change), and the binding and status fields are never touched, so Cancel cannot undo a food change.
 */
import { describe, expect, it } from 'vitest';

import { makeFilledRecipeFormValues, withLineKey, type UnkeyedFormIngredient } from '../../__fixtures__/index.js';
import { captureLineFields, restoreLineFields } from '../lineFieldsMemento.js';
import { recipeFormValuesEqual } from '../values.js';

const makeRecipeFormIngredient = (over: Partial<UnkeyedFormIngredient> = {}) =>
    withLineKey({ isUserEntered: false, ingredientId: 'ing_1', quantity: 1, ...over });

describe('captureLineFields / restoreLineFields', () => {
    it('puts back every edited field', () => {
        const before = makeRecipeFormIngredient({
            quantity: 2,
            quantityHigh: 3,
            unit: 'cup',
            displayText: 'flour',
            note: '9 inch',
            preparation: 'sifted',
        });
        const memento = captureLineFields(before);
        const edited = {
            ...before,
            quantity: 9,
            quantityHigh: 10,
            unit: 'g',
            displayText: 'other',
            note: 'x',
            preparation: 'diced',
        };

        expect(restoreLineFields(edited, memento)).toEqual(before);
    });

    it('removes a key that was absent at capture, rather than leaving undefined behind', () => {
        const before = makeRecipeFormIngredient({ quantity: 1 });
        const bare = { ...before };

        delete (bare as { quantityHigh?: number }).quantityHigh;
        delete (bare as { note?: string }).note;

        const restored = restoreLineFields(
            { ...bare, quantityHigh: 4, note: 'added', unit: 'cup', displayText: 'x', preparation: 'y' },
            captureLineFields(bare),
        );

        expect('quantityHigh' in restored).toBe(false);
        expect('note' in restored).toBe(false);
        expect('unit' in restored).toBe(false);
        expect('displayText' in restored).toBe(false);
        expect('preparation' in restored).toBe(false);
        const values = makeFilledRecipeFormValues();

        expect(recipeFormValuesEqual({ ...values, ingredients: [bare] }, { ...values, ingredients: [restored] })).toBe(
            true,
        );
    });

    it('never touches the binding or status fields', () => {
        const before = makeRecipeFormIngredient({ quantity: 1, ingredientId: 'ing_old', name: 'Old' });
        const memento = captureLineFields(before);
        const changedFood = { ...before, ingredientId: 'ing_new', name: 'New', foodId: 'f2', quantity: 5 };
        const restored = restoreLineFields(changedFood, memento);

        expect(restored.ingredientId).toBe('ing_new');
        expect(restored.name).toBe('New');
        expect(restored.foodId).toBe('f2');
        expect(restored.quantity).toBe(1);
    });
});
