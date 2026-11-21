import { describe, expect, it } from 'vitest';

import { INGREDIENT_LINE_DIGEST_VERSION, ingredientLineDigest } from '../ingredientLineDigest.js';
import type { IngredientLineDigestInput } from '../ingredientLineDigest.js';

const BUTTER: IngredientLineDigestInput = {
    ingredientId: '01JINGREDIENT0000000000000A',
    quantity: { kind: 'exact', value: 2 },
    unit: 'tbsp',
    displayText: 'butter',
    note: 'softened',
    preparation: 'melted',
};

const digestOf = (over: Partial<IngredientLineDigestInput> = {}): string =>
    ingredientLineDigest({ ...BUTTER, ...over });

describe('ingredientLineDigest', () => {
    it('is versioned and fixed width', () => {
        expect(INGREDIENT_LINE_DIGEST_VERSION).toBe(1);
        expect(digestOf()).toMatch(/^l1:[0-9a-f]{8}$/);
    });

    // The vector is worked out by hand from the contract: FNV-1a 32 over the JSON of
    // [ingredientId, quantity, unit, displayText, note, preparation, groupLabel], absent fields null.
    it('pins a reference vector (mutant: a changed field order or serialization)', () => {
        expect(digestOf()).toBe('l1:4cfb07a0');
    });

    // One case per covered field (F3): a mutant that leaves any one field out keeps an edited line's tick.
    it.each([
        ['ingredientId', { ingredientId: '01JINGREDIENT0000000000000B' }],
        ['unit', { unit: 'cup' }],
        ['displayText', { displayText: 'salted butter' }],
        ['note', { note: 'cold' }],
        ['preparation', { preparation: 'diced' }],
        ['groupLabel', { groupLabel: 'For the crust' }],
        ['quantity', { quantity: { kind: 'exact', value: 3 } }],
    ] satisfies [string, Partial<IngredientLineDigestInput>][])('changes when %s changes', (_field, change) => {
        expect(digestOf(change)).not.toBe(digestOf());
    });

    it.each([
        ['unit', { unit: 'tbsp' }],
        ['displayText', { displayText: 'butter' }],
        ['note', { note: 'softened' }],
        ['preparation', { preparation: 'melted' }],
        ['groupLabel', { groupLabel: 'For the crust' }],
    ] satisfies [string, Partial<IngredientLineDigestInput>][])(
        'tells an absent %s from a present one',
        (_field, present) => {
            const bare: IngredientLineDigestInput = { ingredientId: BUTTER.ingredientId, quantity: BUTTER.quantity };

            expect(ingredientLineDigest({ ...bare, ...present })).not.toBe(ingredientLineDigest(bare));
        },
    );

    // Three quantity cases: kind and each bound count.
    it('changes from exact to range, when a range high changes, and from absent to exact', () => {
        const range = digestOf({ quantity: { kind: 'range', low: 1, high: 2 } });
        expect(range).not.toBe(digestOf());
        expect(digestOf({ quantity: { kind: 'range', low: 1, high: 3 } })).not.toBe(range);
        expect(digestOf({ quantity: { kind: 'absent' } })).not.toBe(
            digestOf({ quantity: { kind: 'exact', value: 1 } }),
        );
    });

    // The derived fields stay out: a food-service outage, a late resolution or the owner-only source line must not
    // untick a line. The ten fields are the ones the blueprint names.
    it.each([
        ['name', { name: 'Butter' }],
        ['foodId', { foodId: '01JFOOD0000000000000000AA' }],
        ['variant', { variant: { id: '01JVARIANT00000000000000A', parts: [{ attribute: 'salt', text: 'salted' }] } }],
        ['hasVariants', { hasVariants: true }],
        ['foodVisibility', { foodVisibility: 'public' }],
        ['unresolvedReason', { unresolvedReason: 'not_found' }],
        ['resolutionStatus', { resolutionStatus: 'resolved' }],
        ['boundBy', { boundBy: 'cook' }],
        ['isUserEntered', { isUserEntered: true }],
        ['sourceLine', { sourceLine: '2 tbsp butter, softened' }],
    ])('ignores the derived field %s', (_field, extra) => {
        // The input type is a Pick, so the derived fields arrive as extras on a full view line.
        expect(ingredientLineDigest({ ...BUTTER, ...extra })).toBe(digestOf());
    });

    it('treats whitespace runs and Unicode composition as the same text', () => {
        expect(digestOf({ displayText: ' salted \n butter ' })).toBe(digestOf({ displayText: 'salted butter' }));
        expect(digestOf({ displayText: 'crème' })).toBe(digestOf({ displayText: 'crème' }));
    });
});
