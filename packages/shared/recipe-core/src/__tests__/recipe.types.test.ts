import { describe, it, expect } from 'vitest';

import { isRecipeError, RecipeErrorCode } from '../index.js';
import type { RecipeError } from '../index.js';

describe('isRecipeError', () => {
    it('matches a structurally-valid RecipeError instance', () => {
        const error: RecipeError = {
            code: RecipeErrorCode.RECIPE_NOT_FOUND,
            message: 'Recipe not found',
        };

        expect(isRecipeError(error)).toBe(true);
    });

    it('matches a RecipeError carrying structured details', () => {
        const error: RecipeError = {
            code: RecipeErrorCode.VERSION_CONFLICT,
            message: 'Recipe version conflict',
            details: { currentVersion: 3, conflictingVersion: 2 },
        };

        expect(isRecipeError(error)).toBe(true);
    });

    it('accepts every known RecipeErrorCode', () => {
        for (const code of Object.values(RecipeErrorCode)) {
            expect(isRecipeError({ code, message: 'boom' })).toBe(true);
        }
    });

    it('rejects a plain Error (no domain code)', () => {
        expect(isRecipeError(new Error('kaboom'))).toBe(false);
    });

    it('rejects an object whose code is not a known RecipeErrorCode', () => {
        expect(isRecipeError({ code: 'NOT_A_REAL_CODE', message: 'nope' })).toBe(false);
    });

    it('rejects an object missing the message field', () => {
        expect(isRecipeError({ code: RecipeErrorCode.NOT_OWNER })).toBe(false);
    });

    it('rejects an object with an empty message', () => {
        expect(isRecipeError({ code: RecipeErrorCode.NOT_OWNER, message: '' })).toBe(false);
    });

    it('rejects null and undefined', () => {
        expect(isRecipeError(null)).toBe(false);
        expect(isRecipeError(undefined)).toBe(false);
    });

    it('rejects primitive and non-error values', () => {
        expect(isRecipeError('RECIPE_NOT_FOUND')).toBe(false);
        expect(isRecipeError(42)).toBe(false);
        expect(isRecipeError([])).toBe(false);
    });
});
