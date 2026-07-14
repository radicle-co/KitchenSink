/**
 * Unit tests for the recipe create/edit form model (T067) — the pure layer both platform form leaves and
 * the app container share: default values, auto total-time, mapping form values → the CreateRecipeInput
 * wire contract, and validation (title, ≥1 fully-resolved ingredient, ≥1 step, positive servings).
 */
import { describe, expect, it } from 'vitest';

import { makeIngredientView, makeRecipeDetail, makeStepView } from '../../__fixtures__/index.js';
import {
    applyDraftToRecipeDetail,
    computeTotalTime,
    defaultRecipeFormValues,
    toCreateRecipeInput,
    validateRecipeForm,
    type RecipeFormValues,
} from '../model.js';

const filledValues = (over: Partial<RecipeFormValues> = {}): RecipeFormValues => ({
    ...defaultRecipeFormValues(),
    title: 'Herb Risotto',
    servings: 4,
    prepTimeMinutes: 10,
    cookTimeMinutes: 25,
    ingredients: [{ ingredientId: 'ing_1', name: 'Arborio rice', quantity: 300, unit: 'g' }],
    steps: [{ instruction: 'Toast the rice.' }],
    ...over,
});

describe('computeTotalTime', () => {
    it('sums prep + cook', () => {
        expect(computeTotalTime(10, 25)).toBe(35);
        expect(computeTotalTime(0, 0)).toBe(0);
    });
});

describe('defaultRecipeFormValues', () => {
    it('starts empty and public with no ingredients or steps', () => {
        const v = defaultRecipeFormValues();
        expect(v.title).toBe('');
        expect(v.ingredients).toEqual([]);
        expect(v.steps).toEqual([]);
        expect(v.visibility).toBe('public');
    });
});

describe('toCreateRecipeInput', () => {
    it('maps form values to the wire contract with auto total time', () => {
        const input = toCreateRecipeInput(
            filledValues({ description: 'Creamy.', cuisine: 'Italian', tags: ['dinner'] }),
        );
        expect(input.title).toBe('Herb Risotto');
        expect(input.description).toBe('Creamy.');
        expect(input.cuisine).toBe('Italian');
        expect(input.tags).toEqual(['dinner']);
        expect(input.totalTimeMinutes).toBe(35);
        expect(input.ingredients).toEqual([{ ingredientId: 'ing_1', name: 'Arborio rice', quantity: 300, unit: 'g' }]);
        expect(input.steps).toEqual([{ instruction: 'Toast the rice.' }]);
    });

    it('omits empty optional strings and drops unresolved ingredient lines (no ingredientId)', () => {
        const input = toCreateRecipeInput(
            filledValues({
                description: '',
                cuisine: '',
                ingredients: [
                    { ingredientId: 'ing_1', name: 'Rice', quantity: 1, unit: 'cup' },
                    { ingredientId: null, name: 'Pending food', quantity: 1 },
                ],
            }),
        );
        expect(input.description).toBeUndefined();
        expect(input.cuisine).toBeUndefined();
        expect(input.ingredients).toHaveLength(1);
        expect(input.ingredients[0]?.ingredientId).toBe('ing_1');
    });

    it('includes a step timer only when set', () => {
        const input = toCreateRecipeInput(
            filledValues({ steps: [{ instruction: 'Rest.', timerSeconds: 600 }, { instruction: 'Serve.' }] }),
        );
        expect(input.steps[0]).toEqual({ instruction: 'Rest.', timerSeconds: 600 });
        expect(input.steps[1]).toEqual({ instruction: 'Serve.' });
    });
});

