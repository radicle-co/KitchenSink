/**
 * Tests for the AUTHORED food (ingredient) wire contract.
 *
 * Two jobs, and the first is the important one.
 *
 * 1. **PIN THE WIRE LIFECYCLE TO THE DATABASE ENUM.** `FoodStatus` used to be `(typeof
 *    foodStatusEnum.enumValues)[number]` — the wire contract was literally defined by a drizzle `pgEnum`, and
 *    `foods.types.ts` imported it from `./dao/index.js`. The import restriction forbids that (a `*.schema.ts` is
 *    copied into a package web and mobile depend on), so {@link foodStatusSchema} now restates the values. They
 *    are kept as two representations DELIBERATELY, not merged: the wire vocabulary and the storage column's
 *    domain change for different reasons — a DB enum migration is not a contract change and vice versa — and
 *    DRY governs knowledge, not keystrokes. What must never happen is a SILENT divergence, so this test is the
 *    thing that fails when one moves without the other.
 *
 * 2. Assert the request schemas actually enforce what the controller and the published document promise, using
 *    the values that matter (whitespace-only names, empty arrays) rather than only the happy path.
 */
import { describe, expect, it } from 'vitest';

import { foodStatusEnum } from '../../db/schema/food.js';
import {
    addFoodRequestSchema,
    batchAddFoodRequestSchema,
    foodStatusSchema,
    getFoodResultSchema,
    pendingFoodStatusSchema,
    resolveFoodRequestSchema,
} from '../foods.schema.js';

describe('foodStatusSchema', () => {
    // The load-bearing assertion of this file. If a migration adds a lifecycle value and the wire schema is not
    // updated, the service can persist a status it cannot describe — and every client's exhaustive switch over
    // `FoodStatus` silently stops being exhaustive.
    it('carries EXACTLY the values of the food_status database enum', () => {
        expect([...foodStatusSchema.options].sort()).toStrictEqual([...foodStatusEnum.enumValues].sort());
    });

    it('rejects a value the database enum does not have', () => {
        expect(foodStatusSchema.safeParse('RESOLVING').success).toBe(false);
        expect(foodStatusSchema.safeParse('resolved').success).toBe(false);
    });

    it('accepts every value the database enum has', () => {
        for (const value of foodStatusEnum.enumValues) {
            expect(foodStatusSchema.safeParse(value).success).toBe(true);
        }
    });
});

describe('pendingFoodStatusSchema', () => {
    // A `202` means "not readable yet". `RESOLVED` would be a `200` and the terminal statuses are `404`, so
    // admitting any of them here would let the service describe a response it never sends.
    it('admits only the two statuses that answer 202', () => {
        expect([...pendingFoodStatusSchema.options].sort()).toStrictEqual(['PENDING', 'UNRESOLVED']);
    });

    it('rejects RESOLVED and the terminal statuses', () => {
        for (const value of ['RESOLVED', 'NOT_FOUND', 'FAILED']) {
            expect(pendingFoodStatusSchema.safeParse(value).success).toBe(false);
        }
    });

    it('is a subset of the full lifecycle', () => {
        for (const value of pendingFoodStatusSchema.options) {
            expect(foodStatusSchema.safeParse(value).success).toBe(true);
        }
    });
});

describe('addFoodRequestSchema', () => {
    it('accepts a name and returns it trimmed', () => {
        const parsed = addFoodRequestSchema.parse({ name: '  cheddar cheese  ' });

        expect(parsed.name).toBe('cheddar cheese');
    });

    // FR-006. A whitespace-only name is the case a naive `typeof name === 'string'` check lets through, and it
    // would enqueue a source fetch for the empty string.
    it('rejects a whitespace-only name', () => {
        expect(addFoodRequestSchema.safeParse({ name: '   ' }).success).toBe(false);
        expect(addFoodRequestSchema.safeParse({ name: '\t\n' }).success).toBe(false);
    });

    it('rejects an empty name, a missing name, and a non-string name', () => {
        expect(addFoodRequestSchema.safeParse({ name: '' }).success).toBe(false);
        expect(addFoodRequestSchema.safeParse({}).success).toBe(false);
        expect(addFoodRequestSchema.safeParse({ name: 42 }).success).toBe(false);
        expect(addFoodRequestSchema.safeParse(null).success).toBe(false);
    });
});

