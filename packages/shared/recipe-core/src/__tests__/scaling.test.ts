/**
 * Unit tests for display-only recipe scaling ({@link scaleRecipeForServings} and friends).
 *
 * The model under test is deliberately NOT "multiply everything by the ratio". Ingredient quantities and
 * HANDS-ON prep time are quantity-proportional and scale; COOK time is thermally bounded and does not.
 * These tests are written to fail loudly if either half of that rule is broken — in particular, a naive
 * "scale every minute field" implementation must fail here, because understating cook time is a food-safety
 * error, not a rounding difference.
 *
 * Scaling never mutates the recipe and never touches the wire; it is a pure projection for display.
 */
import { describe, expect, it } from 'vitest';

import { ABSENT_QUANTITY, statedQuantity, type IngredientQuantity } from '../ingredientQuantity.js';
import { computeRecipeNutrition } from '../nutrition.js';
import type { NutritionLine } from '../nutrition.js';
import {
    MAX_SCALED_SERVINGS,
    MIN_SCALED_SERVINGS,
    clampServings,
    isRecipeScalingError,
    makeRecipeScaling,
    scaleQuantity,
    scaleRecipeForServings,
    servingsRange,
    type ScalableRecipe,
} from '../scaling.js';
import type { RecipeIngredientView } from '../recipe.types.js';

/**
 * A quantity the source stated exactly. Narrowing local, so the specs below read as amounts rather than as
 * assertions about the smart constructor (which has its own suite).
 */
function exact(value: number): IngredientQuantity {
    const quantity = statedQuantity(value);

    if (quantity === null) {
        throw new Error(`test fixture: ${value} is not a statable amount`);
    }

    return quantity;
}

/** A quantity the source stated as two bounds. */
function range(low: number, high: number): IngredientQuantity {
    const quantity = statedQuantity(low, high);

    if (quantity === null) {
        throw new Error(`test fixture: ${low}..${high} is not a statable range`);
    }

    return quantity;
}

/** A four-serving recipe: 15 min prep, 30 min cook, 50 min total (5 minutes of it inactive resting). */
function makeScalable(overrides: Partial<ScalableRecipe> = {}): ScalableRecipe {
    return {
        servings: 4,
        prepTimeMinutes: 15,
        cookTimeMinutes: 30,
        totalTimeMinutes: 50,
        ingredients: [
            { ingredientId: 'ing_1', name: 'Lamb shoulder', quantity: exact(1.5), unit: 'lb', isUserEntered: false },
            {
                ingredientId: 'ing_2',
                name: 'Garlic',
                quantity: exact(3),
                unit: 'cloves',
                notes: 'minced',
                isUserEntered: true,
            },
        ],
        ...overrides,
    };
}

describe('makeRecipeScaling', () => {
    it('is the identity at the recipe’s own serving count', () => {
        const scaling = makeRecipeScaling(4, 4);

        expect(scaling).toEqual({ baseServings: 4, servings: 4, ratio: 1, isScaled: false });
    });

    it('reports the ratio for an increase and a decrease', () => {
        expect(makeRecipeScaling(4, 8)).toEqual({ baseServings: 4, servings: 8, ratio: 2, isScaled: true });
        expect(makeRecipeScaling(4, 3)).toEqual({ baseServings: 4, servings: 3, ratio: 0.75, isScaled: true });
        expect(makeRecipeScaling(2, 1)).toEqual({ baseServings: 2, servings: 1, ratio: 0.5, isScaled: true });
    });

    it('accepts both ends of the supported range', () => {
        expect(makeRecipeScaling(4, MIN_SCALED_SERVINGS).servings).toBe(MIN_SCALED_SERVINGS);
        expect(makeRecipeScaling(4, MAX_SCALED_SERVINGS).servings).toBe(MAX_SCALED_SERVINGS);
    });

    it('never refuses a recipe’s OWN serving count, however large it is', () => {
        // The display cap is a cap on what the CONTROL offers, not a claim about what recipes exist: the
        // wire allows a serving count up to INT4_CEILING. A range that ignored this would throw on the very
        // first render of a legitimate 250-serving recipe — before the cook touched anything.
        const huge = MAX_SCALED_SERVINGS + 150;

        expect(makeRecipeScaling(huge, huge)).toEqual({
            baseServings: huge,
            servings: huge,
            ratio: 1,
            isScaled: false,
        });
        expect(servingsRange(huge)).toEqual({ min: MIN_SCALED_SERVINGS, max: huge });
        // …and the cap still binds for an ordinary recipe.
        expect(servingsRange(4)).toEqual({ min: MIN_SCALED_SERVINGS, max: MAX_SCALED_SERVINGS });
    });

    it.each<[number, string]>([
        [0, 'zero servings'],
        [-2, 'negative servings'],
        [2.5, 'a fractional serving count'],
        [Number.NaN, 'NaN'],
        [Number.POSITIVE_INFINITY, 'Infinity'],
        [MAX_SCALED_SERVINGS + 1, 'beyond the supported maximum'],
    ])('refuses %s (%s) rather than computing a nonsense ratio', (servings) => {
        expect(() => makeRecipeScaling(4, servings)).toThrow();
    });

    it.each([[0], [-4], [2.5], [Number.NaN]])(
        'refuses a recipe whose own serving count is %s (a data defect, not a user choice)',
        (base) => {
            expect(() => makeRecipeScaling(base, 4)).toThrow();
        },
    );

    it('throws an error the caller can identify by its guard', () => {
        try {
            makeRecipeScaling(4, 0);
            expect.unreachable('makeRecipeScaling accepted 0 servings');
        } catch (error) {
            expect(isRecipeScalingError(error)).toBe(true);
            expect(isRecipeScalingError(new Error('nope'))).toBe(false);
        }
    });
});

