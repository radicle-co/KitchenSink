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
        // REWRITTEN copy: it is the FIGURE that may be out of date, not the items, so the caveat is not
        // "…aren’t counted yet and may be out of date".
        expect(model.label).toBe('About 420 cal, some items aren’t counted yet, and the figure may be out of date');
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
    it('gives verification_pending its own sentence — not the disagreement, not the outage (plan U4c)', () => {
        const text = unaccountedReasonText('verification_pending', en);

        expect(text).toBe(en.unaccountedVerificationPending);
        expect(text).not.toBe(en.unaccountedVerificationDisagreement);
        expect(text).not.toBe(en.unaccountedFoodUnavailable);
    });

    it('gives each wire reason its own copy', () => {
        // ⚠️ EXTENDED, not rewritten (plan U14): the wire union gained a fourth reason, and the switch this
        // covers is exhaustive with no default — so a missing arm is a compile error, and a missing CASE HERE
        // would be an untested one.
        const texts = [
            unaccountedReasonText('no_resolved_ingredients', en),
            unaccountedReasonText('no_nutrient_data', en),
            unaccountedReasonText('food_unavailable', en),
            unaccountedReasonText('verification_disagreement', en),
        ];

        expect(texts).toEqual([
            en.unaccountedNoResolvedIngredients,
            en.unaccountedNoNutrientData,
            en.unaccountedFoodUnavailable,
            en.unaccountedVerificationDisagreement,
        ]);
        // Distinct, non-empty: a reason that fell through to a shared or blank string would tell the reader
        // nothing about why there is no figure.
        expect(new Set(texts).size).toBe(4);
        expect(texts.every((text) => text.length > 0)).toBe(true);
    });

    it('⛔ does NOT tell a cook to retry a WITHHELD figure — that is `food_unavailable`’s sentence alone', () => {
        // The conflation plan U14 forbids, asserted at the copy level. Nothing is broken when the gate
        // disagrees: the food service answered and the catalog had the number. "Try again shortly" would be
        // advice about an answer that will not change.
        expect(unaccountedReasonText('verification_disagreement', en)).not.toBe(en.unaccountedFoodUnavailable);
        expect(unaccountedReasonText('verification_disagreement', en)).not.toBe(en.unaccountedNoNutrientData);
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

/**
 * ⛔ THE FULL LABEL TABLE — every range × completeness × freshness cell names every caveat that applies.
 *
 * A selection that asks about the range FIRST and stops there drops "may be out of date" from a stale
 * range-derived figure's accessible name (while keeping the italic a sighted reader sees), and "some items
 * aren’t counted yet" from an incomplete one. A test that checks only that the name contains "About" passes
 * against that defect — so each cell asserts its EXACT name, and the twelve names are asserted distinct.
 */
describe('toCalorieChipModel — the accessible-name table (all 12 cells)', () => {
    const LOW = 'counted from the lower amount of each stated range';
    const HIGH = 'counted from the upper amount of each stated range';
    const cells: ReadonlyArray<{
        readonly bound: 'low' | 'high' | undefined;
        readonly isComplete: boolean;
        readonly freshness: 'fresh' | 'stale';
        readonly text: string;
        readonly label: string;
    }> = [
        { bound: undefined, isComplete: true, freshness: 'fresh', text: '420 cal', label: '420 cal' },
        {
            bound: undefined,
            isComplete: true,
            freshness: 'stale',
            text: '420 cal',
            label: '420 cal, may be out of date',
        },
        {
            bound: undefined,
            isComplete: false,
            freshness: 'fresh',
            text: '~420 cal',
            label: 'About 420 cal, some items aren’t counted yet',
        },
        {
            bound: undefined,
            isComplete: false,
            freshness: 'stale',
            text: '~420 cal',
            label: 'About 420 cal, some items aren’t counted yet, and the figure may be out of date',
        },
        { bound: 'low', isComplete: true, freshness: 'fresh', text: '~420 cal', label: `About 420 cal, ${LOW}` },
        {
            bound: 'low',
            isComplete: true,
            freshness: 'stale',
            text: '~420 cal',
            label: `About 420 cal, ${LOW}; the figure may be out of date`,
        },
        {
            bound: 'low',
            isComplete: false,
            freshness: 'fresh',
            text: '~420 cal',
            label: `About 420 cal, ${LOW}; some items aren’t counted yet`,
        },
        {
            bound: 'low',
            isComplete: false,
            freshness: 'stale',
            text: '~420 cal',
            label: `About 420 cal, ${LOW}; some items aren’t counted yet, and the figure may be out of date`,
        },
        { bound: 'high', isComplete: true, freshness: 'fresh', text: '~420 cal', label: `About 420 cal, ${HIGH}` },
        {
            bound: 'high',
            isComplete: true,
            freshness: 'stale',
            text: '~420 cal',
            label: `About 420 cal, ${HIGH}; the figure may be out of date`,
        },
        {
            bound: 'high',
            isComplete: false,
            freshness: 'fresh',
            text: '~420 cal',
            label: `About 420 cal, ${HIGH}; some items aren’t counted yet`,
        },
        {
            bound: 'high',
            isComplete: false,
            freshness: 'stale',
            text: '~420 cal',
            label: `About 420 cal, ${HIGH}; some items aren’t counted yet, and the figure may be out of date`,
        },
    ];

    for (const cell of cells) {
        it(`range=${cell.bound ?? 'none'} complete=${cell.isComplete} ${cell.freshness} → "${cell.label}"`, () => {
            const model = toCalorieChipModel(
                reading({
                    isComplete: cell.isComplete,
                    freshness: cell.freshness,
                    ...(cell.bound === undefined ? {} : { rangeDerivedBound: cell.bound }),
                }),
                'en',
                en,
            );

            expect(model.label).toBe(cell.label);
            expect(model.text).toBe(cell.text);
            expect(model.isStale).toBe(cell.freshness === 'stale');
        });
    }

    it('gives all twelve cells DISTINCT names — no two caveat sets read alike', () => {
        expect(new Set(cells.map((cell) => cell.label)).size).toBe(12);
    });
});
