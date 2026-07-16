/**
 * Unit tests for the recipe create/edit form model (T067) — the pure layer both platform form leaves and
 * the app container share: default values, auto total-time, mapping form values → the CreateRecipeInput
 * wire contract, and validation (title, ≥1 fully-resolved ingredient, ≥1 step, positive servings).
 */
import { describe, expect, it } from 'vitest';

import { RecipeDifficulty } from '@kitchensink/recipe-core';

import { makeIngredientView, makeRecipeDetail, makeStepView } from '../../__fixtures__/index.js';
import {
    applyDraftToRecipeDetail,
    computeTotalTime,
    defaultRecipeFormValues,
    pendingIngredientIds,
    setIngredientStatusById,
    toCreateRecipeInput,
    toUpdateRecipeInput,
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

    it('carries a stated difficulty', () => {
        expect(toCreateRecipeInput(filledValues({ difficulty: RecipeDifficulty.HARD })).difficulty).toBe('hard');
        expect(toCreateRecipeInput(filledValues({ difficulty: RecipeDifficulty.EASY })).difficulty).toBe('easy');
    });

    it('OMITS difficulty when not stated — create has no clear sentinel, so it must never send null', () => {
        const input = toCreateRecipeInput(filledValues());

        // Mutation guard: `null` (the update clear) is illegal on create; absence must be a true omit.
        expect(input.difficulty).toBeUndefined();
        expect('difficulty' in input).toBe(false);
    });
});

describe('toUpdateRecipeInput (three-state difficulty)', () => {
    it('carries a stated difficulty (set on an update)', () => {
        expect(toUpdateRecipeInput(filledValues({ difficulty: RecipeDifficulty.MEDIUM })).difficulty).toBe('medium');
    });

    it('carries the NEW value when an edit changes difficulty', () => {
        // Form seeded from medium, user picks hard → the update asserts the new value.
        expect(toUpdateRecipeInput(filledValues({ difficulty: RecipeDifficulty.HARD })).difficulty).toBe('hard');
    });

    it('sends explicit null to CLEAR when an edit removes a previously-set difficulty', () => {
        // The edit form loaded a difficulty, the user chose "not stated" → the field is absent. This is the
        // crux: it MUST become an explicit `null` clear, NOT an omit (omit = unchanged = cannot clear).
        const input = toUpdateRecipeInput(filledValues());

        expect(input.difficulty).toBeNull();
        expect('difficulty' in input).toBe(true);
    });

    it('mirrors create for every non-difficulty field', () => {
        const values = filledValues({ description: 'Creamy.', cuisine: 'Italian', difficulty: RecipeDifficulty.EASY });
        const { difficulty: _updateDifficulty, ...updateRest } = toUpdateRecipeInput(values);
        const { difficulty: _createDifficulty, ...createRest } = toCreateRecipeInput(values);

        expect(updateRest).toEqual(createRest);
    });

    it('diverges from create ONLY on the not-stated case: create omits, update clears with null', () => {
        // The one behavioral difference between the two mappers, pinned so neither drifts onto the other.
        expect('difficulty' in toCreateRecipeInput(filledValues())).toBe(false);
        expect(toUpdateRecipeInput(filledValues()).difficulty).toBeNull();
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

    it('reflects the draft difficulty over the base', () => {
        const withDifficulty = makeRecipeDetail({ difficulty: RecipeDifficulty.EASY });

        const result = applyDraftToRecipeDetail(withDifficulty, filledValues({ difficulty: RecipeDifficulty.HARD }));

        expect(result.difficulty).toBe('hard');
    });

    it('reflects a CLEARED draft difficulty as absent, not the stale base value', () => {
        // Base carries a difficulty; the draft cleared it. Mutation guard: a plain `...base` spread would
        // leak the stale server difficulty into "mine".
        const withDifficulty = makeRecipeDetail({ difficulty: RecipeDifficulty.HARD });

        const result = applyDraftToRecipeDetail(withDifficulty, filledValues());

        expect(result.difficulty).toBeUndefined();
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

describe('pendingIngredientIds (poll-after-add: which lines still resolve)', () => {
    it('returns only the catalog ids of PENDING lines, de-duplicated', () => {
        const values = filledValues({
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
        const values = filledValues({
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
        filledValues({
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
