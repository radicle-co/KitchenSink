/**
 * `foodRefArc` — the ONE reader and writer of the two-column food arc on the resolution memory's tables (curated plan
 * U9; migration 0052): `ingredient_resolution_mappings`, `ingredient_resolution_memos` and
 * `recipe_ingredient_verifications` each name a root (`food_id`) or a variant (`food_variant_id`), exactly one.
 *
 * | Requirement | Pinned here |
 * | --- | --- |
 * | 0052's `num_nonnulls(food_id, food_variant_id) = 1` | a row with neither or both is a defect, refused with a named error |
 * | one parse of the arc (Data Mapper) | each single arm reads back as its own kind |
 * | the writer is the reader's inverse | every ref round-trips through `arcColumnsOf` → `foodRefOfArc` |
 */
import { describe, expect, it } from 'vitest';

import { arcColumnsOf, foodRefOfArc } from '../foodRefArc.js';
import { FoodRefArcCorruptError, isFoodRefArcCorruptError } from '../foodRefArc.errors.js';
import type { FoodRef } from '../foodLookupArm.js';

describe('foodRefOfArc', () => {
    it('reads a root arm as a root ref, and a variant arm as a variant ref', () => {
        expect(foodRefOfArc({ foodId: 'R-1', foodVariantId: null }, 'mapping m1')).toStrictEqual({
            kind: 'root',
            id: 'R-1',
        });
        expect(foodRefOfArc({ foodId: null, foodVariantId: 'V-1' }, 'mapping m1')).toStrictEqual({
            kind: 'variant',
            id: 'V-1',
        });
    });

    it.each([
        ['neither arm', { foodId: null, foodVariantId: null }],
        ['both arms', { foodId: 'R-1', foodVariantId: 'V-1' }],
    ])('⛔ refuses a row naming %s with a named error that says which row', (_, columns) => {
        const thrown = (() => {
            try {
                return foodRefOfArc(columns, 'memo "tomato paste"');
            } catch (error) {
                return error;
            }
        })();

        expect(isFoodRefArcCorruptError(thrown)).toBe(true);
        expect(thrown).toBeInstanceOf(FoodRefArcCorruptError);
        expect((thrown as Error).message).toContain('memo "tomato paste"');
    });

    it('the guard answers false for any other error', () => {
        expect(isFoodRefArcCorruptError(new Error('nope'))).toBe(false);
    });
});

describe('arcColumnsOf — the writer, the reader’s inverse', () => {
    it.each<FoodRef>([
        { kind: 'root', id: 'R-1' },
        { kind: 'variant', id: 'V-1' },
    ])('writes $kind $id into exactly its own column and reads back the same ref', (ref) => {
        const columns = arcColumnsOf(ref);

        expect([columns.foodId, columns.foodVariantId].filter((value) => value !== null)).toStrictEqual([ref.id]);
        expect(foodRefOfArc(columns, 'round trip')).toStrictEqual(ref);
    });
});
