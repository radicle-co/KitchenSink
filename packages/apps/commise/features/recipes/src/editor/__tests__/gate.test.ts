/**
 * The publish gate's decision (build spec §7.8): any error refuses, and the refusal names the first section in page
 * order that holds one, which is where the cook is taken.
 */
import { describe, expect, it } from 'vitest';

import { makeRecipeFormValues } from '../../__fixtures__/index.js';
import {
    cuisineFieldId,
    descriptionFieldId,
    ingredientAddFieldId,
    ingredientNameFieldId,
    stepFieldId,
    titleFieldId,
} from '../../form/fieldIds.js';
import { errorsStillHolding, firstInvalidFieldOf, gateOutcomeOf, refusedFieldsOf } from '../gate.js';

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

    it('names the description field for a too-long description, after the title when both are refused', () => {
        expect(firstInvalidFieldOf({ description: 'descriptionTooLong' }, values)).toBe(descriptionFieldId);
        expect(firstInvalidFieldOf({ title: 'titleTooLong', description: 'descriptionTooLong' }, values)).toBe(
            titleFieldId,
        );
    });

    it('names the cuisine field for a missing or too-long cuisine, after the title and description (page order)', () => {
        expect(firstInvalidFieldOf({ cuisine: 'cuisineRequired' }, values)).toBe(cuisineFieldId);
        expect(firstInvalidFieldOf({ cuisine: 'cuisineTooLong' }, values)).toBe(cuisineFieldId);
        expect(firstInvalidFieldOf({ description: 'descriptionTooLong', cuisine: 'cuisineRequired' }, values)).toBe(
            descriptionFieldId,
        );
        expect(firstInvalidFieldOf({ cuisine: 'cuisineRequired', ingredients: 'ingredientsEmpty' }, values)).toBe(
            cuisineFieldId,
        );
    });

    it('names the add field for an empty list of ingredients and for text typed but not added', () => {
        expect(firstInvalidFieldOf({ ingredients: 'ingredientsEmpty' }, values)).toBe(ingredientAddFieldId);
        expect(firstInvalidFieldOf({ ingredients: 'ingredientsPendingText' }, values)).toBe(ingredientAddFieldId);
    });

    it('names the field that HOLDS the pending text: a row`s name field when a row holds it, the add field otherwise', () => {
        const row = ingredientNameFieldId('line-2');

        expect(firstInvalidFieldOf({ ingredients: 'ingredientsPendingText' }, values, row)).toBe(row);
        expect(firstInvalidFieldOf({ ingredients: 'ingredientsPendingText' }, values, ingredientAddFieldId)).toBe(
            ingredientAddFieldId,
        );
        // Only pending text points at the field that holds it: an empty list still points at the add field.
        expect(firstInvalidFieldOf({ ingredients: 'ingredientsEmpty' }, values, row)).toBe(ingredientAddFieldId);
        // No field holds text (the entry was cleared since): the add field, as before.
        expect(firstInvalidFieldOf({ ingredients: 'ingredientsPendingText' }, values, undefined)).toBe(
            ingredientAddFieldId,
        );
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

/**
 * A refused Publish records WHICH fields it refused; what each says is read from the draft and the entry as they are
 * now. A field the cook has fixed loses its error; one never refused never gains one before the next press.
 */
describe('refusedFieldsOf', () => {
    it('names the fields holding a code, and only those', () => {
        expect(refusedFieldsOf({ title: 'titleRequired', steps: undefined, cuisine: 'cuisineRequired' })).toEqual(
            new Set(['title', 'cuisine']),
        );
    });

    it('is empty for a form that passed', () => {
        expect(refusedFieldsOf({})).toEqual(new Set());
    });
});

describe('errorsStillHolding', () => {
    const complete = makeRecipeFormValues({ title: 'Nasi lemak', cuisine: 'Malaysian' });

    it('is empty when nothing was refused, however bad the draft is', () => {
        expect(errorsStillHolding(new Set(), makeRecipeFormValues({ title: '' }), '')).toEqual({});
    });

    it('drops a refused field the draft no longer fails', () => {
        const draft = makeRecipeFormValues({ title: 'Nasi lemak', cuisine: '' });

        expect(errorsStillHolding(new Set(['title', 'cuisine']), draft, '')).toMatchObject({
            cuisine: 'cuisineRequired',
        });
        expect(errorsStillHolding(new Set(['title', 'cuisine']), draft, '').title).toBeUndefined();
    });

    it('never gives a field an error the last refused press did not record', () => {
        expect(errorsStillHolding(new Set(['cuisine']), makeRecipeFormValues({ title: '' }), '').title).toBeUndefined();
    });

    it('states the reason the field fails NOW, not the one it failed with at the press', () => {
        const draft = makeRecipeFormValues({ title: 'x'.repeat(121) });

        expect(errorsStillHolding(new Set(['title']), draft, '').title).toBe('titleTooLong');
    });

    /**
     * ⛔ THE ENTRY TEXT IS READ LIVE. The press had text in the ingredient entry and was refused with
     * `ingredientsPendingText`; once the cook clears the entry the error must go, and when it is committed the draft's
     * own ingredients decide. Reading the press-time text kept the error until the next press.
     */
    it('clears ingredientsPendingText once the entry is empty, and reports what the draft says instead', () => {
        const refused = new Set<'ingredients'>(['ingredients']);

        expect(errorsStillHolding(refused, complete, 'flour').ingredients).toBe('ingredientsPendingText');
        expect(errorsStillHolding(refused, { ...complete, ingredients: [] }, '').ingredients).toBe('ingredientsEmpty');
        expect(errorsStillHolding(refused, complete, '   ').ingredients).not.toBe('ingredientsPendingText');
    });
});