describe('applyDraftToRecipeDetail', () => {
    // The in-progress draft projected onto a base RecipeDetail so the conflict view (T070) can show
    // "mine" (the edit you were about to save) beside "theirs" (the latest saved recipe). The view renders
    // only aggregate fields — title, servings, prep/cook/total times, and ingredient/step counts.

    const base = makeRecipeDetail({
        id: 'rec_1',
        title: 'Server Title',
        servings: 2,
        prepTimeMinutes: 5,
        cookTimeMinutes: 5,
        totalTimeMinutes: 10,
        ingredients: [makeIngredientView(), makeIngredientView()],
        steps: [makeStepView()],
    });

    it('overlays the draft scalars and recomputes total time', () => {
        const result = applyDraftToRecipeDetail(
            base,
            filledValues({ title: 'My Draft', servings: 6, prepTimeMinutes: 12, cookTimeMinutes: 18 }),
        );

        expect(result.title).toBe('My Draft');
        expect(result.servings).toBe(6);
        expect(result.prepTimeMinutes).toBe(12);
        expect(result.cookTimeMinutes).toBe(18);
        expect(result.totalTimeMinutes).toBe(30);
    });

    it('reflects the draft ingredient and step counts (mapped to view rows)', () => {
        const result = applyDraftToRecipeDetail(
            base,
            filledValues({
                ingredients: [
                    { ingredientId: 'ing_1', name: 'Rice', quantity: 1, unit: 'cup' },
                    { ingredientId: 'ing_2', name: 'Stock', quantity: 500, unit: 'ml' },
                ],
                steps: [{ instruction: 'Toast.' }, { instruction: 'Simmer.' }, { instruction: 'Serve.' }],
            }),
        );

        expect(result.ingredients).toHaveLength(2);
        expect(result.steps).toHaveLength(3);
        expect(result.ingredients[0]).toMatchObject({ ingredientId: 'ing_1', name: 'Rice', quantity: 1, unit: 'cup' });
        expect(result.steps[2]).toMatchObject({ stepNumber: 3, instruction: 'Serve.' });
    });

    it('drops unresolved ingredient lines so the count matches what will actually save', () => {
        const result = applyDraftToRecipeDetail(
            base,
            filledValues({
                ingredients: [
                    { ingredientId: 'ing_1', name: 'Rice', quantity: 1 },
                    { ingredientId: null, name: 'Pending', quantity: 1 },
                ],
            }),
        );

        expect(result.ingredients).toHaveLength(1);
        expect(result.ingredients).toHaveLength(
            toCreateRecipeInput(
                filledValues({
                    ingredients: [
                        { ingredientId: 'ing_1', name: 'Rice', quantity: 1 },
                        { ingredientId: null, name: 'Pending', quantity: 1 },
                    ],
                }),
            ).ingredients.length,
        );
    });

    it('preserves base identity + fields the conflict view never reads (id, photos, nutrition)', () => {
        const result = applyDraftToRecipeDetail(base, filledValues());

        expect(result.id).toBe('rec_1');
        expect(result.photos).toBe(base.photos);
        expect(result.nutrition).toBe(base.nutrition);
    });
});

describe('validateRecipeForm', () => {
    it('passes a complete form', () => {
        expect(validateRecipeForm(filledValues())).toEqual({});
    });

    it('requires a title', () => {
        expect(validateRecipeForm(filledValues({ title: '   ' })).title).toBeDefined();
    });

    it('requires at least one ingredient and one step', () => {
        expect(validateRecipeForm(filledValues({ ingredients: [] })).ingredients).toBeDefined();
        expect(validateRecipeForm(filledValues({ steps: [] })).steps).toBeDefined();
    });

    it('flags an ingredient line that has not resolved to a catalog id', () => {
        const errors = validateRecipeForm(
            filledValues({ ingredients: [{ ingredientId: null, name: 'Kale', quantity: 1 }] }),
        );
        expect(errors.ingredients).toBeDefined();
    });

    it('requires positive servings and non-negative times', () => {
        expect(validateRecipeForm(filledValues({ servings: 0 })).servings).toBeDefined();
        expect(validateRecipeForm(filledValues({ prepTimeMinutes: -1 })).times).toBeDefined();
    });
});
