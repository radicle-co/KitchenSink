/**
 * Unit tests for the deferred-calorie presentation model.
 *
 * These pin the three rules the union exists to enforce, each of which was a live defect class before it:
 *  1. A `known` reading of ZERO is a FIGURE, not an absence — water and black coffee genuinely have none.
 *  2. `stale` and `incomplete` are distinguishable in the ACCESSIBLE NAME, not only in the styling, so the
 *     caveat reaches a screen-reader user rather than only a sighted one.
 *  3. `unaccounted` carries a REASON with its own copy for every member of the wire enum — a missing branch
 *     would otherwise surface as an empty disclosure.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';

import { recipeNutritionMessages } from '../messages.js';
import {
    toCalorieChipModel,
    unaccountedReasonText,
    type RecipeCaloriePending,
    type RecipeCalorieReading,
    type RecipeCalorieState,
    type RecipeNutritionViewState,
} from '../model.js';

const en = recipeNutritionMessages['en'];

/** A complete, fresh reading — the baseline every case below varies exactly one field from. */
const reading = (over: Partial<RecipeCalorieReading> = {}): RecipeCalorieReading => ({
    state: 'known',
    caloriesPerServing: 420,
    isComplete: true,
    freshness: 'fresh',
    ...over,
});

/**
 * The module's central claim is a TYPE relation: the union a render component may switch over is exactly the
 * view state space minus `pending`. Stated only in a docstring it is enforced by nothing — a later edit could
 * add a third settled member to one and not the other and every runtime test would stay green. Asserted here,
 * the claim fails the build instead.
 */
describe('the resolved union is the view state space minus pending — by construction', () => {
    it('excludes exactly the pending member and nothing else', () => {
        expectTypeOf<Exclude<RecipeNutritionViewState, RecipeCaloriePending>>().toEqualTypeOf<RecipeCalorieState>();
    });

    // The complement: `pending` really is IN the view union (so the skeleton has a state to render) and really
    // is NOT in the resolved one (so the chip structurally cannot be handed it).
    it('admits pending as a view state, and never as a resolved one', () => {
        expectTypeOf<RecipeCaloriePending>().toExtend<RecipeNutritionViewState>();
        expectTypeOf<RecipeCaloriePending>().not.toExtend<RecipeCalorieState>();
    });
});

describe('toCalorieChipModel', () => {
    it('renders the figure through the localized template, locale-grouped', () => {
        const model = toCalorieChipModel(reading({ caloriesPerServing: 1020 }), 'en', en);

        expect(model.text).toBe('1,020 cal');
        expect(model.label).toBe('1,020 cal');
        expect(model.isStale).toBe(false);
        expect(model.isApproximate).toBe(false);
    });

    // KTD-3b, made structural by the wire union: an outage lands in `unaccounted` and never reaches `known`,
    // so a zero HERE is a measured zero and must be rendered as the number it is.
    it('renders a known reading of ZERO as "0 cal" — never as an absence', () => {
        const model = toCalorieChipModel(reading({ caloriesPerServing: 0 }), 'en', en);

        expect(model.text).toBe('0 cal');
        expect(model.label).toBe('0 cal');
    });

    it('rounds to a whole calorie count (the card never shows fractional energy)', () => {
        expect(toCalorieChipModel(reading({ caloriesPerServing: 420.6 }), 'en', en).text).toBe('421 cal');
    });

    it('marks an INCOMPLETE reading approximate in both the visible text and the accessible name', () => {
        const model = toCalorieChipModel(reading({ isComplete: false }), 'en', en);

        expect(model.text).toBe('~420 cal');
        expect(model.label).toBe('About 420 cal, some items aren’t counted yet');
        expect(model.isApproximate).toBe(true);
        expect(model.isStale).toBe(false);
    });

    // The reader is being told the number may have moved — so the caveat is in the NAME, not only the styling.
    it('marks a STALE reading in the accessible name while leaving the figure itself unchanged', () => {
        const model = toCalorieChipModel(reading({ freshness: 'stale' }), 'en', en);

        expect(model.text).toBe('420 cal');
        expect(model.label).toBe('420 cal, may be out of date');
        expect(model.label).not.toBe(toCalorieChipModel(reading(), 'en', en).label);
        expect(model.isStale).toBe(true);
    });

    it('carries BOTH caveats in one template when a reading is stale AND incomplete', () => {
        const model = toCalorieChipModel(reading({ freshness: 'stale', isComplete: false }), 'en', en);

        expect(model.text).toBe('~420 cal');
        expect(model.label).toBe('About 420 cal, some items aren’t counted yet and may be out of date');
        expect(model.isStale).toBe(true);
        expect(model.isApproximate).toBe(true);
    });

    it('produces four DISTINCT accessible names across the freshness × completeness matrix', () => {
        const labels = [
            toCalorieChipModel(reading(), 'en', en).label,
            toCalorieChipModel(reading({ freshness: 'stale' }), 'en', en).label,
            toCalorieChipModel(reading({ isComplete: false }), 'en', en).label,
            toCalorieChipModel(reading({ freshness: 'stale', isComplete: false }), 'en', en).label,
        ];

        expect(new Set(labels).size).toBe(4);
    });
});

describe('unaccountedReasonText', () => {
    it('gives each wire reason its own copy', () => {
        const texts = [
            unaccountedReasonText('no_resolved_ingredients', en),
            unaccountedReasonText('no_nutrient_data', en),
            unaccountedReasonText('food_unavailable', en),
        ];

        expect(texts).toEqual([
            en.unaccountedNoResolvedIngredients,
            en.unaccountedNoNutrientData,
            en.unaccountedFoodUnavailable,
        ]);
        // Distinct, non-empty: a reason that fell through to a shared or blank string would tell the reader
        // nothing about why there is no figure.
        expect(new Set(texts).size).toBe(3);
        expect(texts.every((text) => text.length > 0)).toBe(true);
    });
});

describe('R38 — a range-derived calorie figure on a CARD', () => {
    /** A settled, complete, fresh reading — the case that used to render with no caveat at all. */
    const reading = { state: 'known', caloriesPerServing: 420, isComplete: true, freshness: 'fresh' } as const;

    it('⛔ marks the figure approximate when it came from a collapsed range', () => {
        // `computeRecipeNutrition` collapses `2–3 cups` to ONE bound, so the number can sit up to a third
        // under what the recipe says. The detail view has always disclosed that; the batch feeding every
        // recipe, discovery and collection card silently did not — two opposite honesty postures on one
        // page, which is exactly what R38 exists to stop.
        const model = toCalorieChipModel({ ...reading, rangeDerivedBound: 'low' }, 'en', recipeNutritionMessages.en);

        expect(model.isApproximate).toBe(true);
        expect(model.text).toBe('~420 cal');
    });

    it('⛔ NAMES the bound in the accessible name, which a bare "~" does not', () => {
        const low = toCalorieChipModel({ ...reading, rangeDerivedBound: 'low' }, 'en', recipeNutritionMessages.en);
        const high = toCalorieChipModel({ ...reading, rangeDerivedBound: 'high' }, 'en', recipeNutritionMessages.en);

        expect(low.label).toContain('lower amount');
        expect(high.label).toContain('upper amount');
        // A reader must be able to tell "some items aren't counted" from "we took the low end of a range".
        expect(low.label).not.toBe(high.label);
        expect(low.label).not.toContain('aren’t counted yet');
    });

    it('leaves a figure that came from no range exactly as it was', () => {
        const model = toCalorieChipModel(reading, 'en', recipeNutritionMessages.en);

        expect(model.isApproximate).toBe(false);
        expect(model.text).toBe('420 cal');
    });
});
