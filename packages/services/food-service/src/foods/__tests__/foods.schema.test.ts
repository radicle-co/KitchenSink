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

import { apiErrorSchema } from '../../common/api-error.schema.js';
import { foodStatusEnum } from '../../db/schema/food.js';
import {
    addFoodRequestSchema,
    batchAddFoodRequestSchema,
    foodErrorCodeSchema,
    foodErrorSchema,
    foodStatusSchema,
    getFoodResultSchema,
    pendingFoodStatusSchema,
    pendingResponseSchema,
    resolveFoodRequestSchema,
    terminalFoodStatusSchema,
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

describe('terminalFoodStatusSchema', () => {
    // A `404` means "there is nothing readable and there never will be without a refetch". `PENDING`/
    // `UNRESOLVED` answer `202` and `RESOLVED` answers `200`, so admitting any of them here would describe a
    // `404` body the service cannot produce.
    it('admits only the two statuses that answer 404', () => {
        expect([...terminalFoodStatusSchema.options].sort()).toStrictEqual(['FAILED', 'NOT_FOUND']);
    });

    it('rejects RESOLVED and the non-terminal statuses', () => {
        for (const value of ['RESOLVED', 'PENDING', 'UNRESOLVED']) {
            expect(terminalFoodStatusSchema.safeParse(value).success).toBe(false);
        }
    });

    // Together the two subsets must tile the lifecycle exactly: every status either answers 202, answers 404,
    // or is `RESOLVED`. A migration that adds a sixth value fails HERE, forcing a decision about which status
    // code it answers with, instead of silently landing in neither subset.
    it('partitions the lifecycle with pendingFoodStatusSchema and RESOLVED, exhaustively', () => {
        const partitioned = [...pendingFoodStatusSchema.options, ...terminalFoodStatusSchema.options, 'RESOLVED'];

        expect([...partitioned].sort()).toStrictEqual([...foodStatusSchema.options].sort());
    });
});

describe('pendingResponseSchema', () => {
    // ⚠️ THE DEFECT THIS PINS. `status` published the FULL five-value lifecycle while only `PENDING`/
    // `UNRESOLVED` can answer a `202` — so the contract disagreed with itself (`getFoodResultSchema`'s pending
    // arm already used the two-value enum), and `@kitchensink/food-service-client` had to re-narrow at the
    // boundary to keep `GetFoodResult.status` inside its own declared union.
    it('rejects a status a 202 cannot carry', () => {
        for (const status of ['RESOLVED', 'NOT_FOUND', 'FAILED']) {
            expect(pendingResponseSchema.safeParse({ id: 'x', status }).success).toBe(false);
        }
    });

    it('accepts the two statuses a 202 can carry', () => {
        expect(pendingResponseSchema.parse({ id: 'x', status: 'PENDING', estimatedWaitSeconds: 30 })).toStrictEqual({
            id: 'x',
            status: 'PENDING',
            estimatedWaitSeconds: 30,
        });
        expect(pendingResponseSchema.parse({ id: 'x', status: 'UNRESOLVED' }).status).toBe('UNRESOLVED');
    });
});

/**
 * THE ERROR CONTRACT. These are the assertions that keep "one envelope" from decaying back into three, and that
 * keep `404` distinguishable from `409` without anyone parsing English.
 */
describe('foodErrorSchema', () => {
    /** One representative body per published code, as the exception filter renders it. */
    const BODIES: Readonly<Record<string, Record<string, unknown>>> = {
        VALIDATION_FAILED: { code: 'VALIDATION_FAILED', message: 'name: too small', details: { fields: ['name'] } },
        INVALID_ID: { code: 'INVALID_ID', message: 'Malformed food id' },
        BATCH_TOO_LARGE: { code: 'BATCH_TOO_LARGE', message: 'Too many names', details: { maxNames: 100 } },
        UNAUTHORIZED: { code: 'UNAUTHORIZED', message: 'Unauthorized' },
        IDENTITY_SYNC_PENDING: { code: 'IDENTITY_SYNC_PENDING', message: 'Retry with a refreshed token' },
        FORBIDDEN: { code: 'FORBIDDEN', message: 'Operation requires elevated scope' },
        FOOD_PENDING: {
            code: 'FOOD_PENDING',
            message: 'pending',
            details: { id: 'f1', status: 'PENDING', estimatedWaitSeconds: 30 },
        },
        FOOD_NOT_FOUND: { code: 'FOOD_NOT_FOUND', message: 'gone', details: { id: 'f1', status: 'NOT_FOUND' } },
        CANDIDATE_MISMATCH: { code: 'CANDIDATE_MISMATCH', message: 'not in set', details: { id: 'f1' } },
        NOT_RESOLVABLE: { code: 'NOT_RESOLVABLE', message: 'not awaiting', details: { id: 'f1', status: 'PENDING' } },
        FETCH_UNAVAILABLE: { code: 'FETCH_UNAVAILABLE', message: 'shed', details: { retryAfterSeconds: 30 } },
        INTERNAL_ERROR: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    };

    // Exhaustiveness in the direction that matters: a code added to the enum without an arm (or a fixture)
    // fails here rather than reaching a consumer as an un-narrowable body.
    it('has one arm for every published code, and no code without an arm', () => {
        expect([...foodErrorCodeSchema.options].sort()).toStrictEqual(Object.keys(BODIES).sort());

        for (const [code, body] of Object.entries(BODIES)) {
            const parsed = foodErrorSchema.safeParse(body);

            expect(parsed.success, `no arm parsed the ${code} body`).toBe(true);
        }
    });

    // THE REFINEMENT INVARIANT. `foodErrorSchema` is the TYPED view of the same bytes `apiErrorSchema`
    // describes — not a second, competing error shape. Asserted rather than derived, because the two files
    // cannot import each other: generation flattens every authored schema into one directory, so a
    // `*.schema.ts` may import only a FLAT sibling, and `common/api-error.schema.ts` is not one of
    // `foods.schema.ts`'s. This test is what makes that separation safe.
    it('every arm is also a valid apiErrorSchema envelope', () => {
        for (const [code, body] of Object.entries(BODIES)) {
            expect(apiErrorSchema.safeParse(body).success, `${code} is not an envelope`).toBe(true);
        }
    });

    it('narrows the 404 status to a FoodStatus rather than a bare string', () => {
        const parsed = foodErrorSchema.parse(BODIES['FOOD_NOT_FOUND']);

        // The type is what the client consumes; the runtime rejection below is what proves the type is honest.
        expect(parsed.code === 'FOOD_NOT_FOUND' && parsed.details.status).toBe('NOT_FOUND');
        expect(
            foodErrorSchema.safeParse({ code: 'FOOD_NOT_FOUND', message: 'x', details: { id: 'f1', status: 'NOPE' } })
                .success,
        ).toBe(false);
    });

    // 404 and 409 carry different information — missing versus ambiguous — and the whole point of converging the
    // envelope was to keep that difference machine-readable. `/candidate/i.test(message)` was the old test and it
    // is a parser for English: it breaks on the first copy edit, and it matches an unrelated message that happens
    // to contain the word.
    it('discriminates the two 409s and the 404 on `code`, not on the message', () => {
        const mismatch = foodErrorSchema.parse(BODIES['CANDIDATE_MISMATCH']);
        const notResolvable = foodErrorSchema.parse(BODIES['NOT_RESOLVABLE']);

        expect(mismatch.code).toBe('CANDIDATE_MISMATCH');
        expect(notResolvable.code).toBe('NOT_RESOLVABLE');
        // Reworded prose, identical discrimination — the assertion that would fail under a regex over `message`.
        expect(
            foodErrorSchema.parse({
                code: 'CANDIDATE_MISMATCH',
                message: 'Your pick is unknown here',
                details: { id: 'f1' },
            }).code,
        ).toBe('CANDIDATE_MISMATCH');
    });

    // Forward compatibility, deliberately: a DEPLOYED service adds codes ahead of a released mobile binary, so
    // an unknown code must not parse as a known one. The consumer's fallback is "map by status alone".
    it('refuses a code it has not been taught, instead of coercing it into an arm', () => {
        expect(foodErrorSchema.safeParse({ code: 'FOOD_ON_FIRE', message: 'x' }).success).toBe(false);
        // …while the generic envelope still accepts it, which is exactly the division of labour.
        expect(apiErrorSchema.safeParse({ code: 'FOOD_ON_FIRE', message: 'x' }).success).toBe(true);
    });

    // A body missing the detail its code promises must FAIL the typed parse rather than yield `undefined` deep
    // inside a caller. This is the mutation-lens case for making `details` required per arm.
    it('requires the details its code promises', () => {
        expect(foodErrorSchema.safeParse({ code: 'FOOD_NOT_FOUND', message: 'gone' }).success).toBe(false);
        expect(foodErrorSchema.safeParse({ code: 'FETCH_UNAVAILABLE', message: 'shed' }).success).toBe(false);
        expect(foodErrorSchema.safeParse({ code: 'NOT_RESOLVABLE', message: 'x', details: { id: 'f1' } }).success).toBe(
            false,
        );
    });

    it('tolerates an unknown extra detail key, so a forward-compatible deploy is not a client crash', () => {
        const parsed = foodErrorSchema.parse({
            code: 'FOOD_NOT_FOUND',
            message: 'gone',
            details: { id: 'f1', status: 'FAILED', attempts: 7 },
        });

        expect(parsed.code === 'FOOD_NOT_FOUND' && parsed.details['attempts']).toBe(7);
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
