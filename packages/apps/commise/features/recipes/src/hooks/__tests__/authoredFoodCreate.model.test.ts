/**
 * U16 — the create-your-own-food model's pure half: draft validation against the PUBLISHED bounds
 * (composed from the food service's own schema), with field errors as localizable keys.
 */
import { describe, expect, it } from 'vitest';

import { draftFromQuery, validateAuthoredFoodDraft, type AuthoredFoodDraft } from '../authoredFoodCreate.model.js';

function draft(overrides: Partial<AuthoredFoodDraft> = {}): AuthoredFoodDraft {
    return { name: 'Grandma Blend', calories: '100', proteinG: '10', carbsG: '20', fatG: '5', ...overrides };
}

describe('draftFromQuery', () => {
    it('prefills the name from the typed query — the affordance keeps the cook’s words', () => {
        expect(draftFromQuery('grandma blend').name).toBe('grandma blend');
        expect(draftFromQuery('grandma blend').calories).toBe('');
    });
});

describe('validateAuthoredFoodDraft', () => {
    it('parses a complete draft into the wire request', () => {
        const result = validateAuthoredFoodDraft(draft());

        expect(result.ok).toBe(true);

        if (result.ok) {
            expect(result.value).toEqual({
                name: 'Grandma Blend',
                macros: { calories: 100, proteinG: 10, carbsG: 20, fatG: 5 },
            });
        }
    });

    it('an empty name and empty macros report `required` per field', () => {
        const result = validateAuthoredFoodDraft(draft({ name: '  ', calories: '', fatG: ' ' }));

        expect(result.ok).toBe(false);

        if (!result.ok) {
            expect(result.fieldErrors).toEqual({ name: 'required', calories: 'required', fatG: 'required' });
        }
    });

    it('a non-numeric macro reports `not_a_number`', () => {
        const result = validateAuthoredFoodDraft(draft({ proteinG: 'lots' }));

        expect(result.ok).toBe(false);

        if (!result.ok) {
            expect(result.fieldErrors).toEqual({ proteinG: 'not_a_number' });
        }
    });

    it('the PUBLISHED bounds decide range — a macro over 100g/100g is `out_of_range`', () => {
        const result = validateAuthoredFoodDraft(draft({ carbsG: '150' }));

        expect(result.ok).toBe(false);

        if (!result.ok) {
            expect(result.fieldErrors).toEqual({ carbsG: 'out_of_range' });
        }
    });

    it('negative numbers are out of range too — the schema’s min(0), not a local re-statement', () => {
        const result = validateAuthoredFoodDraft(draft({ calories: '-5' }));

        expect(result.ok).toBe(false);

        if (!result.ok) {
            expect(result.fieldErrors).toEqual({ calories: 'out_of_range' });
        }
    });

    /**
     * ⛔ RANGE AND PRESENCE ARE DECIDED IN THE SAME PASS — the regression this file exists to pin.
     *
     * Validation used to run every presence/number check first and RETURN before the range authority ever
     * ran, so the one field the cook actually got wrong said NOTHING while the three they had not reached
     * yet each said `Required`. The out-of-range field only named itself on a SECOND submit, after every
     * other field was already correct — "inline validation renders per field" was true of two of the three
     * verdicts and silently false of the third.
     *
     * The bounds are still the published schema's; what changed is that each field is asked about its OWN
     * value rather than the whole object being asked once, at the end, about all of them.
     */
    it('⛔ names an out-of-range field even while OTHER fields are still empty', () => {
        const result = validateAuthoredFoodDraft(draft({ calories: '', proteinG: '', carbsG: '150', fatG: '' }));

        expect(result.ok).toBe(false);

        if (!result.ok) {
            expect(result.fieldErrors).toEqual({
                calories: 'required',
                proteinG: 'required',
                carbsG: 'out_of_range',
                fatG: 'required',
            });
        }
    });

    it('the same holds for the NAME’s own bound — a too-long name is named beside empty macros', () => {
        // 1,000 characters is past any name bound the published schema could plausibly carry; the BOUND is
        // still the schema's, which is why this asserts the `out_of_range` KEY and never a number.
        const result = validateAuthoredFoodDraft(draft({ name: 'x'.repeat(1_000), calories: '', proteinG: '2' }));

        expect(result.ok).toBe(false);

        if (!result.ok) {
            expect(result.fieldErrors).toEqual({ name: 'out_of_range', calories: 'required' });
        }
    });
});
