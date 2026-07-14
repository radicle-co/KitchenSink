/**
 * Unit tests for the pure `toRecipeFormValues` mapper (mobile edit flow). Runs under the node config (no
 * DOM). Asserts every field the editor seeds from a loaded recipe, including the optional-field OMISSION
 * (not `undefined`) that keeps the result valid under `exactOptionalPropertyTypes`, and the `RESOLVED`
 * marking that lets a saved recipe's lines pass the form's validation.
 */
import { describe, expect, it } from 'vitest';

import { toRecipeFormValues } from '../../src/screens/toRecipeFormValues.js';
import { makeIngredientView, makeRecipeDetail, makeStepView } from '../__fixtures__/recipes.js';

describe('toRecipeFormValues', () => {
    it('maps the scalar recipe fields onto the form values', () => {
        const detail = makeRecipeDetail({
            title: 'Weeknight Pasta',
            description: 'Fast and cozy.',
            cuisine: 'Italian',
            tags: ['dinner'],
            dietaryFlags: ['vegetarian'],
            servings: 4,
            prepTimeMinutes: 10,
            cookTimeMinutes: 20,
            visibility: 'public',
        });

        const values = toRecipeFormValues(detail);

        expect(values.title).toBe('Weeknight Pasta');
        expect(values.description).toBe('Fast and cozy.');
        expect(values.cuisine).toBe('Italian');
        expect(values.tags).toEqual(['dinner']);
        expect(values.dietaryFlags).toEqual(['vegetarian']);
        expect(values.servings).toBe(4);
        expect(values.prepTimeMinutes).toBe(10);
        expect(values.cookTimeMinutes).toBe(20);
        expect(values.visibility).toBe('public');
    });

    it('carries an empty description through and coerces an absent cuisine to an empty string', () => {
        const values = toRecipeFormValues(makeRecipeDetail({ description: '' }));

        expect(values.description).toBe('');
        expect(values.cuisine).toBe('');
    });

    it('maps ingredient lines, preserving the catalog id and marking each resolved', () => {
        const detail = makeRecipeDetail({
            ingredients: [makeIngredientView({ ingredientId: 'ing_9', name: 'Basil', quantity: 3, unit: 'leaves' })],
        });

        const values = toRecipeFormValues(detail);

        expect(values.ingredients).toEqual([
            { ingredientId: 'ing_9', name: 'Basil', quantity: 3, resolutionStatus: 'RESOLVED', unit: 'leaves' },
        ]);
    });

    it('omits an absent unit rather than setting it to undefined', () => {
        const detail = makeRecipeDetail({
            ingredients: [makeIngredientView({ ingredientId: 'ing_1', name: 'Salt', quantity: 1, unit: undefined })],
        });

        const [line] = toRecipeFormValues(detail).ingredients;

        expect(line).toBeDefined();
        expect('unit' in (line as object)).toBe(false);
    });

    it('maps steps and carries a timer only when the source step has one', () => {
        const detail = makeRecipeDetail({
            steps: [
                makeStepView({ stepNumber: 1, instruction: 'Boil water', timerSeconds: 120 }),
                makeStepView({ stepNumber: 2, instruction: 'Add pasta' }),
            ],
        });

        const values = toRecipeFormValues(detail);

        expect(values.steps).toEqual([{ instruction: 'Boil water', timerSeconds: 120 }, { instruction: 'Add pasta' }]);
    });
});
