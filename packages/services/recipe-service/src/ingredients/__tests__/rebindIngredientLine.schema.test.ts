/**
 * `rebindIngredientLineRequestSchema` — the body of `POST /api/v1/recipes/{id}/ingredients/{position}/rebind`
 * (plan 002 U5).
 *
 * The target is a food the cook picked, or a name to resolve. There is deliberately no "create a food" arm: the
 * picker's create route already creates the cook's own food (and answers a duplicate as a union arm), and a
 * `catalogFood` rebind with the new id reaches the same end state.
 */
import { describe, expect, it } from 'vitest';

import { rebindIngredientLineRequestSchema } from '../ingredients.schema.js';

describe('rebindIngredientLineRequestSchema', () => {
    it('accepts a picked food, trimming its id', () => {
        expect(
            rebindIngredientLineRequestSchema.parse({
                expectedVersion: 3,
                target: { kind: 'catalogFood', foodId: '  01JFOOD0000000000000000001  ' },
            }),
        ).toStrictEqual({ expectedVersion: 3, target: { kind: 'catalogFood', foodId: '01JFOOD0000000000000000001' } });
    });

    it('accepts a picked VARIANT, trimming its id (curated U9, R22)', () => {
        expect(
            rebindIngredientLineRequestSchema.parse({
                expectedVersion: 2,
                target: { kind: 'catalogVariant', foodVariantId: '  01JVARIANT000000000000001 ' },
            }),
        ).toStrictEqual({
            expectedVersion: 2,
            target: { kind: 'catalogVariant', foodVariantId: '01JVARIANT000000000000001' },
        });
    });

    it('accepts a name to resolve, trimming it', () => {
        expect(
            rebindIngredientLineRequestSchema.parse({
                expectedVersion: 1,
                target: { kind: 'name', name: ' shallot ' },
            }),
        ).toStrictEqual({ expectedVersion: 1, target: { kind: 'name', name: 'shallot' } });
    });

    it.each([
        ['no expectedVersion', { target: { kind: 'name', name: 'shallot' } }],
        ['a blank name', { expectedVersion: 1, target: { kind: 'name', name: '   ' } }],
        ['a blank food id', { expectedVersion: 1, target: { kind: 'catalogFood', foodId: ' ' } }],
        ['a blank variant id', { expectedVersion: 1, target: { kind: 'catalogVariant', foodVariantId: ' ' } }],
        [
            '⛔ a variant target spelled with a root key',
            { expectedVersion: 1, target: { kind: 'catalogVariant', foodId: '01JVARIANT' } },
        ],
        [
            '⛔ a create-a-food target, which has no arm',
            { expectedVersion: 1, target: { kind: 'authoredFood', name: 'x' } },
        ],
        ['an unknown key on the target', { expectedVersion: 1, target: { kind: 'name', name: 'x', foodId: 'y' } }],
        ['an unknown key on the body', { expectedVersion: 1, target: { kind: 'name', name: 'x' }, position: 2 }],
    ])('refuses %s', (_case, body) => {
        expect(rebindIngredientLineRequestSchema.safeParse(body).success).toBe(false);
    });
});
