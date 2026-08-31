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
});
