import { describe, it, expect } from 'vitest';

import {
    ALLOWED_RECIPE_PHOTO_MIME_TYPES,
    collectionSchema,
    CUISINES,
    isRecipeError,
    MAX_RECIPE_PHOTO_UPLOAD_BYTES,
    RecipeErrorCode,
} from '../index.js';
import type { Collection, RecipeError } from '../index.js';

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

describe('CUISINES (w3/e5)', () => {
    it('is a non-empty readonly array of unique, non-blank strings', () => {
        expect(Array.isArray(CUISINES)).toBe(true);
        expect(CUISINES.length).toBeGreaterThan(0);

        for (const cuisine of CUISINES) {
            expect(typeof cuisine).toBe('string');
            expect(cuisine.trim().length).toBeGreaterThan(0);
        }

        expect(new Set(CUISINES).size).toBe(CUISINES.length);
    });
});

describe('collectionSchema (W5 collection-view wire fields)', () => {
    const baseWireCollection = {
        id: 'col_1',
        ownerId: 'usr_1',
        name: 'Weeknight dinners',
        createdAt: '2026-04-01T09:00:00.000Z',
        updatedAt: '2026-04-19T09:30:00.000Z',
    };

    it('accepts and returns a required `visibility` alongside an optional `recipeCount` (not stripped)', () => {
        const wire = { ...baseWireCollection, visibility: 'public', recipeCount: 5 };

        const parsed = collectionSchema.parse(wire);

        expect(parsed.visibility).toBe('public');
        expect(parsed.recipeCount).toBe(5);
    });

    it('accepts `visibility: "private"` with `recipeCount` absent (list reads omit it)', () => {
        const wire = { ...baseWireCollection, visibility: 'private' };

        const parsed = collectionSchema.parse(wire);

        expect(parsed.visibility).toBe('private');
        expect(parsed.recipeCount).toBeUndefined();
    });

    it('rejects a wire object missing `visibility` (the server always sends it)', () => {
        expect(() => collectionSchema.parse(baseWireCollection)).toThrow();
    });

    it('rejects a negative `recipeCount`', () => {
        const wire = { ...baseWireCollection, visibility: 'public', recipeCount: -1 };

        expect(() => collectionSchema.parse(wire)).toThrow();
    });

    it('rejects a non-integer `recipeCount`', () => {
        const wire = { ...baseWireCollection, visibility: 'public', recipeCount: 1.5 };

        expect(() => collectionSchema.parse(wire)).toThrow();
    });

    it('the inferred `Collection` type carries a required `visibility` and optional `recipeCount`', () => {
        // Compile-time proof: this object satisfies `Collection` only with `visibility` present and typed
        // as `RecipeVisibility`, and compiles fine with `recipeCount` omitted (proving it is optional).
        const collection: Collection = {
            ...baseWireCollection,
            visibility: 'private',
        };

        expect(collection.visibility).toBe('private');
        expect(collection.recipeCount).toBeUndefined();
    });
});

describe('recipe photo upload constants (REQ-009/REQ-011/REQ-012/REQ-013)', () => {
    it('the size bound is exactly 5 MB', () => {
        expect(MAX_RECIPE_PHOTO_UPLOAD_BYTES).toBe(5 * 1024 * 1024);
    });

    it('the MIME allowlist is exactly the three REQ-012/REQ-013 types the server can actually serve + thumbnail, in spec order', () => {
        // HEIC/HEIF are deliberately NOT in this list: the installed `sharp` build's `heif` codec decodes
        // AVIF only (no HEVC/H.265 decoder), so a real iPhone HEIC upload would pass magic-byte detection
        // but fail thumbnail generation — see this constant's own doc and specs/001-commise-recipe-app's
        // waivers.md WAV-001.
        expect(ALLOWED_RECIPE_PHOTO_MIME_TYPES).toEqual(['image/jpeg', 'image/png', 'image/webp']);
    });
});