describe('clampServings', () => {
    it.each([
        [0, MIN_SCALED_SERVINGS],
        [-5, MIN_SCALED_SERVINGS],
        [1, 1],
        [7, 7],
        [MAX_SCALED_SERVINGS, MAX_SCALED_SERVINGS],
        [MAX_SCALED_SERVINGS + 50, MAX_SCALED_SERVINGS],
        [4.4, 4],
        [4.5, 5],
        [Number.NaN, MIN_SCALED_SERVINGS],
        [Number.POSITIVE_INFINITY, MAX_SCALED_SERVINGS],
        [Number.NEGATIVE_INFINITY, MIN_SCALED_SERVINGS],
    ])('maps %s to %s so the control can never hold an unrepresentable serving count', (input, expected) => {
        expect(clampServings(input, 4)).toBe(expected);
    });

    it('lets a large recipe scale across its own range', () => {
        const huge = MAX_SCALED_SERVINGS + 150;

        // Clamping to the flat cap here would trap the cook: one tap on "fewer" and they could never get
        // back to the recipe's own yield.
        expect(clampServings(huge, huge)).toBe(huge);
        expect(clampServings(huge + 1, huge)).toBe(huge);
    });

    it('produces a value makeRecipeScaling always accepts', () => {
        // The two functions share one range definition; this is the assertion that keeps them in step, and
        // it is what makes the throw in `makeRecipeScaling` unreachable from a clamped UI.
        for (const base of [1, 4, 100, 250]) {
            for (const candidate of [-10, 0, 1, 3.6, 100, 101, 1000, Number.NaN]) {
                expect(() => makeRecipeScaling(base, clampServings(candidate, base))).not.toThrow();
            }
        }
    });
});

describe('scaleQuantity', () => {
    it('returns the stored quantity unchanged at 1x', () => {
        const scaling = makeRecipeScaling(4, 4);

        expect(scaleQuantity(exact(1.5), scaling)).toEqual(exact(1.5));
        expect(scaleQuantity(exact(0.125), scaling)).toEqual(exact(0.125));
    });

    it('scales linearly', () => {
        expect(scaleQuantity(exact(1.5), makeRecipeScaling(4, 8))).toEqual(exact(3));
        expect(scaleQuantity(exact(3), makeRecipeScaling(4, 2))).toEqual(exact(1.5));
        expect(scaleQuantity(exact(2), makeRecipeScaling(4, 3))).toEqual(exact(1.5));
    });

    it('erases IEEE-754 artifacts without destroying genuine culinary precision', () => {
        // 0.3 * (1/3) is 0.09999999999999999 in binary floating point; a cook must not read "0.099999…".
        expect(scaleQuantity(exact(0.3), makeRecipeScaling(3, 1))).toEqual(exact(0.1));
        // …but an eighth of a teaspoon at 1x is a real quantity and must survive: rounding for DISPLAY is
        // the render layer's job, and rounding here to 2 places would silently erase it.
        expect(scaleQuantity(exact(0.125), makeRecipeScaling(2, 1))).toEqual(exact(0.0625));
    });

    // R37 — the half a scalar could not express. Scaling only the lower bound would quietly narrow every
    // ranged line the moment a cook touched the serving control.
    it('scales BOTH bounds of a range (R37): 4→6 servings turns 2 to 3 into 3 to 4.5', () => {
        expect(scaleQuantity(range(2, 3), makeRecipeScaling(4, 6))).toEqual(range(3, 4.5));
    });

    it('leaves a range untouched at the recipe’s own serving count', () => {
        expect(scaleQuantity(range(2, 3), makeRecipeScaling(4, 4))).toEqual(range(2, 3));
    });

    // ⛔ R40. Scaling has no number to multiply here, and every wrong answer fabricates one: `0`, `1`, or
    // the ratio itself. The only honest projection of "the source stated no amount" is itself.
    it('carries an ABSENT quantity through without fabricating a number', () => {
        expect(scaleQuantity(ABSENT_QUANTITY, makeRecipeScaling(4, 8))).toEqual(ABSENT_QUANTITY);
        expect(scaleQuantity(ABSENT_QUANTITY, makeRecipeScaling(4, 4))).toEqual(ABSENT_QUANTITY);
    });

    // The value object's smart constructor is the only door into a well-formed quantity, but `scaleQuantity`
    // is exported and TypeScript cannot prove its argument came through that door. A cast-in bound must
    // still be refused rather than silently producing `NaN` on a cook's screen.
    it('refuses a bound that is not a finite, positive number', () => {
        const scaling = makeRecipeScaling(4, 8);

        expect(() => scaleQuantity({ kind: 'exact', value: -1 }, scaling)).toThrow();
        expect(() => scaleQuantity({ kind: 'exact', value: Number.NaN }, scaling)).toThrow();
        expect(() => scaleQuantity({ kind: 'exact', value: Number.POSITIVE_INFINITY }, scaling)).toThrow();
        expect(() => scaleQuantity({ kind: 'range', low: 2, high: Number.NaN }, scaling)).toThrow();
    });
});

