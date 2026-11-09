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
import { canonicalIngredientName } from '../../domain/ingredientName.js';
import { admitResolvedRef, isAdmission } from '../../domain/foodAdmission.js';
import { PrivateFoodSettleError } from '../foodLookups.errors.js';

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

describe('FoodLookupsDal.settleFailure - a shared failure binds a shared food only (ADR-0029 section 4)', () => {
    const handle = { unresolvedFoodId: 'u1', lookupId: 'l-failure' } as never;
    const root = (foodOwnerId: string | null) =>
        ({ kind: 'root', lookupId: 'l-bound', foodId: 'food-1', foodOwnerId, createdAt: AT }) as never;

    it('refuses to move lines onto a PRIVATE root, touching nothing', async () => {
        const fake = makeFakeDrizzle<RecipeDrizzle>();
        const dal = new FoodLookupsDal(fake.db);

        await expect(dal.settleFailure(handle, root('01JAUTHOR'))).rejects.toBeInstanceOf(PrivateFoodSettleError);
        expect(fake.calls).toHaveLength(0);
    });

    it('does not refuse a shared root (the guard stops at the transaction, which a fake db cannot open)', async () => {
        const fake = makeFakeDrizzle<RecipeDrizzle>();
        const dal = new FoodLookupsDal(fake.db);

        await expect(dal.settleFailure(handle, root(null))).rejects.not.toBeInstanceOf(PrivateFoodSettleError);
    });
});

describe('FoodLookupsDal.findOrCreateBound - a promoted food is handed back public', () => {
    const admission = (ownerId: string | undefined) => {
        const decision = admitResolvedRef(
            {
                outcome: 'found',
                name: canonicalIngredientName('grandma blend'),
                status: 'RESOLVED',
                isPrivate: ownerId !== undefined,
                rootId: 'food-1',
            },
            ownerId,
        );

        if (!isAdmission(decision)) {
            throw new Error('fixture admission refused');
        }

        return decision;
    };

    const row = (foodOwnerId: string | null) => ({
        id: 'l1',
        foodId: 'food-1',
        foodVariantId: null,
        unresolvedFoodId: null,
        foodOwnerId,
        createdAt: AT,
    });

    it('clears the stale captured owner when a PUBLIC admission finds a row still marked private', async () => {
        const fake = makeFakeDrizzle<RecipeDrizzle>();
        const dal = new FoodLookupsDal(fake.db);
        fake.enqueue([], [row('01JAUTHOR')], [row(null)]);

        const bound = await dal.findOrCreateBound(admission(undefined));

        expect(bound).toMatchObject({ lookupId: 'l1', foodOwnerId: null });
        expect(fake.calls.filter((call) => call.method === 'update')).toHaveLength(1);
    });

    it('writes nothing for a public admission that finds a public row, or a private admission of any row', async () => {
        const publicFake = makeFakeDrizzle<RecipeDrizzle>();
        publicFake.enqueue([], [row(null)]);
        await new FoodLookupsDal(publicFake.db).findOrCreateBound(admission(undefined));

        const privateFake = makeFakeDrizzle<RecipeDrizzle>();
        privateFake.enqueue([], [row(null)]);
        const kept = await new FoodLookupsDal(privateFake.db).findOrCreateBound(admission('01JAUTHOR'));

        expect(publicFake.calls.filter((call) => call.method === 'update')).toHaveLength(0);
        expect(privateFake.calls.filter((call) => call.method === 'update')).toHaveLength(0);
        // A found row is returned as it stands: a later private bind never makes a public row private.
        expect(kept).toMatchObject({ foodOwnerId: null });
    });
});
