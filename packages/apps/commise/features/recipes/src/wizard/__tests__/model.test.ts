import { describe, expect, it } from 'vitest';

import { defaultRecipeFormValues } from '../../form/model.js';
import { deriveRailStepState, recipeFormValuesEqual, WIZARD_STEPS, WIZARD_TOTAL_STEPS } from '../model.js';

describe('WIZARD_STEPS', () => {
    it('is the 4 steps in order', () => {
        expect(WIZARD_STEPS).toEqual([1, 2, 3, 4]);
        expect(WIZARD_TOTAL_STEPS).toBe(4);
    });
});

describe('deriveRailStepState', () => {
    it('flags an ATTEMPTED step with errors as invalid, even when it is the current step', () => {
        expect(deriveRailStepState({ step: 2, currentStep: 2, attempted: true, hasErrors: true })).toBe('invalid');
    });

    it('does NOT flag an unattempted step as invalid even when it currently has errors', () => {
        expect(deriveRailStepState({ step: 3, currentStep: 1, attempted: false, hasErrors: true })).toBe('upcoming');
    });

    it('reports the active step as current when not invalid', () => {
        expect(deriveRailStepState({ step: 2, currentStep: 2, attempted: false, hasErrors: false })).toBe('current');
        expect(deriveRailStepState({ step: 2, currentStep: 2, attempted: true, hasErrors: false })).toBe('current');
    });

    it('reports an earlier step as completed and a later step as upcoming', () => {
        expect(deriveRailStepState({ step: 1, currentStep: 3, attempted: false, hasErrors: false })).toBe('completed');
        expect(deriveRailStepState({ step: 4, currentStep: 3, attempted: false, hasErrors: false })).toBe('upcoming');
    });

    it('flags a COMPLETED (earlier) step invalid when it was attempted and is still broken', () => {
        // e.g. a Publish attempt marks every step attempted; step 2 (behind the current step 4) is invalid.
        expect(deriveRailStepState({ step: 2, currentStep: 4, attempted: true, hasErrors: true })).toBe('invalid');
    });
});

describe('recipeFormValuesEqual', () => {
    it('is true for two values built the same way', () => {
        expect(recipeFormValuesEqual(defaultRecipeFormValues(), defaultRecipeFormValues())).toBe(true);
    });

    it('is false when a field differs', () => {
        const base = defaultRecipeFormValues();
        expect(recipeFormValuesEqual(base, { ...base, title: 'Changed' })).toBe(false);
    });

    it('is false when an array field differs', () => {
        const base = defaultRecipeFormValues();
        const next = { ...base, ingredients: [{ ingredientId: 'ing_1', name: 'Salt', quantity: 1 }] };
        expect(recipeFormValuesEqual(base, next)).toBe(false);
    });

    it('is true for two values that are the same reference', () => {
        const base = defaultRecipeFormValues();
        expect(recipeFormValuesEqual(base, base)).toBe(true);
    });
});
