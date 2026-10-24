/**
 * Unit tests for {@link FoodLookupsDal}'s own logic over a fake Drizzle client: the empty-input short circuits,
 * the de-duplication of ids before the read, and the translation of a concurrent reference into `false`. The SQL
 * itself is covered against a real Postgres by `tests/e2e/foodLookupsDal.e2e.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { DrizzleQueryError } from 'drizzle-orm';
import { DatabaseError } from 'pg';

import type { RecipeDrizzle } from '../../../database/client.js';
import { makeFakeDrizzle } from '../../../__testing__/makeFakeDrizzle.js';
import { FoodLookupsDal } from '../foodLookups.dal.js';

const AT = new Date('2026-09-30T00:00:00.000Z');

describe('FoodLookupsDal — short circuits', () => {
    it('reads nothing for no ids, no foods, and no referenced foods', async () => {
        const fake = makeFakeDrizzle<RecipeDrizzle>();
        const dal = new FoodLookupsDal(fake.db);

        expect((await dal.findByIds([])).size).toBe(0);
        expect((await dal.findBoundRootsByFoodIds([], 'user-1')).size).toBe(0);
        expect(await dal.referencedFoodIdsAmong([])).toStrictEqual([]);
        expect(fake.calls).toHaveLength(0);
    });

    it('asks for each lookup id once, however often a recipe repeats it', async () => {
        const fake = makeFakeDrizzle<RecipeDrizzle>();
        const dal = new FoodLookupsDal(fake.db);
        fake.enqueue([
            {
                lookup: {
                    id: 'l1',
                    foodId: 'food-1',
                    foodVariantId: null,
                    unresolvedFoodId: null,
                    foodOwnerId: null,
                    createdAt: AT,
                },
                failure: null,
            },
        ]);

        const arms = await dal.findByIds(['l1', 'l1', 'l1']);

        expect([...arms.keys()]).toStrictEqual(['l1']);
        expect(fake.calls.filter((call) => call.method === 'where')).toHaveLength(1);
    });
});

describe('FoodLookupsDal.deleteIfOrphanedFailure — a concurrent reference is a "no", not an error', () => {
    it('answers false when a line referenced the binding first (RESTRICT, through Drizzle’s wrapper)', async () => {
        const fake = makeFakeDrizzle<RecipeDrizzle>();
        const dal = new FoodLookupsDal(fake.db);
        const restrict = Object.assign(
            new DatabaseError('update or delete violates foreign key constraint', 0, 'error'),
            {
                code: '23001',
            },
        );
        fake.enqueue(Promise.reject(new DrizzleQueryError('delete from "food_lookups"', [], restrict)));

        expect(await dal.deleteIfOrphanedFailure('l1')).toBe(false);
    });

    it('rethrows any other failure — the positive control for the translation above', async () => {
        const fake = makeFakeDrizzle<RecipeDrizzle>();
        const dal = new FoodLookupsDal(fake.db);
        const other = Object.assign(new Error('connection terminated'), { code: '57P01' });
        fake.enqueue(Promise.reject(other));

        await expect(dal.deleteIfOrphanedFailure('l1')).rejects.toBe(other);
    });

    it('answers false when the binding is referenced or is not an unresolved one', async () => {
        const fake = makeFakeDrizzle<RecipeDrizzle>();
        const dal = new FoodLookupsDal(fake.db);
        fake.enqueue([]);

        expect(await dal.deleteIfOrphanedFailure('l1')).toBe(false);
        expect(fake.calls.filter((call) => call.method === 'delete')).toHaveLength(1);
    });
});