describe('batchAddFoodRequestSchema', () => {
    it('accepts an array of names and trims each', () => {
        const parsed = batchAddFoodRequestSchema.parse({ names: [' milk ', 'eggs'] });

        expect(parsed.names).toStrictEqual(['milk', 'eggs']);
    });

    it('rejects a non-array and a non-string element', () => {
        expect(batchAddFoodRequestSchema.safeParse({ names: 'milk' }).success).toBe(false);
        expect(batchAddFoodRequestSchema.safeParse({ names: ['milk', 7] }).success).toBe(false);
        expect(batchAddFoodRequestSchema.safeParse({}).success).toBe(false);
    });

    // The empty batch is a legitimate no-op, and the cap is runtime configuration enforced by the controller —
    // so neither belongs in the published shape. Asserted so a future "tighten the schema" edit has to justify
    // itself against the reason.
    it('accepts an empty array, leaving the cap and blank-dropping to the controller', () => {
        expect(batchAddFoodRequestSchema.parse({ names: [] }).names).toStrictEqual([]);
        expect(batchAddFoodRequestSchema.parse({ names: ['', ' '] }).names).toStrictEqual(['', '']);
    });
});

describe('resolveFoodRequestSchema', () => {
    it('accepts one or more candidate ids', () => {
        expect(resolveFoodRequestSchema.parse({ candidateIds: ['a'] }).candidateIds).toStrictEqual(['a']);
        expect(resolveFoodRequestSchema.parse({ candidateIds: ['a', 'b'] }).candidateIds).toStrictEqual(['a', 'b']);
    });

    // DSN-14: an empty pick is not a resolve, and the schema — not just the controller — has to say so, because
    // the schema is what the published document shows a caller.
    it('rejects an empty candidate list', () => {
        expect(resolveFoodRequestSchema.safeParse({ candidateIds: [] }).success).toBe(false);
    });

    it('rejects a missing or non-array candidate list', () => {
        expect(resolveFoodRequestSchema.safeParse({}).success).toBe(false);
        expect(resolveFoodRequestSchema.safeParse({ candidateIds: 'a' }).success).toBe(false);
        expect(resolveFoodRequestSchema.safeParse({ candidateIds: [1] }).success).toBe(false);
    });
});

describe('getFoodResultSchema', () => {
    it('narrows the RESOLVED branch to the golden record', () => {
        const parsed = getFoodResultSchema.parse({
            status: 'RESOLVED',
            food: {
                id: '01J000000000000000000000',
                name: 'Cheddar',
                description: null,
                kind: 'generic',
                status: 'RESOLVED',
                nutrients: [],
                portions: [],
                provenance: {},
            },
        });

        expect(parsed.status).toBe('RESOLVED');
    });

    it('narrows the pending branch to an id plus an optional wait', () => {
        const parsed = getFoodResultSchema.parse({ status: 'PENDING', id: 'x', estimatedWaitSeconds: 30 });

        expect(parsed).toStrictEqual({ status: 'PENDING', id: 'x', estimatedWaitSeconds: 30 });
    });

    // The fork exists because `GET /{id}` answers 200 OR 202. A terminal status is a 404 and has no body in this
    // union, so admitting one would model a response the service never sends.
    it('admits no terminal status', () => {
        expect(getFoodResultSchema.safeParse({ status: 'NOT_FOUND', id: 'x' }).success).toBe(false);
        expect(getFoodResultSchema.safeParse({ status: 'FAILED', id: 'x' }).success).toBe(false);
    });

    it('requires the golden record on the RESOLVED branch', () => {
        expect(getFoodResultSchema.safeParse({ status: 'RESOLVED', id: 'x' }).success).toBe(false);
    });
});
