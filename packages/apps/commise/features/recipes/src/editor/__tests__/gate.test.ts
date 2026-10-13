/**
 * The publish gate's decision (build spec §7.8): any error refuses, and the refusal names the first section in page
 * order that holds one, which is where the cook is taken.
 */
import { describe, expect, it } from 'vitest';

import { makeRecipeFormValues } from '../../__fixtures__/index.js';
import { ingredientAddFieldId, stepFieldId, titleFieldId } from '../../form/fieldIds.js';
import { firstInvalidFieldOf, gateOutcomeOf } from '../gate.js';

describe('gateOutcomeOf', () => {
    it('sends when nothing refused', () => {
        expect(gateOutcomeOf({})).toEqual({ kind: 'send' });
    });

    it('refuses with the errors and the first section holding one', () => {
        const errors = { steps: 'stepsRequired', title: 'titleTooLong' } as const;

        expect(gateOutcomeOf(errors)).toEqual({ kind: 'refused', errors, section: 'details' });
    });

    it('refuses even an error no section owns, rather than letting it through', () => {
        // A key with no code is no error; a present code always refuses.
        expect(gateOutcomeOf({ title: undefined })).toEqual({ kind: 'send' });
    });
});

/**
 * E7 (build spec §7.8, WCAG 3.3.1): "Focus moves to the first invalid field." The refusal named the SECTION; the cook is
 * taken to the first field in page order that the validator refused, or to the section's heading when that error has no
 * single field to land on.
 */
describe('firstInvalidFieldOf', () => {
    const values = makeRecipeFormValues({
        steps: [{ instruction: 'Boil.' }, { instruction: '   ' }, { instruction: '' }],
    });

    it('is nothing when nothing was refused', () => {
        expect(firstInvalidFieldOf({}, values)).toBeUndefined();
    });

    it('names the title field for an empty or too-long title', () => {
        expect(firstInvalidFieldOf({ title: 'titleRequired' }, values)).toBe(titleFieldId);
        expect(firstInvalidFieldOf({ title: 'titleTooLong' }, values)).toBe(titleFieldId);
    });

    it('names the add field for an empty list of ingredients and for text typed but not added', () => {
        expect(firstInvalidFieldOf({ ingredients: 'ingredientsEmpty' }, values)).toBe(ingredientAddFieldId);
        expect(firstInvalidFieldOf({ ingredients: 'ingredientsPendingText' }, values)).toBe(ingredientAddFieldId);
    });

    it('names the FIRST step whose instruction the wire refuses, not the first step', () => {
        expect(firstInvalidFieldOf({ steps: 'stepsRequired' }, values)).toBe(stepFieldId(1));
    });

    it('has no field for an error with no single control: the section heading takes the cook', () => {
        expect(firstInvalidFieldOf({ ingredients: 'ingredientsUnresolved' }, values)).toBeUndefined();
        expect(firstInvalidFieldOf({ ingredients: 'ingredientsQuantityInvalid' }, values)).toBeUndefined();
        expect(firstInvalidFieldOf({ servings: 'servingsPositive' }, values)).toBeUndefined();
        expect(firstInvalidFieldOf({ times: 'timesNonNegative' }, values)).toBeUndefined();
        expect(firstInvalidFieldOf({ steps: 'stepsRequired' }, makeRecipeFormValues({ steps: [] }))).toBeUndefined();
    });

    it('takes the first in PAGE order when several are refused', () => {
        const errors = { steps: 'stepsRequired', ingredients: 'ingredientsEmpty', title: 'titleRequired' } as const;

        expect(firstInvalidFieldOf(errors, values)).toBe(titleFieldId);
        expect(firstInvalidFieldOf({ steps: errors.steps, ingredients: errors.ingredients }, values)).toBe(
            ingredientAddFieldId,
        );
    });

    it('skips an error with no field and goes on to the next one that has one', () => {
        expect(firstInvalidFieldOf({ servings: 'servingsPositive', steps: 'stepsRequired' }, values)).toBe(
            stepFieldId(1),
        );
    });
});
