import { ingredientLineDigest } from '@kitchensink/cooking-core';
import type { IngredientLineDigestInput } from '@kitchensink/cooking-core';
import { describe, expect, it } from 'vitest';

import {
    ingredientTickKeys,
    ingredientTickKeysSchema,
    isIngredientTickKey,
    tickedPositions,
} from '../ingredientTickKey.js';

const line = (over: Partial<IngredientLineDigestInput> = {}): IngredientLineDigestInput => ({
    ingredientId: '01JINGREDIENT0000000000000A',
    quantity: { kind: 'exact', value: 2 },
    unit: 'tbsp',
    displayText: 'butter',
    ...over,
});

const FLOUR = line({ ingredientId: '01JINGREDIENT0000000000000B', displayText: 'flour', unit: 'cup' });
const BUTTER_DIGEST = ingredientLineDigest(line());

describe('ingredientTickKeys', () => {
    it('tells two identical lines apart by their order (mutant: a digest-only key)', () => {
        expect(ingredientTickKeys([line(), line()])).toEqual([`${BUTTER_DIGEST}#0`, `${BUTTER_DIGEST}#1`]);
    });

    it('keeps a key when a different line is inserted above (mutant: position in the key)', () => {
        const before = ingredientTickKeys([line(), line()]);
        const after = ingredientTickKeys([FLOUR, line(), line()]);

        expect(after.slice(1)).toEqual(before);
    });

    it('keeps a key when different lines reorder', () => {
        const [butter, flour] = ingredientTickKeys([line(), FLOUR]);

        expect(ingredientTickKeys([FLOUR, line()])).toEqual([flour, butter]);
    });

    it('gives crust butter and filling butter different keys', () => {
        const [crust, filling] = ingredientTickKeys([
            line({ groupLabel: 'For the crust' }),
            line({ groupLabel: 'For the filling' }),
        ]);

        expect(crust).toMatch(/#0$/);
        expect(filling).toMatch(/#0$/);
        expect(crust).not.toBe(filling);
    });

    it('is empty for no lines', () => {
        expect(ingredientTickKeys([])).toEqual([]);
    });
});

describe('isIngredientTickKey', () => {
    it.each(['l1:0123abcd#0', 'l1:0123abcd#12', 'l2:deadbeef#0', 'l10:deadbeef#3'])('accepts the key %s', (text) => {
        expect(isIngredientTickKey(text)).toBe(true);
    });

    it.each(['01JINGREDIENT0000000000000A', 'l1:0123abcd', 'l1:0123ABCD#0', 'l1:0123abc#0', 'x1:0123abcd#0', ''])(
        'refuses %j',
        (text) => {
            expect(isIngredientTickKey(text)).toBe(false);
        },
    );
});

describe('ingredientTickKeysSchema', () => {
    it('drops an old id, keeps every key of any version (F1; mutant: filter to l1 only)', () => {
        const parsed = ingredientTickKeysSchema.parse([
            '01JINGREDIENT0000000000000A',
            'l1:0123abcd#0',
            'l2:deadbeef#0',
        ]);

        expect(parsed).toEqual(['l1:0123abcd#0', 'l2:deadbeef#0']);
    });

    it('refuses a value that is not an array of strings', () => {
        expect(ingredientTickKeysSchema.safeParse('l1:0123abcd#0').success).toBe(false);
        expect(ingredientTickKeysSchema.safeParse([1]).success).toBe(false);
    });
});

describe('tickedPositions', () => {
    it('maps ticked keys to positions, one identical line only', () => {
        const keys = ingredientTickKeys([line(), line(), FLOUR]);

        expect(tickedPositions(keys, new Set([keys[1]!]))).toEqual(new Set([1]));
    });

    it('ignores a key no line has (a stale or newer-version key)', () => {
        const keys = ingredientTickKeys([line()]);
        const [stale] = ingredientTickKeysSchema.parse(['l2:deadbeef#0']);

        expect(tickedPositions(keys, new Set([stale!]))).toEqual(new Set());
    });
});
