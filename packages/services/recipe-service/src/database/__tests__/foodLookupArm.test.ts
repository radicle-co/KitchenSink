/**
 * `foodLookupArmOf` — the ONE reading of a `food_lookups` row's arm (ADR-0045: "one function maps a
 * `food_lookups` row to a tagged value … and every reader goes through it").
 *
 * The database refuses a row with no arm or two (`food_lookups_one_arm`), so the corrupt cases below cannot
 * come from a migrated database. They are still parsed and refused, because a reader handed a row from a
 * wrong join or a wrong column list must fail loudly rather than return a third value.
 */
import { describe, expect, it } from 'vitest';

import type { FoodLookupRow, UnresolvedFoodRow } from '../schema/index.js';
import {
    foodLookupArmOf,
    foodRefKey,
    foodRefOf,
    isStrangerToPrivateFood,
    privateFoodOwnerOf,
    type FailureRow,
    type FoodLookupJoinedRow,
} from '../schema/foodLookupArm.js';
import { isFoodLookupArmCorruptError } from '../schema/foodLookupArm.errors.js';
import { makeRootArm, makeUnresolvedArm, makeVariantArm } from '../../ingredients/__fixtures__/foodLookups.fixture.js';

const CREATED_AT = new Date('2026-09-30T00:00:00.000Z');

function makeLookup(partial: Partial<FoodLookupRow>): FoodLookupRow {
    return {
        id: '11111111-1111-4111-8111-111111111111',
        foodId: null,
        foodVariantId: null,
        unresolvedFoodId: null,
        foodOwnerId: null,
        createdAt: CREATED_AT,
        ...partial,
    };
}

function makeFailure(partial: Partial<UnresolvedFoodRow>): FailureRow {
    return {
        id: '22222222-2222-4222-8222-222222222222',
        name: 'nutritional yeast',
        sourcePhrase: null,
        normalizedKey: 'nutritional yeast',
        status: 'NOT_FOUND',
        reasonCode: 'cascade_exhausted',
        foodHandleId: null,
        tiersConsulted: ['curated', 'memo'],
        tiersUnavailable: [],
        attempts: 1,
        firstAttemptedAt: CREATED_AT,
        lastAttemptedAt: CREATED_AT,
        settledLookupId: null,
        ...partial,
    };
}

function unresolvedRow(failure: Partial<UnresolvedFoodRow> = {}): FoodLookupJoinedRow {
    const row = makeFailure(failure);

    return { lookup: makeLookup({ unresolvedFoodId: row.id }), failure: row };
}

function expectCorrupt(row: FoodLookupJoinedRow): void {
    let thrown: unknown;

    try {
        foodLookupArmOf(row);
    } catch (error) {
        thrown = error;
    }

    expect(isFoodLookupArmCorruptError(thrown), String(thrown)).toBe(true);
}

