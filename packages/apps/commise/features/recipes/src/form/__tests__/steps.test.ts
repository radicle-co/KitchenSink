/**
 * Unit tests for the wizard field->step map (`form/steps.ts`).
 *
 * ⚠️ These 1 describe blocks came from `model.test.ts`, which covered all of `form/model.ts`
 * before it was split into one module per concern. No assertion was changed, added or dropped in the
 * move — the suite is redistributed, not rewritten.
 */
import { describe, expect, it } from 'vitest';

import { makeFilledRecipeFormValues } from '../../__fixtures__/index.js';
import { canAdvanceFromStep, stepErrorsFor } from '../steps.js';
import { validateRecipeForm } from '../validate.js';
import { defaultRecipeFormValues } from '../values.js';

describe('stepErrorsFor / canAdvanceFromStep (W3 — the wizard field->step map)', () => {
    // The field->step map (U33 step model): step 1 = Details — title/servings/times (the fields
    // `validateRecipeForm` can flag; description/cuisine/tags/dietary/difficulty/mealType/visibility/PHOTOS
    // have no invalid state to flag, and photos now live on this step); step 2 = Ingredients; step 3 =
    // Instructions; step 4 = REVIEW, which renders the draft read-only and owns no field of its own.

    it('step 1 (Details) surfaces ONLY title/servings/times errors, never ingredients/steps', () => {
        const values = makeFilledRecipeFormValues({ title: '', servings: 0, ingredients: [], steps: [] });

        expect(stepErrorsFor(values, 1)).toEqual({ title: 'titleRequired', servings: 'servingsPositive' });
    });

    it('step 2 surfaces ONLY the ingredients error', () => {
        const values = makeFilledRecipeFormValues({ title: '', ingredients: [] });

        expect(stepErrorsFor(values, 2)).toEqual({ ingredients: 'ingredientsEmpty' });
    });

    it('step 3 surfaces ONLY the steps error', () => {
        const values = makeFilledRecipeFormValues({ title: '', steps: [] });

        expect(stepErrorsFor(values, 3)).toEqual({ steps: 'stepsRequired' });
    });

    // REWRITTEN for the U33 step model: this used to read "step 4 (photos)". Step 4 is now REVIEW, and the
    // reason it carries no errors changed with it — it is not that photos are decoupled from validation, it
    // is that Review owns no field at all. The gate a cook meets on Review is `Publish`'s WHOLE-form
    // `validateRecipeForm`, which is a different question from "may I leave this step".
    it('step 4 (Review) surfaces no errors of its own — it owns no field', () => {
        expect(stepErrorsFor(defaultRecipeFormValues(), 4)).toEqual({});
        expect(stepErrorsFor(makeFilledRecipeFormValues(), 4)).toEqual({});
    });

    it('Review stays reachable and leavable even while an EARLIER step is invalid', () => {
        // Free rail navigation is the wizard's, but the step gate must not invent a blocker on Review: a
        // draft with no ingredients is invalid on step 2 and still says nothing about step 4.
        const values = makeFilledRecipeFormValues({ ingredients: [], steps: [] });

        expect(stepErrorsFor(values, 4)).toEqual({});
        expect(canAdvanceFromStep(values, 4)).toBe(true);
    });

    it('photos are NOT a validation input on any step (U33 — they moved into Details)', () => {
        // A draft carrying photos and one carrying none must validate identically, on every step: photos
        // upload independently of the metadata save and can never block an advance or a publish.
        const withPhotos = makeFilledRecipeFormValues({
            photos: [{ localId: 'local-1', fileName: 'a.png', contentType: 'image/png', fileSize: 10 }],
        });

        for (const step of [1, 2, 3, 4] as const) {
            expect(stepErrorsFor(withPhotos, step)).toEqual(stepErrorsFor(makeFilledRecipeFormValues(), step));
        }

        expect(validateRecipeForm(withPhotos)).toEqual(validateRecipeForm(makeFilledRecipeFormValues()));
    });

    it('a fully valid form has no errors on any step', () => {
        const values = makeFilledRecipeFormValues();

        expect(stepErrorsFor(values, 1)).toEqual({});
        expect(stepErrorsFor(values, 2)).toEqual({});
        expect(stepErrorsFor(values, 3)).toEqual({});
        expect(stepErrorsFor(values, 4)).toEqual({});
    });

    it('canAdvanceFromStep mirrors stepErrorsFor being empty', () => {
        const invalidTitle = makeFilledRecipeFormValues({ title: '' });

        expect(canAdvanceFromStep(invalidTitle, 1)).toBe(false);
        expect(canAdvanceFromStep(makeFilledRecipeFormValues(), 1)).toBe(true);
        expect(canAdvanceFromStep(makeFilledRecipeFormValues({ ingredients: [] }), 2)).toBe(false);
        expect(canAdvanceFromStep(makeFilledRecipeFormValues({ steps: [] }), 3)).toBe(false);
        // Step 4 (Review) is always advanceable — it owns no field to be invalid.
        expect(canAdvanceFromStep(defaultRecipeFormValues(), 4)).toBe(true);
    });
});
