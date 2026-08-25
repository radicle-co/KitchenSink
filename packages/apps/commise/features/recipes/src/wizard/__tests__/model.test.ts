import { describe, expect, it } from 'vitest';

import { defaultRecipeFormValues, type RecipeWizardStep } from '../../form/model.js';
import {
    blockedAdvanceErrors,
    deriveRailStepState,
    nextStep,
    previousStep,
    recipeFormValuesEqual,
    WIZARD_STEPS,
    WIZARD_TOTAL_STEPS,
} from '../model.js';

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

describe('step adjacency (U33 — the rail owns adjacency, not the two platform leaves)', () => {
    it('has no step before the first', () => {
        expect(previousStep(1)).toBeNull();
    });

    it('has no step after the last', () => {
        expect(nextStep(4)).toBeNull();
    });

    it('walks forward and back through every interior step', () => {
        expect(nextStep(1)).toBe(2);
        expect(nextStep(2)).toBe(3);
        expect(nextStep(3)).toBe(4);
        expect(previousStep(4)).toBe(3);
        expect(previousStep(3)).toBe(2);
        expect(previousStep(2)).toBe(1);
    });

    it('round-trips: every step but the last is its own next step’s previous', () => {
        for (const step of WIZARD_STEPS) {
            const forward: RecipeWizardStep | null = nextStep(step);

            if (forward !== null) {
                expect(previousStep(forward)).toBe(step);
            }
        }
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

describe('blockedAdvanceErrors', () => {
    it('is empty while the step has not been attempted, even when it has errors', () => {
        expect(blockedAdvanceErrors(false, { ingredients: 'ingredientsEmpty' })).toEqual([]);
    });

    it('is empty for an attempted step that is valid', () => {
        expect(blockedAdvanceErrors(true, {})).toEqual([]);
    });

    it('reports the attempted step’s blocking code — the reason `Next` refused to advance', () => {
        expect(blockedAdvanceErrors(true, { ingredients: 'ingredientsEmpty' })).toEqual(['ingredientsEmpty']);
    });

    it('reports every distinct code when one step has several invalid fields', () => {
        expect(
            blockedAdvanceErrors(true, {
                title: 'titleRequired',
                servings: 'servingsPositive',
                times: 'timesNonNegative',
            }),
        ).toEqual(['titleRequired', 'servingsPositive', 'timesNonNegative']);
    });

    it('never repeats a sentence when two fields carry the SAME code', () => {
        expect(blockedAdvanceErrors(true, { servings: 'servingsPositive', times: 'servingsPositive' })).toEqual([
            'servingsPositive',
        ]);
    });
});
