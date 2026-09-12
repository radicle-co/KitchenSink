import { describe, expect, it } from 'vitest';

import type { RecipeWizardStep } from '../../form/steps.js';
import { defaultRecipeFormValues } from '../../form/values.js';
import {
    blockedAdvanceErrors,
    deriveRailStepState,
    firstStepWithErrors,
    gateOutcomeOf,
    nextStep,
    previousStep,
    recipeFormValuesEqual,
    stepAfterGate,
    WIZARD_STEPS,
    WIZARD_TOTAL_STEPS,
    type GateOutcome,
} from '../model.js';
import { withLineKeys } from '../../__fixtures__/index.js';

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
        const next = {
            ...base,
            ingredients: withLineKeys([{ ingredientId: 'ing_1', name: 'Salt', quantity: 1, isUserEntered: false }]),
        };
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

describe('firstStepWithErrors (where a refused save goes, `rowEditorOpenDecisions.md` R7)', () => {
    it.each([
        ['nothing refused', {}, undefined],
        ['a title only', { title: 'titleRequired' }, 1],
        ['pending text only', { ingredients: 'ingredientsPendingText' }, 2],
        ['steps only', { steps: 'stepsRequired' }, 3],
        [
            'pending text and a title: the earlier step',
            { title: 'titleRequired', ingredients: 'ingredientsPendingText' },
            1,
        ],
        [
            'pending text and steps: the earlier step',
            { steps: 'stepsRequired', ingredients: 'ingredientsPendingText' },
            2,
        ],
    ] as const)('%s', (_case, errors, step) => {
        expect(firstStepWithErrors(errors)).toBe(step);
    });

    it('a key present with no code is not an error', () => {
        expect(firstStepWithErrors({ title: undefined, steps: 'stepsRequired' })).toBe(3);
    });
});

describe('stepAfterGate (where the wizard stands once a gate has decided, R7)', () => {
    it.each<[string, GateOutcome, RecipeWizardStep]>([
        ['a refusal lands on the step that holds its first error', { kind: 'refused', errors: {}, step: 1 }, 1],
        ['a refusal no step owns leaves the cook where they are', { kind: 'refused', errors: {}, step: undefined }, 3],
        ['a gate that went ahead leaves the cook where they are', { kind: 'send' }, 3],
        ['a gate that waited on a command leaves the cook where they are', { kind: 'busy' }, 3],
    ])('%s', (_case, outcome, expected) => {
        expect(stepAfterGate(3, outcome)).toBe(expected);
    });
});

describe('gateOutcomeOf (what a save or Next gate decided, R7)', () => {
    it('no errors: send', () => {
        expect(gateOutcomeOf({})).toEqual({ kind: 'send' });
    });

    it('refused, with the errors and the first step holding one', () => {
        const errors = { steps: 'stepsRequired', ingredients: 'ingredientsPendingText' } as const;

        expect(gateOutcomeOf(errors)).toEqual({ kind: 'refused', errors, step: 2 });
    });

    it('⛔ an error no step owns is still refused; it moves nowhere rather than letting the save through', () => {
        const errors = { title: undefined };

        expect(gateOutcomeOf(errors)).toEqual({ kind: 'refused', errors, step: undefined });
    });
});
