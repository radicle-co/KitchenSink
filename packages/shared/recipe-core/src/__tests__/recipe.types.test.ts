import { describe, it, expect } from 'vitest';

import {
    ALLOWED_RECIPE_PHOTO_MIME_TYPES,
    collectionSchema,
    CUISINES,
    isRecipeError,
    MAX_RECIPE_PHOTO_UPLOAD_BYTES,
    recipeErrorCodeSchema,
    recipeVersionSchema,
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

describe('recipeVersionSchema — the version-history read contract', () => {
    const RECIPE_ID = '11111111-1111-4111-8111-111111111101';

    /**
     * A version-history row exactly as `recipe-service` serializes one, parameterized by its one line's
     * unit and quantity.
     */
    const wireVersion = (unit: unknown, quantity: unknown = { kind: 'exact', value: 1 }): unknown => ({
        id: '22222222-2222-4222-8222-222222222201',
        recipeId: RECIPE_ID,
        versionNumber: 2,
        snapshot: {
            version: 2,
            title: 'Mediterranean Grilled Lamb',
            description: 'Herb-marinated grilled lamb.',
            servings: 4,
            prepTimeMinutes: 15,
            cookTimeMinutes: 30,
            steps: [
                {
                    id: '33333333-3333-4333-8333-333333333301',
                    recipeId: RECIPE_ID,
                    stepNumber: 1,
                    instruction: 'Marinate for two hours.',
                },
            ],
            ingredients: [
                {
                    id: '44444444-4444-4444-8444-444444444401',
                    recipeId: RECIPE_ID,
                    ingredientId: '00000000-0000-4000-8000-0000000000aa',
                    quantity,
                    unit,
                    sortOrder: 0,
                    ingredientName: 'Tomato',
                    isUserEntered: true,
                },
            ],
        },
        createdBy: '01JVERSIONCONTRACT0000000A',
        changeSummary: 'Updated',
        createdAt: '2026-07-28T02:30:00.000Z',
    });

    it('accepts a snapshot line that carries a unit', () => {
        expect(recipeVersionSchema.safeParse(wireVersion('cup')).success).toBe(true);
    });

    it('accepts a snapshot line with NO unit — the empty string the server actually writes', () => {
        // `recipe_ingredients.unit` is a NOT NULL column whose "unitless" value is `''` (the create DTO's
        // `unit` is optional and `RecipesService.resolveIngredientLines` persists `line.unit ?? ''`), and
        // `aggregateToSnapshot` copies the column into the snapshot VERBATIM. A `min(1)` here therefore
        // rejects the service's own output: every version of a recipe with a unitless line ("2 eggs",
        // "1 lemon") failed client-side parsing, and the whole version-history screen fell to its error
        // state with no server-side error to show for it (Maestro `recipes/versions`, round 3).
        expect(recipeVersionSchema.safeParse(wireVersion('')).success).toBe(true);
    });

    it('still rejects a snapshot line whose unit is not a string', () => {
        expect(recipeVersionSchema.safeParse(wireVersion(3)).success).toBe(false);
    });

    it('accepts a snapshot line stating a RANGE (U8/R36)', () => {
        expect(recipeVersionSchema.safeParse(wireVersion('cup', { kind: 'range', low: 2, high: 3 })).success).toBe(
            true,
        );
    });

    it('accepts a snapshot line stating NO quantity (U8/R40)', () => {
        expect(recipeVersionSchema.safeParse(wireVersion('', { kind: 'absent' })).success).toBe(true);
    });

    /**
     * ⚠️ THE WIRE PUBLISHES EXACTLY ONE SPELLING OF A QUANTITY, INCLUDING IN A SNAPSHOT.
     *
     * Pre-U8 `recipe_versions.snapshot` JSONB holds `quantity: 2`, and a version is immutable by design so
     * no migration will rewrite it. An earlier attempt made THIS schema tolerate both forms; the contract
     * generator rejected it ("transforms cannot be represented in JSON Schema — move server-side
     * normalization into the handler") and was right on the merits. The upgrade is the SERVER's job, at the
     * boundary where the blob enters the system: `recipe-service`'s `versions/snapshotUpgrade.ts`, whose
     * own suite covers the legacy row. By the time a snapshot reaches a client it is already canonical, so
     * a client that saw a bare number here would be looking at an un-upgraded read path — a defect, not a
     * shape to accommodate.
     */
    it('rejects the PRE-U8 bare number, because the server upgrades a stored snapshot before serving it', () => {
        expect(recipeVersionSchema.safeParse(wireVersion('cup', 2)).success).toBe(false);
    });

    it('rejects a snapshot quantity that is not a well-formed value object', () => {
        expect(recipeVersionSchema.safeParse(wireVersion('cup', { kind: 'exact', value: 0 })).success).toBe(false);
        expect(recipeVersionSchema.safeParse(wireVersion('cup', '2')).success).toBe(false);
        expect(recipeVersionSchema.safeParse(wireVersion('cup', null)).success).toBe(false);
        expect(recipeVersionSchema.safeParse(wireVersion('cup', { kind: 'range', low: 3, high: 2 })).success).toBe(
            false,
        );
    });
});

describe('recipeErrorCodeSchema cannot drift from RecipeErrorCode', () => {
    /**
     * ⛔ THE FAILURE THIS PINS ALREADY HAPPENED (plan U9, 2026-08-31): `PARSE_JOB_NOT_FOUND` was added to
     * the `RecipeErrorCode` const object but not to this hand-enumerated z.enum — so `isRecipeError`
     * refused the thrown domain error, and the API answered `500` where the contract promised `404`. Two
     * representations of one code set MUST be asserted equal, because nothing in the type system relates
     * a `z.enum` literal list to a const object's values.
     */
    it('enumerates exactly the values of the RecipeErrorCode const object', () => {
        expect([...recipeErrorCodeSchema.options].sort()).toEqual(Object.values(RecipeErrorCode).sort());
    });
});
