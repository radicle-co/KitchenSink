/**
 * Unit tests for the recipe create/edit form model (T067) — the pure layer both platform form leaves and
 * the app container share: default values, auto total-time, mapping form values → the CreateRecipeInput
 * wire contract, and validation (title, ≥1 fully-resolved ingredient, ≥1 step, positive servings).
 */
import { describe, expect, it } from 'vitest';

import { computeRecipeNutrition, RecipeDifficulty, RecipeStatus } from '@kitchensink/recipe-core';

import {
    canAdvanceFromStep,
    computeTotalTime,
    defaultRecipeFormValues,
    lineCalories,
    pendingIngredientIds,
    recipeNutritionTotal,
    setIngredientStatusById,
    stepErrorsFor,
    toCreateRecipeInput,
    toNutritionLine,
    toUpdateRecipeInput,
    validateRecipeForm,
    type RecipeFormIngredient,
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

    it('OMITS status when not given (the plain non-wizard save path never touches publication state)', () => {
        const input = toCreateRecipeInput(filledValues());

        expect(input.status).toBeUndefined();
        expect('status' in input).toBe(false);
    });

    it('carries a given status verbatim (draft or published)', () => {
        expect(toCreateRecipeInput(filledValues(), RecipeStatus.DRAFT).status).toBe('draft');
        expect(toCreateRecipeInput(filledValues(), RecipeStatus.PUBLISHED).status).toBe('published');
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

    it('OMITS status when not given — a plain update never flips draft/published as a side effect', () => {
        const input = toUpdateRecipeInput(filledValues());

        expect(input.status).toBeUndefined();
        expect('status' in input).toBe(false);
    });

    it('carries a given status verbatim (draft or published)', () => {
        expect(toUpdateRecipeInput(filledValues(), RecipeStatus.DRAFT).status).toBe('draft');
        expect(toUpdateRecipeInput(filledValues(), RecipeStatus.PUBLISHED).status).toBe('published');
    });
});

describe('validateRecipeForm', () => {
    it('passes a complete form', () => {
        expect(validateRecipeForm(filledValues())).toEqual({});
    });

    it('requires a title (returns the locale-agnostic code, not English copy)', () => {
        expect(validateRecipeForm(filledValues({ title: '   ' })).title).toBe('titleRequired');
    });

    it('requires at least one ingredient and one step', () => {
        expect(validateRecipeForm(filledValues({ ingredients: [] })).ingredients).toBe('ingredientsEmpty');
        expect(validateRecipeForm(filledValues({ steps: [] })).steps).toBe('stepsRequired');
    });

    it('flags an ingredient line that has not resolved to a catalog id', () => {
        const errors = validateRecipeForm(
            filledValues({ ingredients: [{ ingredientId: null, name: 'Kale', quantity: 1 }] }),
        );
        expect(errors.ingredients).toBe('ingredientsUnresolved');
    });

    it('requires positive servings and non-negative times', () => {
        expect(validateRecipeForm(filledValues({ servings: 0 })).servings).toBe('servingsPositive');
        expect(validateRecipeForm(filledValues({ prepTimeMinutes: -1 })).times).toBe('timesNonNegative');
    });
});

describe('stepErrorsFor / canAdvanceFromStep (W3 — the wizard field->step map)', () => {
    // The field->step map: step 1 = title/servings/times (the "Basic Info" fields validateRecipeForm can
    // flag — description/cuisine/tags/dietary/difficulty/visibility have no invalid state to flag); step 2 =
    // ingredients; step 3 = steps; step 4 = photos, decoupled from form validation entirely (always valid).

    it('step 1 surfaces ONLY title/servings/times errors, never ingredients/steps', () => {
        const values = filledValues({ title: '', servings: 0, ingredients: [], steps: [] });

        expect(stepErrorsFor(values, 1)).toEqual({ title: 'titleRequired', servings: 'servingsPositive' });
    });

    it('step 2 surfaces ONLY the ingredients error', () => {
        const values = filledValues({ title: '', ingredients: [] });

        expect(stepErrorsFor(values, 2)).toEqual({ ingredients: 'ingredientsEmpty' });
    });

    it('step 3 surfaces ONLY the steps error', () => {
        const values = filledValues({ title: '', steps: [] });

        expect(stepErrorsFor(values, 3)).toEqual({ steps: 'stepsRequired' });
    });

    it('step 4 (photos) is always empty — decoupled from form validation', () => {
        expect(stepErrorsFor(defaultRecipeFormValues(), 4)).toEqual({});
        expect(stepErrorsFor(filledValues(), 4)).toEqual({});
    });

    it('a fully valid form has no errors on any step', () => {
        const values = filledValues();

        expect(stepErrorsFor(values, 1)).toEqual({});
        expect(stepErrorsFor(values, 2)).toEqual({});
        expect(stepErrorsFor(values, 3)).toEqual({});
        expect(stepErrorsFor(values, 4)).toEqual({});
    });

    it('canAdvanceFromStep mirrors stepErrorsFor being empty', () => {
        const invalidTitle = filledValues({ title: '' });

        expect(canAdvanceFromStep(invalidTitle, 1)).toBe(false);
        expect(canAdvanceFromStep(filledValues(), 1)).toBe(true);
        expect(canAdvanceFromStep(filledValues({ ingredients: [] }), 2)).toBe(false);
        expect(canAdvanceFromStep(filledValues({ steps: [] }), 3)).toBe(false);
        // Step 4 is always advanceable — photos are decoupled from form validation.
        expect(canAdvanceFromStep(defaultRecipeFormValues(), 4)).toBe(true);
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

describe('toNutritionLine (E3 plumbing — form line -> the aggregator NutritionLine)', () => {
    const baseLine = (over: Partial<RecipeFormIngredient> = {}): RecipeFormIngredient => ({
        ingredientId: 'ing_1',
        name: 'Olive oil',
        quantity: 2,
        unit: 'tbsp',
        ...over,
    });

    it('maps the catalog per-100g branch (mass unit) with no user-override fields', () => {
        const line = baseLine({
            quantity: 300,
            unit: 'g',
            caloriesPer100g: 130,
            proteinGPer100g: 2.7,
            carbsGPer100g: 28,
            fatGPer100g: 0.3,
        });

        expect(toNutritionLine(line)).toEqual({
            quantity: 300,
            unit: 'g',
            caloriesPer100g: 130,
            proteinGPer100g: 2.7,
            carbsGPer100g: 28,
            fatGPer100g: 0.3,
        });
        // Round-trip through the real aggregator: 300g @ 130 cal/100g = 390 cal for this one line/serving.
        expect(computeRecipeNutrition([toNutritionLine(line)], 1)).toEqual({
            calories: 390,
            proteinG: 8.1,
            carbsG: 84,
            fatG: 0.9,
            isComplete: true,
        });
    });

    it('carries household portions so a volumetric/count unit converts through the real aggregator', () => {
        const line = baseLine({
            quantity: 2,
            unit: 'tablespoon',
            caloriesPer100g: 884,
            proteinGPer100g: 0,
            carbsGPer100g: 0,
            fatGPer100g: 100,
            portions: [{ unit: 'tablespoon', gramsPerUnit: 13.5 }],
        });

        expect(toNutritionLine(line).portions).toEqual([{ unit: 'tablespoon', gramsPerUnit: 13.5 }]);
        expect(computeRecipeNutrition([toNutritionLine(line)], 1).isComplete).toBe(true);
    });

    it('maps the freeform user-override branch, taking priority over any (absent) catalog data', () => {
        const line = baseLine({
            ingredientId: 'ing_free',
            name: 'Grandma’s spice mix',
            quantity: 1,
            unit: 'batch',
            userCalories: 45,
            userProteinG: 1,
            userCarbsG: 8,
            userFatG: 0.5,
        });

        expect(toNutritionLine(line)).toEqual({
            quantity: 1,
            unit: 'batch',
            userCalories: 45,
            userProteinG: 1,
            userCarbsG: 8,
            userFatG: 0.5,
        });
        expect(computeRecipeNutrition([toNutritionLine(line)], 1)).toEqual({
            calories: 45,
            proteinG: 1,
            carbsG: 8,
            fatG: 0.5,
            isComplete: true,
        });
    });

    it('maps an honestly-incomplete line (no user override, no resolved catalog nutrition) to isComplete: false', () => {
        // A freshly-picked line still PENDING catalog resolution, or a freeform line with no user nutrition yet.
        const line = baseLine({ resolutionStatus: 'PENDING' });

        expect(toNutritionLine(line)).toEqual({ quantity: 2, unit: 'tbsp' });
        expect(computeRecipeNutrition([toNutritionLine(line)], 1).isComplete).toBe(false);
    });

    it('degrades an absent unit to an empty string rather than guessing — unconvertible, honestly incomplete', () => {
        const line: RecipeFormIngredient = {
            ingredientId: 'ing_2',
            name: 'Eggs',
            quantity: 3,
            caloriesPer100g: 155,
        };

        const nutritionLine = toNutritionLine(line);

        expect(nutritionLine.unit).toBe('');
        expect(computeRecipeNutrition([nutritionLine], 1).isComplete).toBe(false);
    });
});

describe('lineCalories (w3/e3 — per-row calorie figure)', () => {
    const baseLine = (over: Partial<RecipeFormIngredient> = {}): RecipeFormIngredient => ({
        ingredientId: 'ing_1',
        name: 'Olive oil',
        quantity: 2,
        unit: 'tbsp',
        ...over,
    });

    it('returns the resolved catalog line calories — the SAME number the aggregator itself computes', () => {
        const line = baseLine({
            quantity: 300,
            unit: 'g',
            caloriesPer100g: 130,
            proteinGPer100g: 2.7,
            carbsGPer100g: 28,
            fatGPer100g: 0.3,
        });

        expect(lineCalories(line)).toBe(computeRecipeNutrition([toNutritionLine(line)], 1).calories);
        expect(lineCalories(line)).toBe(390);
    });

    it('returns the freeform user-entered calories verbatim, including an honest zero', () => {
        const line = baseLine({ ingredientId: 'ing_free', userCalories: 45, userProteinG: 1 });

        expect(lineCalories(line)).toBe(45);

        const zeroCalorieLine = baseLine({ ingredientId: 'ing_water', name: 'Water', userCalories: 0 });

        expect(lineCalories(zeroCalorieLine)).toBe(0);
    });

    it('returns undefined (never a fake 0) for a line still resolving (no catalog nutrition yet)', () => {
        const line = baseLine({ resolutionStatus: 'PENDING' });

        expect(lineCalories(line)).toBeUndefined();
    });

    it('returns undefined for a catalog line whose unit cannot convert to grams (no portions)', () => {
        const line = baseLine({ quantity: 1, unit: 'clove', caloriesPer100g: 149 });

        expect(lineCalories(line)).toBeUndefined();
    });

    it('returns undefined for a seeded-without-nutrition line (edit-mode gap, RESOLVED but no per-100g)', () => {
        // A line seeded from RecipeIngredientView (an existing recipe's ingredients), which does not carry
        // per-100g nutrition — resolutionStatus is 'RESOLVED' but there is still nothing to compute from.
        const line = baseLine({ resolutionStatus: 'RESOLVED' });

        expect(lineCalories(line)).toBeUndefined();
    });
});

describe('recipeNutritionTotal (w3/e3 — the running per-serving total, one aggregator, no second rule)', () => {
    it('matches computeRecipeNutrition run directly over the same mapped lines', () => {
        const values = filledValues({
            servings: 2,
            ingredients: [
                { ingredientId: 'ing_1', name: 'Arborio rice', quantity: 300, unit: 'g', caloriesPer100g: 130 },
                { ingredientId: 'ing_2', name: 'Salt', quantity: 5, unit: 'g', userCalories: 0 },
            ],
        });

        expect(recipeNutritionTotal(values)).toEqual(
            computeRecipeNutrition(values.ingredients.map(toNutritionLine), values.servings),
        );
    });

    it('sums complete lines to a definite total and flags isComplete: true when every line is accounted for', () => {
        const values = filledValues({
            servings: 1,
            ingredients: [
                {
                    ingredientId: 'ing_1',
                    name: 'Arborio rice',
                    quantity: 300,
                    unit: 'g',
                    caloriesPer100g: 130,
                    proteinGPer100g: 2.7,
                    carbsGPer100g: 28,
                    fatGPer100g: 0.3,
                },
                { ingredientId: 'ing_2', name: 'Custom spice', quantity: 1, userCalories: 30, userProteinG: 1 },
            ],
        });

        expect(recipeNutritionTotal(values)).toEqual({
            calories: 420,
            proteinG: 9.1,
            carbsG: 84,
            fatG: 0.9,
            isComplete: true,
        });
    });

    it('flags isComplete: false and still sums every ACCOUNTABLE line when one line cannot be computed', () => {
        const values = filledValues({
            servings: 1,
            ingredients: [
                { ingredientId: 'ing_1', name: 'Arborio rice', quantity: 300, unit: 'g', caloriesPer100g: 130 },
                // Still resolving — no catalog nutrition yet, no user override: excluded, never a fake 0.
                { ingredientId: 'ing_2', name: 'Stock', quantity: 1, unit: 'cup', resolutionStatus: 'PENDING' },
            ],
        });

        const total = recipeNutritionTotal(values);

        expect(total.isComplete).toBe(false);
        expect(total.calories).toBe(390); // the rice's contribution alone — the unresolved line is excluded.
    });

    it('returns a zero, complete total for an empty ingredient list (no lines to fail on)', () => {
        expect(recipeNutritionTotal(filledValues({ ingredients: [] }))).toEqual({
            calories: 0,
            proteinG: 0,
            carbsG: 0,
            fatG: 0,
            isComplete: true,
        });
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
