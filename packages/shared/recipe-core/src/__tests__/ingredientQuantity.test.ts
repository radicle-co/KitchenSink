/**
 * Unit tests for the ingredient QUANTITY value object (KTD-6, R36, R40, R41).
 *
 * | Requirement | Test |
 * | ----------- | ---- |
 * | R36 — a stated range preserves both bounds | the `range` suite |
 * | R40 — no code path fabricates a quantity the source did not state | the `absent` suite |
 * | R41 — the model admits an absent quantity AND a two-bound range | the union's three members |
 *
 * The property that carries the value is **which states cannot be spelled**. A scalar plus two loose
 * bounds can hold `high < low`, `high` with no `low`, and a zero that means "unstated" — three lies the
 * persisted column would accept. Every case below therefore asserts what the constructor REFUSES as
 * hard as it asserts what it builds.
 */
import { describe, it, expect } from 'vitest';

import {
    ABSENT_QUANTITY,
    quantityLowerBound,
    quantityUpperBound,
    statedQuantity,
    type IngredientQuantity,
} from '../ingredientQuantity.js';

describe('statedQuantity', () => {
    describe('a single stated value is EXACT', () => {
        it.each([[1], [0.5], [2.75], [1_000_000], [0.001]])('builds an exact quantity for %d', (value) => {
            expect(statedQuantity(value)).toEqual({ kind: 'exact', value });
        });

        it('treats an absent upper bound as exact rather than as a degenerate range', () => {
            expect(statedQuantity(2, null)).toEqual({ kind: 'exact', value: 2 });
            expect(statedQuantity(2, undefined)).toEqual({ kind: 'exact', value: 2 });
        });

        it('collapses a range whose bounds are equal, so one value has ONE representation', () => {
            expect(statedQuantity(2, 2)).toEqual({ kind: 'exact', value: 2 });
        });
    });

    describe('two stated bounds are a RANGE', () => {
        it('keeps both bounds of "2 to 3"', () => {
            expect(statedQuantity(2, 3)).toEqual({ kind: 'range', low: 2, high: 3 });
        });

        it('keeps a fractional range', () => {
            expect(statedQuantity(0.5, 0.75)).toEqual({ kind: 'range', low: 0.5, high: 0.75 });
        });
    });

    describe('states that are lies are UNBUILDABLE', () => {
        it('refuses an inverted range rather than storing bounds that disagree', () => {
            expect(statedQuantity(3, 2)).toBeNull();
        });

        it.each([[0], [-1], [Number.NaN], [Number.POSITIVE_INFINITY], [Number.NEGATIVE_INFINITY]])(
            'refuses %p as a stated quantity, because it is not an amount',
            (value) => {
                expect(statedQuantity(value)).toBeNull();
            },
        );

        it.each([[Number.NaN], [Number.POSITIVE_INFINITY], [0], [-1]])('refuses %p as an upper bound', (high) => {
            expect(statedQuantity(2, high)).toBeNull();
        });
    });
});

describe('ABSENT_QUANTITY', () => {
    it('is the one representation of "the source stated no quantity" — never a zero', () => {
        expect(ABSENT_QUANTITY).toEqual({ kind: 'absent' });
        expect(quantityLowerBound(ABSENT_QUANTITY)).toBeNull();
        expect(quantityUpperBound(ABSENT_QUANTITY)).toBeNull();
    });

    it('is frozen, so a consumer cannot mutate the shared singleton into a quantity', () => {
        expect(Object.isFrozen(ABSENT_QUANTITY)).toBe(true);
    });
});

describe('the bound accessors', () => {
    const exact = statedQuantity(2) as IngredientQuantity;
    const range = statedQuantity(2, 3) as IngredientQuantity;

    it('reads an exact quantity as both bounds, because "2 cups" IS 2 to 2', () => {
        expect(quantityLowerBound(exact)).toBe(2);
        expect(quantityUpperBound(exact)).toBe(2);
    });

    it('reads a range as its two bounds', () => {
        expect(quantityLowerBound(range)).toBe(2);
        expect(quantityUpperBound(range)).toBe(3);
    });

    it('never reports a bound for an absent quantity, so no caller can collapse it to a number', () => {
        expect(quantityLowerBound(ABSENT_QUANTITY)).toBeNull();
        expect(quantityUpperBound(ABSENT_QUANTITY)).toBeNull();
    });
});
