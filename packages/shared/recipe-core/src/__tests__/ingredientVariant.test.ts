/**
 * The variant on the recipe wire (curated plan U9; R20, R25, R29; KTD-15): a line's variant, the picker's variant, and
 * the parts a version freezes.
 *
 * | Requirement | Pinned here |
 * | --- | --- |
 * | KTD-15: `attribute` is an OPEN string on the wire | an attribute no client knows parses and passes through |
 * | a variant states at least one part | `parts: []` is refused, so "a variant with no label" cannot be represented |
 * | a part says something | an empty attribute or text is refused |
 * | the line view widens additively | `variant` and `hasVariants` are optional, and a line without them still parses |
 */
import { describe, expect, it } from 'vitest';

import {
    ingredientSchema,
    ingredientVariantSchema,
    recipeIngredientSchema,
    recipeIngredientViewSchema,
} from '../index.js';

const FLAT = { id: 'V-flat', parts: [{ attribute: 'cut', text: 'flat' }] };

describe('ingredientVariantSchema', () => {
    it('parses a variant with an attribute no client knows, and passes it through unchanged (KTD-15)', () => {
        const unknown = { id: 'V-x', parts: [{ attribute: 'smokeLevel', text: 'heavy' }] };

        expect(ingredientVariantSchema.parse(unknown)).toStrictEqual(unknown);
    });

    it('⛔ refuses a variant with no parts — a variant always states what it is', () => {
        expect(ingredientVariantSchema.safeParse({ id: 'V-flat', parts: [] }).success).toBe(false);
    });

    it.each([
        ['an empty attribute', { attribute: '', text: 'flat' }],
        ['an empty text', { attribute: 'cut', text: '' }],
    ])('refuses a part with %s', (_, part) => {
        expect(ingredientVariantSchema.safeParse({ id: 'V-flat', parts: [part] }).success).toBe(false);
    });

    it('refuses a variant with no id', () => {
        expect(ingredientVariantSchema.safeParse({ id: '', parts: FLAT.parts }).success).toBe(false);
    });
});

describe('the variant on the recipe line view, the picker ingredient and the version snapshot', () => {
    const line = {
        ingredientId: '11111111-1111-4111-8111-111111111101',
        name: 'beef brisket',
        foodId: 'R-brisket',
        quantity: { kind: 'exact', value: 1 },
        isUserEntered: false,
    };

    it('a line view carries its variant, and a root-bound line carries hasVariants', () => {
        expect(recipeIngredientViewSchema.parse({ ...line, variant: FLAT })).toMatchObject({ variant: FLAT });
        expect(recipeIngredientViewSchema.parse({ ...line, hasVariants: true })).toMatchObject({ hasVariants: true });
    });

    it('a line view without either still parses — the widening is additive', () => {
        expect(recipeIngredientViewSchema.parse(line)).not.toHaveProperty('variant');
    });

    it('⛔ a line view with a part-less variant is refused', () => {
        expect(recipeIngredientViewSchema.safeParse({ ...line, variant: { id: 'V-flat', parts: [] } }).success).toBe(
            false,
        );
    });

    it('the picker’s ingredient carries a variant', () => {
        const ingredient = {
            id: '11111111-1111-4111-8111-111111111102',
            name: 'beef brisket',
            foodId: 'R-brisket',
            variant: FLAT,
            isUserEntered: false,
            createdAt: '2026-10-01T00:00:00.000Z',
        };

        expect(ingredientSchema.parse(ingredient)).toMatchObject({ variant: FLAT });
    });

    it('a version line freezes the variant’s parts, and refuses an empty list', () => {
        const snapshotLine = {
            id: '11111111-1111-4111-8111-111111111103',
            recipeId: '11111111-1111-4111-8111-111111111104',
            ingredientId: '11111111-1111-4111-8111-111111111101',
            quantity: { kind: 'exact', value: 1 },
            unit: '',
            sortOrder: 0,
            ingredientName: 'beef brisket',
            isUserEntered: false,
        };

        expect(recipeIngredientSchema.parse({ ...snapshotLine, variantParts: FLAT.parts })).toMatchObject({
            variantParts: FLAT.parts,
        });
        expect(recipeIngredientSchema.safeParse({ ...snapshotLine, variantParts: [] }).success).toBe(false);
    });
});
