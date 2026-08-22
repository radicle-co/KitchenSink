/**
 * REQ-005a/REQ-005b/REQ-005c/REQ-006 — non-negative time + positive servings, AND the int4 ceiling that
 * turned five of these fields from a `500` into the `400` they always were.
 *
 * REQ-005a/b/c: prep/cook/total time are each recorded as a NON-NEGATIVE integer number of minutes.
 * REQ-006: servings is recorded as a POSITIVE integer.
 *
 * The lower bounds are characterization coverage carried across the §15.2 convergence unchanged. The UPPER
 * bounds are new and they are a bug fix: `servings`, `prepTimeMinutes`, `cookTimeMinutes`,
 * `totalTimeMinutes`, `timerSeconds` and `expectedVersion` all reach `integer` (int4) columns and had no
 * maximum on either side, so `{ "servings": 9999999999 }` passed validation and died at the INSERT with
 * `22003 value "9999999999" is out of range for type integer` — collapsed by the `ApiExceptionFilter` into a
 * generic `500`. The mechanical, schema-wide version of this invariant lives in
 * `src/database/__tests__/storageCapacity.test.ts`; these cases pin the specific fields through the SAME
 * `ZodValidationPipe` the controller applies, because a schema that is correct but unwired validates nothing.
 */
import type { ArgumentMetadata } from '@nestjs/common';
import { ZodValidationPipe } from 'nestjs-zod';
import { describe, expect, it } from 'vitest';

import { CreateRecipeDto } from '../createRecipe.dto.js';
import { UpdateRecipeDto } from '../updateRecipe.dto.js';

/** The exact pipe the `RecipesController` applies (`@UsePipes(ZodValidationPipe)`). */
const pipe = new ZodValidationPipe();

const createMeta = { type: 'body', metatype: CreateRecipeDto } as ArgumentMetadata;
const updateMeta = { type: 'body', metatype: UpdateRecipeDto } as ArgumentMetadata;

/** The int4 ceiling — the largest value any of these fields may carry. */
const INT4_CEILING = 2_147_483_647;

/** A minimal-but-valid create body; `over` layers the field under test on top. */
function createBody(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        title: 'Numeric Bounds DTO Recipe',
        servings: 2,
        prepTimeMinutes: 5,
        cookTimeMinutes: 10,
        totalTimeMinutes: 15,
        ingredients: [
            {
                ingredientId: '00000000-0000-4000-8000-0000000000aa',
                name: 'Flour',
                quantity: { kind: 'exact', value: 1 },
            },
        ],
        steps: [{ instruction: 'Mix.' }],
        ...over,
    };
}

/** Parse a create body through the real pipe. */
function create(over: Record<string, unknown> = {}): CreateRecipeDto {
    return pipe.transform(createBody(over), createMeta) as CreateRecipeDto;
}

/** Parse an update body through the real pipe. */
function update(over: Record<string, unknown>): UpdateRecipeDto {
    return pipe.transform({ expectedVersion: 1, ...over }, updateMeta) as UpdateRecipeDto;
}

const TIME_FIELDS = ['prepTimeMinutes', 'cookTimeMinutes', 'totalTimeMinutes'] as const;

describe('CreateRecipeDto time fields (REQ-005a/b/c)', () => {
    it.each(TIME_FIELDS)('rejects %s = -1', (field) => {
        expect(() => create({ [field]: -1 })).toThrow();
    });

    it.each(TIME_FIELDS)('accepts %s = 0', (field) => {
        expect(create({ [field]: 0 })[field]).toBe(0);
    });

    it.each(TIME_FIELDS)('accepts %s at the int4 ceiling', (field) => {
        expect(create({ [field]: INT4_CEILING })[field]).toBe(INT4_CEILING);
    });

    it.each(TIME_FIELDS)('REJECTS %s one past the int4 ceiling (was a 500 at the INSERT)', (field) => {
        expect(() => create({ [field]: INT4_CEILING + 1 })).toThrow();
    });

    it.each(TIME_FIELDS)('REJECTS %s = 9999999999, the measured 500', (field) => {
        expect(() => create({ [field]: 9_999_999_999 })).toThrow();
    });

    it.each(TIME_FIELDS)('rejects a fractional %s rather than truncating it', (field) => {
        expect(() => create({ [field]: 2.5 })).toThrow();
    });
});