describe('foodLookupArmOf', () => {
    it('reads a root binding, carrying its private owner', () => {
        expect(
            foodLookupArmOf({ lookup: makeLookup({ foodId: 'food-1', foodOwnerId: 'user-1' }), failure: null }),
        ).toStrictEqual({
            kind: 'root',
            lookupId: '11111111-1111-4111-8111-111111111111',
            foodId: 'food-1',
            foodOwnerId: 'user-1',
            createdAt: CREATED_AT,
        });
    });

    it('reads a variant binding', () => {
        expect(foodLookupArmOf({ lookup: makeLookup({ foodVariantId: 'variant-1' }), failure: null })).toStrictEqual({
            kind: 'variant',
            lookupId: '11111111-1111-4111-8111-111111111111',
            foodVariantId: 'variant-1',
            createdAt: CREATED_AT,
        });
    });

    it('reads an unresolved binding with its failure facts, and never carries `detail`', () => {
        const arm = foodLookupArmOf(
            unresolvedRow({ reasonCode: 'cascade_unavailable', status: 'FAILED', tiersUnavailable: ['memo'] }),
        );

        expect(arm).toStrictEqual({
            kind: 'unresolved',
            lookupId: '11111111-1111-4111-8111-111111111111',
            failure: {
                unresolvedFoodId: '22222222-2222-4222-8222-222222222222',
                name: 'nutritional yeast',
                normalizedKey: 'nutritional yeast',
                reasonCode: 'cascade_unavailable',
                status: 'FAILED',
                foodHandleId: null,
                tiersConsulted: ['curated', 'memo'],
                tiersUnavailable: ['memo'],
                attempts: 1,
                settledLookupId: null,
            },
            createdAt: CREATED_AT,
        });
        expect(JSON.stringify(arm)).not.toContain('detail');
    });

    it('⛔ refuses a row with no arm, and a row with two', () => {
        expectCorrupt({ lookup: makeLookup({}), failure: null });
        expectCorrupt({ lookup: makeLookup({ foodId: 'food-1', foodVariantId: 'variant-1' }), failure: null });

        const failure = makeFailure({});

        expectCorrupt({ lookup: makeLookup({ foodId: 'food-1', unresolvedFoodId: failure.id }), failure });
    });

    it('⛔ refuses an unresolved binding whose failure record is missing or is another row', () => {
        expectCorrupt({
            lookup: makeLookup({ unresolvedFoodId: '22222222-2222-4222-8222-222222222222' }),
            failure: null,
        });
        expectCorrupt({
            lookup: makeLookup({ unresolvedFoodId: '33333333-3333-4333-8333-333333333333' }),
            failure: makeFailure({}),
        });
    });

    it('⛔ refuses a failure record joined onto a bound row, and an owner on a non-root arm', () => {
        expectCorrupt({ lookup: makeLookup({ foodId: 'food-1' }), failure: makeFailure({}) });
        expectCorrupt({ lookup: makeLookup({ foodVariantId: 'variant-1', foodOwnerId: 'user-1' }), failure: null });
    });

    it('⛔ refuses a reason, status or tier outside the vocabulary', () => {
        expectCorrupt(unresolvedRow({ reasonCode: 'invented_reason' }));
        expectCorrupt(unresolvedRow({ status: 'RESOLVED' }));
        expectCorrupt(unresolvedRow({ tiersConsulted: ['curated', 'llm'] }));
    });
});

describe('foodRefOf and foodRefKey', () => {
    it('names the food a bound arm points at, and nothing for an unresolved arm', () => {
        const root = foodLookupArmOf({ lookup: makeLookup({ foodId: 'food-1' }), failure: null });
        const variant = foodLookupArmOf({ lookup: makeLookup({ foodVariantId: 'variant-1' }), failure: null });

        expect(foodRefOf(root)).toStrictEqual({ kind: 'root', id: 'food-1' });
        expect(foodRefOf(variant)).toStrictEqual({ kind: 'variant', id: 'variant-1' });
        expect(foodRefOf(foodLookupArmOf(unresolvedRow()))).toBeUndefined();
    });

    it('keys a root and a variant that share an id apart', () => {
        expect(foodRefKey({ kind: 'root', id: 'x' })).not.toBe(foodRefKey({ kind: 'variant', id: 'x' }));
        expect(foodRefKey({ kind: 'root', id: 'x' })).toBe(foodRefKey({ kind: 'root', id: 'x' }));
    });
});

describe('privateFoodOwnerOf — the one statement of which binding is a private food', () => {
    it('names the owner of a root food someone authored privately', () => {
        expect(privateFoodOwnerOf(makeRootArm({ foodOwnerId: 'usr_author' }))).toBe('usr_author');
    });

    it('is undefined for a shared root, a variant and an unresolved binding', () => {
        expect(privateFoodOwnerOf(makeRootArm({ foodOwnerId: null }))).toBeUndefined();
        expect(privateFoodOwnerOf(makeVariantArm())).toBeUndefined();
        expect(privateFoodOwnerOf(makeUnresolvedArm())).toBeUndefined();
    });
});

describe('isStrangerToPrivateFood — the one statement of who may not see a private food (R46)', () => {
    it('is true for anyone but the author, and for an unknown viewer', () => {
        expect(isStrangerToPrivateFood('usr_author', 'usr_other')).toBe(true);
        expect(isStrangerToPrivateFood('usr_author', undefined)).toBe(true);
    });

    it('is false for the author, and for any viewer of a food that is not private', () => {
        expect(isStrangerToPrivateFood('usr_author', 'usr_author')).toBe(false);
        expect(isStrangerToPrivateFood(undefined, 'usr_other')).toBe(false);
        expect(isStrangerToPrivateFood(undefined, undefined)).toBe(false);
    });
});
