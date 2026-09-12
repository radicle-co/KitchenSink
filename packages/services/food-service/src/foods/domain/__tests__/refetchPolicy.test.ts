/**
 * `refetchRefusalOf` — which foods an operator's refetch may queue. The refetch refuses by it, and the requeue's `409`
 * reads it before naming the refetch route, so the requeue never sends an operator to a route that refuses them.
 *
 * The table is EVERY status the store holds, crossed with seed ownership, so a status added to the enum must be placed
 * here before this suite passes.
 */
import { describe, expect, it } from 'vitest';

import { foodStatusEnum } from '../../../db/schema/food.js';
import type { FoodStatus } from '../../dao/food.dao.js';
import { refetchRefusalOf, refetchRefusalReason, type RefetchRefusal } from '../refetchPolicy.js';

/** The refusal each status earns on a food the seed does NOT own. */
const UNSEEDED: Readonly<Record<FoodStatus, RefetchRefusal | undefined>> = {
    PENDING: undefined,
    UNRESOLVED: undefined,
    RESOLVED: undefined,
    NOT_FOUND: undefined,
    FAILED: undefined,
    AWAITING_RETRY: undefined,
    DELETING: 'deleting',
    WITHDRAWN: 'withdrawn',
};

describe('refetchRefusalOf', () => {
    it('has a row for every status the store holds', () => {
        expect(Object.keys(UNSEEDED).sort()).toStrictEqual([...foodStatusEnum.enumValues].sort());
    });

    it.each(Object.entries(UNSEEDED) as [FoodStatus, RefetchRefusal | undefined][])(
        'answers a food the seed does not own, in %s, with %s',
        (status, refusal) => {
            expect(refetchRefusalOf({ status, seedOwned: false })).toBe(refusal);
        },
    );

    // A deletion or a withdrawal is decided before ownership is: neither ever reaches a seeded food (KTD-12 keeps the
    // seed the only writer of its rows), and the order keeps a mid-erasure food a 404 whatever else is true of it.
    it.each(Object.entries(UNSEEDED) as [FoodStatus, RefetchRefusal | undefined][])(
        'answers a seed-owned food in %s as seed-owned unless deleting or withdrawn',
        (status, refusal) => {
            expect(refetchRefusalOf({ status, seedOwned: true })).toBe(refusal ?? 'seedOwned');
        },
    );
});

describe('refetchRefusalReason', () => {
    const REFUSALS: readonly RefetchRefusal[] = ['deleting', 'withdrawn', 'seedOwned'];

    // The requeue appends this to its own `409`, so a reason that named a route would send the operator somewhere.
    it('gives each refusal its own reason, and names no route in any of them', () => {
        const reasons = REFUSALS.map(refetchRefusalReason);

        expect(new Set(reasons).size).toBe(REFUSALS.length);

        for (const reason of reasons) {
            expect(reason).toMatch(/\S/u);
            expect(reason).not.toContain('/api/');
        }
    });
});