describe('UpdateRecipeDto time fields (REQ-005a/b/c)', () => {
    it.each(TIME_FIELDS)('rejects %s = -1 on update', (field) => {
        expect(() => update({ [field]: -1 })).toThrow();
    });

    it.each(TIME_FIELDS)('REJECTS %s past the int4 ceiling on update', (field) => {
        expect(() => update({ [field]: INT4_CEILING + 1 })).toThrow();
    });
});

describe('CreateRecipeDto.servings (REQ-006)', () => {
    it('rejects servings = 0', () => {
        expect(() => create({ servings: 0 })).toThrow();
    });

    it('rejects servings = -1', () => {
        expect(() => create({ servings: -1 })).toThrow();
    });

    it('accepts servings = 1 (the lower bound)', () => {
        expect(create({ servings: 1 }).servings).toBe(1);
    });

    it('accepts servings at the int4 ceiling', () => {
        expect(create({ servings: INT4_CEILING }).servings).toBe(INT4_CEILING);
    });

    it('REJECTS servings = 9999999999 — the exact body that answered 500', () => {
        expect(() => create({ servings: 9_999_999_999 })).toThrow();
    });
});

describe('UpdateRecipeDto.servings (REQ-006)', () => {
    it('rejects servings = 0 on update', () => {
        expect(() => update({ servings: 0 })).toThrow();
    });

    it('rejects servings = -1 on update', () => {
        expect(() => update({ servings: -1 })).toThrow();
    });

    it('REJECTS servings past the int4 ceiling on update', () => {
        expect(() => update({ servings: INT4_CEILING + 1 })).toThrow();
    });
});

describe('UpdateRecipeDto.expectedVersion — bounded because it reaches a WHERE on an int4 column', () => {
    it('is REQUIRED', () => {
        expect(() => pipe.transform({ title: 'No version' }, updateMeta)).toThrow();
    });

    it('rejects 0 and negative versions', () => {
        expect(() => pipe.transform({ expectedVersion: 0 }, updateMeta)).toThrow();
        expect(() => pipe.transform({ expectedVersion: -3 }, updateMeta)).toThrow();
    });

    it('accepts the int4 ceiling', () => {
        expect(update({}).expectedVersion).toBe(1);
        expect((pipe.transform({ expectedVersion: INT4_CEILING }, updateMeta) as UpdateRecipeDto).expectedVersion).toBe(
            INT4_CEILING,
        );
    });

    it('REJECTS one past the int4 ceiling — `WHERE current_version = $1` fails with the same 22003', () => {
        expect(() => pipe.transform({ expectedVersion: INT4_CEILING + 1 }, updateMeta)).toThrow();
    });
});

describe('step timerSeconds — bounded above by int4 and below by the column CHECK', () => {
    it('accepts an omitted timer (the only way to say "no timer")', () => {
        expect(create().steps[0]?.timerSeconds).toBeUndefined();
    });

    it('accepts a positive timer', () => {
        expect(create({ steps: [{ instruction: 'Rest.', timerSeconds: 600 }] }).steps[0]?.timerSeconds).toBe(600);
    });

    it('REJECTS timerSeconds = 0, which violated `CHECK (timer_seconds IS NULL OR timer_seconds > 0)`', () => {
        // The old `@Min(0)` admitted `0`, the service persisted `step.timerSeconds ?? null` (so `0` stayed
        // `0`), and the INSERT violated the check — a 500 for a body the wire had accepted.
        expect(() => create({ steps: [{ instruction: 'Rest.', timerSeconds: 0 }] })).toThrow();
    });

    it('rejects a negative timer', () => {
        expect(() => create({ steps: [{ instruction: 'Rest.', timerSeconds: -1 }] })).toThrow();
    });

    it('accepts the int4 ceiling and REJECTS one past it', () => {
        expect(create({ steps: [{ instruction: 'x', timerSeconds: INT4_CEILING }] }).steps[0]?.timerSeconds).toBe(
            INT4_CEILING,
        );
        expect(() => create({ steps: [{ instruction: 'x', timerSeconds: INT4_CEILING + 1 }] })).toThrow();
    });
});

/**
 * REWRITTEN for U8: `quantity` is no longer a bare number, so every case below now states which MEMBER of
 * the `exact | range | absent` union it is bounding.
 *
 * The property these prove is unchanged and is the whole reason this file exists — a value the
 * `numeric(10,3)` column cannot store must be a **400 at the pipe**, not a Postgres `22003` collapsed into
 * a generic 500. What U8 adds is that the column is reached through THREE wire paths now (`exact.value`,
 * `range.low`, `range.high`), so a bound applied to only one of them would leave the other two open.
 */