describe('scaleRecipeForServings — quantities', () => {
    it('leaves every quantity untouched at the recipe’s own serving count', () => {
        const recipe = makeScalable();
        const scaled = scaleRecipeForServings(recipe, 4);

        expect(scaled.ingredients.map((line) => line.quantity)).toEqual([exact(1.5), exact(3)]);
        expect(scaled.scaling.isScaled).toBe(false);
    });

    it('scales every quantity by the serving ratio', () => {
        const scaled = scaleRecipeForServings(makeScalable(), 6);

        expect(scaled.ingredients.map((line) => line.quantity)).toEqual([exact(2.25), exact(4.5)]);
    });

    // R36/R37 end-to-end through the projection every detail view reads: a mixed recipe keeps its exact
    // line exact, its ranged line ranged with BOTH bounds moved, and its unquantified line unquantified.
    it('scales a mixed recipe of exact, ranged and absent quantities without collapsing any of them', () => {
        const scaled = scaleRecipeForServings(
            makeScalable({
                ingredients: [
                    { ingredientId: 'a', name: 'Flour', quantity: range(2, 3), unit: 'cup', isUserEntered: false },
                    { ingredientId: 'b', name: 'Salt', quantity: exact(1), unit: 'tsp', isUserEntered: false },
                    { ingredientId: 'c', name: 'Butter', quantity: ABSENT_QUANTITY, isUserEntered: true },
                ],
            }),
            6,
        );

        expect(scaled.ingredients.map((line) => line.quantity)).toEqual([range(3, 4.5), exact(1.5), ABSENT_QUANTITY]);
    });

    it('preserves each line’s identity, unit, notes, order, and user-entered flag', () => {
        const scaled = scaleRecipeForServings(makeScalable(), 8);

        expect(scaled.ingredients).toEqual([
            { ingredientId: 'ing_1', name: 'Lamb shoulder', quantity: exact(3), unit: 'lb', isUserEntered: false },
            {
                ingredientId: 'ing_2',
                name: 'Garlic',
                quantity: exact(6),
                unit: 'cloves',
                notes: 'minced',
                isUserEntered: true,
            },
        ]);
    });

    it('does not mutate the recipe it was handed', () => {
        const recipe = makeScalable();

        scaleRecipeForServings(recipe, 12);

        expect(recipe.ingredients[0]?.quantity).toEqual(exact(1.5));
        expect(recipe.prepTimeMinutes).toBe(15);
        expect(recipe.totalTimeMinutes).toBe(50);
    });
});

