/**
 * `boundBy` on a recipe line (ADR-0072 §5): who bound the line to its food.
 *
 * It is RESPONSE-ONLY, optional, and a closed set. The set's other two statements (the service's `BOUND_BY_VALUES` and the
 * SQL CHECK) are compared with this one by `recipe-service`'s `importSchemaParity.test.ts`; this file pins the schema's side.
 */
import { describe, expect, it } from 'vitest';

import { BOUND_BY_VALUES, boundBySchema, isBoundBy, recipeIngredientViewSchema } from '../index.js';

const LINE = { ingredientId: 'food-lookup-1', quantity: { kind: 'exact', value: 2 }, isUserEntered: false };

describe('boundBySchema', () => {
    it.each(['exact', 'curated', 'review', 'default', 'autoBest', 'cook'])('accepts %s', (origin) => {
        expect(boundBySchema.safeParse(origin).success).toBe(true);
    });

    it.each(['', 'Exact', 'auto_best', 'migration', 'user', 1, null])('rejects %j', (origin) => {
        expect(boundBySchema.safeParse(origin).success).toBe(false);
    });
});

describe('BOUND_BY_VALUES and isBoundBy', () => {
    it('is the six origins ADR-0072 §5 names, and the schema is built from it', () => {
        expect([...BOUND_BY_VALUES]).toStrictEqual(['exact', 'curated', 'review', 'default', 'autoBest', 'cook']);
        expect([...boundBySchema.options]).toStrictEqual([...BOUND_BY_VALUES]);
    });

    it.each([...BOUND_BY_VALUES])('narrows %s', (origin) => {
        expect(isBoundBy(origin)).toBe(true);
    });

    it.each(['', 'Exact', 'migration', null, undefined, 3])('refuses %j', (value) => {
        expect(isBoundBy(value)).toBe(false);
    });
});

describe('recipeIngredientViewSchema.boundBy', () => {
    it('is optional: a line with no recorded origin omits it', () => {
        const parsed = recipeIngredientViewSchema.safeParse(LINE);

        expect(parsed.success).toBe(true);
        expect(parsed.success && 'boundBy' in parsed.data).toBe(false);
    });

    it('survives a parse, so the typed client does not strip it', () => {
        const parsed = recipeIngredientViewSchema.parse({ ...LINE, boundBy: 'autoBest' });

        expect(parsed.boundBy).toBe('autoBest');
    });

    it('rejects an origin outside the closed set', () => {
        expect(recipeIngredientViewSchema.safeParse({ ...LINE, boundBy: 'migration' }).success).toBe(false);
    });
});