describe('ingredient quantity — bounded by numeric(10,3) and its CHECK (quantity > 0)', () => {
    /** Build a single-line ingredients array with the given quantity value object. */
    const withQuantity = (quantity: unknown): Record<string, unknown> => ({
        ingredients: [{ ingredientId: '00000000-0000-4000-8000-0000000000aa', name: 'Flour', quantity }],
    });

    it('accepts the smallest representable quantity (0.001)', () => {
        expect(create(withQuantity({ kind: 'exact', value: 0.001 })).ingredients[0]?.quantity).toEqual({
            kind: 'exact',
            value: 0.001,
        });
    });

    it('rejects a quantity below one scale-3 step, which rounds to 0.000 and fails the CHECK', () => {
        expect(() => create(withQuantity({ kind: 'exact', value: 0.0001 }))).toThrow();
    });

    it('rejects a zero and a negative quantity', () => {
        expect(() => create(withQuantity({ kind: 'exact', value: 0 }))).toThrow();
        expect(() => create(withQuantity({ kind: 'exact', value: -1 }))).toThrow();
    });

    it('accepts the maximum quantity and rejects one past it', () => {
        expect(create(withQuantity({ kind: 'exact', value: 1_000_000 })).ingredients[0]?.quantity).toEqual({
            kind: 'exact',
            value: 1_000_000,
        });
        expect(() => create(withQuantity({ kind: 'exact', value: 1_000_001 }))).toThrow();
    });

    // ⚠️ BOTH bounds of a range land in a `numeric(10,3)` column, so both need the ceiling. A bound applied
    // only to `low` would let `high` through to the INSERT and produce the very `22003`-as-500 this file
    // was created to eliminate.
    it('bounds BOTH ends of a range, not just the lower one', () => {
        expect(create(withQuantity({ kind: 'range', low: 2, high: 1_000_000 })).ingredients[0]?.quantity).toEqual({
            kind: 'range',
            low: 2,
            high: 1_000_000,
        });
        expect(() => create(withQuantity({ kind: 'range', low: 2, high: 1_000_001 }))).toThrow();
        expect(() => create(withQuantity({ kind: 'range', low: 0.0001, high: 3 }))).toThrow();
    });

    // R40/R41 — the state the column now admits, and the pipe must let through.
    it('accepts an ABSENT quantity, which no longer needs a fabricated number', () => {
        expect(create(withQuantity({ kind: 'absent' })).ingredients[0]?.quantity).toEqual({ kind: 'absent' });
    });

    it('rejects the pre-U8 bare number, so no caller can go on sending the old shape unnoticed', () => {
        expect(() => create(withQuantity(1))).toThrow();
    });
});

describe('per-line nutrition overrides — bounded by numeric(8,2) (FR-007a)', () => {
    const NUMERIC_8_2_CEILING = 999_999.99;
    const FIELDS = ['userCalories', 'userProteinG', 'userCarbsG', 'userFatG'] as const;

    /** Build a single-line ingredients array carrying one nutrition override. */
    const withOverride = (field: string, value: number): Record<string, unknown> => ({
        ingredients: [
            {
                ingredientId: '00000000-0000-4000-8000-0000000000aa',
                name: 'Flour',
                quantity: { kind: 'exact', value: 1 },
                [field]: value,
            },
        ],
    });

    it.each(FIELDS)('accepts %s = 0', (field) => {
        expect(create(withOverride(field, 0)).ingredients[0]?.[field]).toBe(0);
    });

    it.each(FIELDS)('rejects a negative %s', (field) => {
        expect(() => create(withOverride(field, -1))).toThrow();
    });

    it.each(FIELDS)('accepts %s at the numeric(8,2) ceiling', (field) => {
        expect(create(withOverride(field, NUMERIC_8_2_CEILING)).ingredients[0]?.[field]).toBe(NUMERIC_8_2_CEILING);
    });

    it.each(FIELDS)('REJECTS %s above the numeric(8,2) ceiling (was `22003 numeric field overflow`)', (field) => {
        expect(() => create(withOverride(field, 1_000_000))).toThrow();
        expect(() => create(withOverride(field, 99_999_999))).toThrow();
    });

    it('REJECTS a value that ROUNDS up out of range — 999999.996 becomes 1000000.00', () => {
        // Postgres rounds to the declared scale BEFORE range-checking, so the safe ceiling is one step below
        // the power of ten. Verified against a live PostgreSQL 16.
        expect(() => create(withOverride('userCalories', 999_999.996))).toThrow();
    });
});
