/**
 * Unit tests for {@link lineNutritionSource} — the pure predicate that says WHETHER a line was accounted
 * for and, when it was, WHICH source accounted for it.
 *
 * ## Why this exists as its own exported rule
 *
 * `computeRecipeNutrition` answers with a TOTAL and one boolean (`isComplete`). Two questions the deferred
 * nutrition endpoint must answer are not derivable from that pair:
 *
 *  1. **"Did ANY line contribute?"** — a recipe whose lines genuinely sum to `0` (water, black coffee) and a
 *     recipe where nothing could be accounted for both report `calories: 0`. The first is `known` with a real
 *     measured zero; the second is `unaccounted`. `isComplete` cannot separate them either: a recipe with one
 *     accounted zero-calorie line and one unaccountable line is `isComplete: false` with a `0` total, and it
 *     is still `known`.
 *  2. **"Did this recipe's figure come from FOOD data?"** — KTD-3b marks a reading `stale` when it was served
 *     from cache during a food outage. A recipe whose numbers are entirely the user's own per-line overrides
 *     drew on no food data at all, so marking it stale because a SIBLING recipe's food lookup failed would be
 *     a caveat about data the reading does not contain.
 *
 * Re-deriving either answer in the recipe service would be a second copy of `lineMacros`' accounting rule
 * (override wins; catalog needs a convertible unit), free to drift from the aggregator that produces the
 * numbers. This is that one rule, exported.
 */
import { describe, expect, it } from 'vitest';

import { statedQuantity, type IngredientQuantity } from '../ingredientQuantity.js';
import { computeRecipeNutrition, lineNutritionSource, type NutritionLine } from '../nutrition.js';

/** A quantity the source stated exactly. */
function exact(value: number): IngredientQuantity {
    const quantity = statedQuantity(value);

    if (quantity === null) {
        throw new Error(`test fixture: ${value} is not a statable amount`);
    }

    return quantity;
}

describe('lineNutritionSource', () => {
    it('reports `user` for a line carrying a per-line override', () => {
        expect(lineNutritionSource({ quantity: exact(1), unit: 'scoop', userCalories: 200 })).toBe('user');
    });

    it('⛔ reports `user` even when the line ALSO has catalog nutrition — the override wins', () => {
        // The priority rule this predicate must not restate differently from `lineMacros`: a user override
        // is authoritative, so the reading does NOT draw on food data and must never be marked stale.
        const line: NutritionLine = { quantity: exact(200), unit: 'g', userCalories: 10, caloriesPer100g: 350 };

        expect(lineNutritionSource(line)).toBe('user');
    });

    it('reports `catalog` for a mass-unit line with per-100g nutrition', () => {
        expect(lineNutritionSource({ quantity: exact(200), unit: 'g', caloriesPer100g: 350 })).toBe('catalog');
    });

    it('reports `catalog` when a volumetric unit converts through a stored portion', () => {
        const line: NutritionLine = {
            quantity: exact(2),
            unit: 'cups',
            caloriesPer100g: 350,
            portions: [{ unit: 'cup', gramsPerUnit: 125 }],
        };

        expect(lineNutritionSource(line)).toBe('catalog');
    });

    it('⛔ reports `null` for catalog nutrition the unit cannot convert — accounted is not "has data"', () => {
        // A `clove` with no matching portion has no known gram weight, so the per-100g figure cannot be
        // scaled. `lineMacros` excludes it from the sum; this must agree, or the endpoint would call a
        // recipe `known` on the strength of a line contributing nothing.
        expect(lineNutritionSource({ quantity: exact(3), unit: 'cloves', caloriesPer100g: 350 })).toBeNull();
    });

    it('reports `null` for a line with neither an override nor catalog nutrition', () => {
        expect(lineNutritionSource({ quantity: exact(1), unit: 'pinch' })).toBeNull();
    });

    it('⛔ separates a genuine measured zero from an unaccounted line, which the totals cannot', () => {
        // The exact pair the deferred-nutrition contract turns on. Both compute to `calories: 0`.
        const water: NutritionLine = { quantity: exact(250), unit: 'g', caloriesPer100g: 0 };
        const unknown: NutritionLine = { quantity: exact(1), unit: 'pinch' };

        expect(computeRecipeNutrition([water], 1).calories).toBe(0);
        expect(computeRecipeNutrition([unknown], 1).calories).toBe(0);
        expect(lineNutritionSource(water)).toBe('catalog');
        expect(lineNutritionSource(unknown)).toBeNull();
    });

    it('agrees with `computeRecipeNutrition`s completeness verdict over a whole line set', () => {
        // The invariant that keeps the two from drifting: `isComplete` is exactly "every line has a source".
        const lines: NutritionLine[] = [
            { quantity: exact(200), unit: 'g', caloriesPer100g: 350 },
            { quantity: exact(1), unit: 'pinch' },
        ];

        expect(lines.every((line) => lineNutritionSource(line) !== null)).toBe(
            computeRecipeNutrition(lines, 1).isComplete,
        );
    });
});
