/**
 * Unit tests for the draft shape's blank instance (`form/values.ts`).
 *
 * ⚠️ These 1 describe blocks came from `model.test.ts`, which covered all of `form/model.ts`
 * before it was split into one module per concern. No assertion was changed, added or dropped in the
 * move — the suite is redistributed, not rewritten.
 */
import { describe, expect, it } from 'vitest';
import { defaultRecipeFormValues } from '../values.js';

describe('defaultRecipeFormValues', () => {
    it('starts empty and public with no ingredients or steps', () => {
        const v = defaultRecipeFormValues();
        expect(v.title).toBe('');
        expect(v.ingredients).toEqual([]);
        expect(v.steps).toEqual([]);
        expect(v.visibility).toBe('public');
    });
});
