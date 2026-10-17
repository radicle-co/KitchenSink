/**
 * Unit tests for the draft shape's blank instance (`form/values.ts`).
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
