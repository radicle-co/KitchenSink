/**
 * The recipe Preview shows (build spec §7.7 item 4): the real detail page drawn from the DRAFT, so the cook sees what
 * others will see before publishing — ranges included (F3), and nothing the draft does not say.
 */
import { describe, expect, it } from 'vitest';

import { makeFilledRecipeFormValues, makeRecipeDetail, withLineKeys } from '../../__fixtures__/index.js';
import { previewRecipeOf } from '../previewRecipe.js';

const NOW = '2026-10-09T12:00:00.000Z';

describe('previewRecipeOf', () => {
    it('draws a new recipe from the draft alone', () => {
        const values = makeFilledRecipeFormValues({
            title: 'Lamb shoulder',
            prepTimeMinutes: 15,
            cookTimeMinutes: 240,
            ingredients: withLineKeys([
                {
                    isUserEntered: false,
                    ingredientId: '00000000-0000-4000-8000-000000000001',
                    name: 'Lamb shoulder',
                    quantity: 2,
                    quantityHigh: 2.5,
                    unit: 'kg',
                    preparation: 'trimmed',
                },
                {
                    isUserEntered: false,
                    ingredientId: '00000000-0000-4000-8000-000000000002',
                    name: 'Salt',
                    quantity: Number.NaN,
                },
            ]),
            steps: [{ instruction: 'Roast.', timerSeconds: 600 }, { instruction: '  ' }],
        });

        const preview = previewRecipeOf({ values, recipe: undefined, now: NOW });

        expect(preview).toMatchObject({
            title: 'Lamb shoulder',
            prepTimeMinutes: 15,
            cookTimeMinutes: 240,
            totalTimeMinutes: 255,
            photos: [],
            ratingCount: 0,
            createdAt: NOW,
        });
        expect(preview.ingredients).toEqual([
            {
                ingredientId: '00000000-0000-4000-8000-000000000001',
                name: 'Lamb shoulder',
                quantity: { kind: 'range', low: 2, high: 2.5 },
                unit: 'kg',
                preparation: 'trimmed',
                isUserEntered: false,
            },
            {
                ingredientId: '00000000-0000-4000-8000-000000000002',
                name: 'Salt',
                quantity: { kind: 'absent' },
                isUserEntered: false,
            },
        ]);
        // A blank step carries nothing, and is not shown.
        expect(preview.steps).toEqual([{ stepNumber: 1, instruction: 'Roast.', timerSeconds: 600 }]);
    });

    it('keeps a stored recipe`s photos, author and ratings, and takes everything the draft says from the draft', () => {
        const recipe = makeRecipeDetail({ id: 'rec_1', title: 'Old', ratingCount: 4, authorHandle: 'cook' });
        const preview = previewRecipeOf({ values: makeFilledRecipeFormValues({ title: 'New' }), recipe, now: NOW });

        expect(preview).toMatchObject({ id: 'rec_1', title: 'New', ratingCount: 4, authorHandle: 'cook' });
        expect(preview.photos).toBe(recipe.photos);
    });
});
