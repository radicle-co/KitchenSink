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
    ingredientQuantitySchema,
    quantitiesEqual,
    quantityLowerBound,
    quantityUpperBound,
    statedQuantity,
    type IngredientQuantity,
} from '../ingredientQuantity.js';
import { MAX_RECIPE_INGREDIENT_QUANTITY, MIN_RECIPE_INGREDIENT_QUANTITY } from '../recipeRequestBounds.js';

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

describe('quantitiesEqual', () => {
    it('holds two structurally identical quantities equal across separate constructions', () => {
        expect(quantitiesEqual(statedQuantity(2) as IngredientQuantity, statedQuantity(2) as IngredientQuantity)).toBe(
            true,
        );
        expect(
            quantitiesEqual(statedQuantity(2, 3) as IngredientQuantity, statedQuantity(2, 3) as IngredientQuantity),
        ).toBe(true);
        expect(quantitiesEqual(ABSENT_QUANTITY, { kind: 'absent' })).toBe(true);
    });

    // ⚠️ THE REGRESSION THIS FUNCTION EXISTS FOR. `ingredientContentChanged` compared quantities with
    // `!==`, and `ingredientsChanged` (recipe service) with `Number(row.quantity) !== next.quantity`.
    // Against a value OBJECT `!==` is reference identity, so every ingredient would read as modified in
    // every version diff — and every update would read as a C-004 substantive edit.
    it('does not fall back to reference identity', () => {
        const a = statedQuantity(2, 3) as IngredientQuantity;
        const b = statedQuantity(2, 3) as IngredientQuantity;

        expect(a).not.toBe(b);
        expect(quantitiesEqual(a, b)).toBe(true);
    });

    // ⚠️ The plan's own warning: a field-by-field enumeration is blind to a new field BY CONSTRUCTION,
    // so an upper-bound-only edit was the change most likely to go unnoticed.
    it('separates two ranges that differ only in their UPPER bound', () => {
        expect(
            quantitiesEqual(statedQuantity(2, 3) as IngredientQuantity, statedQuantity(2, 4) as IngredientQuantity),
        ).toBe(false);
    });

    it('separates two ranges that differ only in their lower bound', () => {
        expect(
            quantitiesEqual(statedQuantity(2, 4) as IngredientQuantity, statedQuantity(3, 4) as IngredientQuantity),
        ).toBe(false);
    });

    it('separates the three members from each other', () => {
        const exact = statedQuantity(2) as IngredientQuantity;
        const range = statedQuantity(2, 3) as IngredientQuantity;

        expect(quantitiesEqual(exact, range)).toBe(false);
        expect(quantitiesEqual(exact, ABSENT_QUANTITY)).toBe(false);
        expect(quantitiesEqual(range, ABSENT_QUANTITY)).toBe(false);
    });

    it('separates two exact quantities of different value', () => {
        expect(
            quantitiesEqual(statedQuantity(2) as IngredientQuantity, statedQuantity(2.5) as IngredientQuantity),
        ).toBe(false);
    });
});

describe('ingredientQuantitySchema', () => {
    it('accepts each of the three members', () => {
        expect(ingredientQuantitySchema.safeParse({ kind: 'exact', value: 2 }).success).toBe(true);
        expect(ingredientQuantitySchema.safeParse({ kind: 'range', low: 2, high: 3 }).success).toBe(true);
        expect(ingredientQuantitySchema.safeParse({ kind: 'absent' }).success).toBe(true);
    });

    it('round-trips every constructed quantity, so the wire cannot refuse what the domain builds', () => {
        for (const quantity of [
            statedQuantity(2),
            statedQuantity(2, 3),
            statedQuantity(MIN_RECIPE_INGREDIENT_QUANTITY),
            statedQuantity(MAX_RECIPE_INGREDIENT_QUANTITY),
            ABSENT_QUANTITY,
        ]) {
            expect(ingredientQuantitySchema.parse(quantity)).toEqual(quantity);
        }
    });

    it('refuses an inverted range, the state the loose pair could spell and this one cannot', () => {
        expect(ingredientQuantitySchema.safeParse({ kind: 'range', low: 3, high: 2 }).success).toBe(false);
    });

    // A range whose bounds coincide IS an exact quantity — `statedQuantity` collapses it — so admitting
    // it here would give one amount two wire representations.
    it('refuses a range whose bounds coincide, because that amount has ONE representation', () => {
        expect(ingredientQuantitySchema.safeParse({ kind: 'range', low: 2, high: 2 }).success).toBe(false);
    });

    it('refuses an upper bound with no lower bound', () => {
        expect(ingredientQuantitySchema.safeParse({ kind: 'range', high: 3 }).success).toBe(false);
    });

    it('refuses a zero or negative amount on every member that carries one', () => {
        expect(ingredientQuantitySchema.safeParse({ kind: 'exact', value: 0 }).success).toBe(false);
        expect(ingredientQuantitySchema.safeParse({ kind: 'exact', value: -1 }).success).toBe(false);
        expect(ingredientQuantitySchema.safeParse({ kind: 'range', low: 0, high: 3 }).success).toBe(false);
    });

    it('holds each bound inside the window the numeric(10,3) column can store', () => {
        expect(ingredientQuantitySchema.safeParse({ kind: 'exact', value: 0.0009 }).success).toBe(false);
        expect(ingredientQuantitySchema.safeParse({ kind: 'exact', value: 1_000_000.001 }).success).toBe(false);
        expect(
            ingredientQuantitySchema.safeParse({ kind: 'range', low: 2, high: MAX_RECIPE_INGREDIENT_QUANTITY + 1 })
                .success,
        ).toBe(false);
    });

    it('refuses an unknown member and stray fields, so a mis-spelled range cannot be silently narrowed', () => {
        expect(ingredientQuantitySchema.safeParse({ kind: 'approximate', value: 2 }).success).toBe(false);
        // The hazard by name: a client meaning `2 to 5` that mis-spells the member would otherwise have
        // its upper bound dropped and persist as an exact `2`.
        expect(ingredientQuantitySchema.safeParse({ kind: 'exact', value: 2, high: 5 }).success).toBe(false);
        expect(ingredientQuantitySchema.safeParse({ kind: 'absent', value: 0 }).success).toBe(false);
    });

    it('refuses a bare number — the shape this replaces', () => {
        expect(ingredientQuantitySchema.safeParse(2).success).toBe(false);
        expect(ingredientQuantitySchema.safeParse(null).success).toBe(false);
    });
});
