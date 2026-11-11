/**
 * `sourceLine` on a recipe line VIEW: the pasted or imported line, returned to its owner only.
 *
 * The schema cannot decide who sees it (recipe-service's `transcriptionDisclosure.ts` does); this file pins the
 * shape: optional, non-empty, kept by a parse, and absent from the snapshot line.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';

import { recipeIngredientViewSchema, type RecipeIngredient } from '../index.js';

const LINE = { ingredientId: 'food-lookup-1', quantity: { kind: 'exact', value: 2 }, isUserEntered: false };

describe('recipeIngredientViewSchema.sourceLine', () => {
    it('is optional: a line with no transcription omits it', () => {
        const parsed = recipeIngredientViewSchema.safeParse(LINE);

        expect(parsed.success).toBe(true);
        expect(parsed.success && 'sourceLine' in parsed.data).toBe(false);
    });

    it('survives a parse, so the typed client does not strip it', () => {
        const parsed = recipeIngredientViewSchema.parse({ ...LINE, sourceLine: '2 cups flour, sifted' });

        expect(parsed.sourceLine).toBe('2 cups flour, sifted');
    });

    it('rejects an empty string, so absent stays the one spelling of "no source line"', () => {
        expect(recipeIngredientViewSchema.safeParse({ ...LINE, sourceLine: '' }).success).toBe(false);
    });
});

describe('RecipeIngredient (the snapshot line)', () => {
    it('has no sourceLine key', () => {
        expectTypeOf<keyof RecipeIngredient>().not.toEqualTypeOf<never>();
        expectTypeOf<'sourceLine'>().not.toExtend<keyof RecipeIngredient>();
    });
});
