/**
 * The closed variant-attribute vocabulary (plan KTD-7). The declaration ORDER is the contract: the seed
 * format refuses parts out of this order, and U4's pg enum parity test reads this tuple. So the suite pins
 * the tuple literally, element by element, rather than checking membership.
 */
import { describe, expect, it } from 'vitest';

import { VARIANT_ATTRIBUTES, attributeRank, variantAttributeSchema } from '../variantAttribute.js';

describe('VARIANT_ATTRIBUTES', () => {
    it('is naming rule 24 order exactly, with origin last (KTD-7)', () => {
        expect(VARIANT_ATTRIBUTES).toEqual([
            'cut',
            'bone',
            'skin',
            'formOrVariety',
            'babyFoodStage',
            'pack',
            'fat',
            'trim',
            'grade',
            'cookingMethod',
            'salt',
            'sugar',
            'addedNutrients',
            'brand',
            'origin',
        ]);
    });
});

describe('attributeRank', () => {
    it('ranks each attribute by its declaration position', () => {
        expect(VARIANT_ATTRIBUTES.map((attribute) => attributeRank(attribute))).toEqual(
            VARIANT_ATTRIBUTES.map((_, index) => index),
        );
    });

    it('puts cut first and origin last', () => {
        expect(attributeRank('cut')).toBe(0);
        expect(attributeRank('origin')).toBe(VARIANT_ATTRIBUTES.length - 1);
        expect(attributeRank('cookingMethod')).toBeGreaterThan(attributeRank('trim'));
    });
});

describe('variantAttributeSchema', () => {
    it('accepts every declared attribute', () => {
        for (const attribute of VARIANT_ATTRIBUTES) {
            expect(variantAttributeSchema.safeParse(attribute).success).toBe(true);
        }
    });

    it('refuses an attribute outside the closed set, and a case variant of a real one', () => {
        expect(variantAttributeSchema.safeParse('state').success).toBe(false);
        expect(variantAttributeSchema.safeParse('Cut').success).toBe(false);
        expect(variantAttributeSchema.safeParse('').success).toBe(false);
    });
});