describe('scaleRecipeForServings — timings (the safety-critical half)', () => {
    it('scales HANDS-ON prep time with the batch', () => {
        expect(scaleRecipeForServings(makeScalable(), 8).prepTimeMinutes).toBe(30);
        expect(scaleRecipeForServings(makeScalable(), 2).prepTimeMinutes).toBe(8);
    });

    it('NEVER scales cook time — doubling a casserole does not double its bake time', () => {
        // The single most important assertion in this file. A linear "scale all timings" implementation
        // returns 60 here and would tell a cook to bake a double batch for twice as long; understating or
        // overstating a thermal process is a food-safety error, not a display preference.
        expect(scaleRecipeForServings(makeScalable(), 8).cookTimeMinutes).toBe(30);
        expect(scaleRecipeForServings(makeScalable(), 2).cookTimeMinutes).toBe(30);
        expect(scaleRecipeForServings(makeScalable(), MAX_SCALED_SERVINGS).cookTimeMinutes).toBe(30);
    });

    it('rebuilds total time from the prep delta, preserving inactive time', () => {
        // 50 total = 15 prep + 30 cook + 5 inactive (resting). Doubling adds only the extra 15 min of prep:
        // the rest and the bake are unchanged, so the strip stays internally consistent.
        expect(scaleRecipeForServings(makeScalable(), 8).totalTimeMinutes).toBe(65);
        // Halving gives back 7 minutes of prep (15 → 8), never the cook or the rest.
        expect(scaleRecipeForServings(makeScalable(), 2).totalTimeMinutes).toBe(43);
    });

    it('keeps every timing a whole number of minutes', () => {
        const scaled = scaleRecipeForServings(makeScalable(), 5);

        // 15 min prep at 1.25x is 18.75 — a cook reads minutes, not fractions of one.
        expect(scaled.prepTimeMinutes).toBe(19);
        expect(Number.isInteger(scaled.totalTimeMinutes)).toBe(true);
    });

    it('leaves a zero timing at zero', () => {
        const noCook = makeScalable({ prepTimeMinutes: 0, cookTimeMinutes: 0, totalTimeMinutes: 0 });
        const scaled = scaleRecipeForServings(noCook, MAX_SCALED_SERVINGS);

        expect(scaled).toMatchObject({ prepTimeMinutes: 0, cookTimeMinutes: 0, totalTimeMinutes: 0 });
    });

    it('never reports a negative total, even for a recipe whose stored total is inconsistent', () => {
        const inconsistent = makeScalable({ prepTimeMinutes: 40, cookTimeMinutes: 0, totalTimeMinutes: 10 });

        expect(scaleRecipeForServings(inconsistent, 1).totalTimeMinutes).toBeGreaterThanOrEqual(0);
    });
});

describe('scaled recipes and PER-SERVING nutrition', () => {
    it('leaves per-serving nutrition invariant, which is why scaling never restates it', () => {
        // Scaling multiplies both the ingredient mass AND the serving count by the same ratio, so
        // per-serving macros are mathematically unchanged. This is the proof behind the detail view NOT
        // recomputing (or re-displaying) nutrition when the cook changes the serving count — and the guard
        // against a future "scale the nutrition too" change, which would double-count the ratio.
        const line: NutritionLine = { quantity: exact(200), unit: 'g', caloriesPer100g: 250, proteinGPer100g: 20 };
        const base = computeRecipeNutrition([line], 4);

        for (const servings of [1, 2, 3, 8, MAX_SCALED_SERVINGS]) {
            const scaling = makeRecipeScaling(4, servings);
            const scaledLine: NutritionLine = { ...line, quantity: scaleQuantity(line.quantity, scaling) };

            expect(computeRecipeNutrition([scaledLine], servings)).toEqual(base);
        }
    });
});

describe('ScalableRecipe contract', () => {
    it('accepts any object carrying the fields scaling reads, not a whole RecipeDetail', () => {
        // Scaling is a projection over four numbers and the ingredient lines; demanding a full detail (with
        // ids, photos, ratings, visibility…) would couple a pure arithmetic module to the read model.
        const lines: readonly RecipeIngredientView[] = [
            { ingredientId: 'ing_x', name: 'Salt', quantity: exact(1), unit: 'tsp', isUserEntered: false },
        ];
        const minimal: ScalableRecipe = {
            servings: 2,
            prepTimeMinutes: 5,
            cookTimeMinutes: 0,
            totalTimeMinutes: 5,
            ingredients: lines,
        };

        expect(scaleRecipeForServings(minimal, 4).ingredients[0]?.quantity).toEqual(exact(2));
    });
});

describe('scaleQuantity — the UNSCALED default view', () => {
    it('returns a stored quantity byte-for-byte at 1x, however many decimals it carries', () => {
        // The default view is the recipe as authored. Rounding it — even to six places — would rewrite
        // stored data on first paint, before the cook has asked for anything.
        const scaling = makeRecipeScaling(4, 4);
        const awkward = 0.123456789;

        expect(scaleQuantity(exact(awkward), scaling)).toEqual(exact(awkward));
        expect(
            scaleRecipeForServings(
                makeScalable({
                    ingredients: [{ ingredientId: 'i', name: 'x', quantity: exact(awkward), isUserEntered: false }],
                }),
                4,
            ).ingredients[0]?.quantity,
        ).toEqual(exact(awkward));
    });
});
