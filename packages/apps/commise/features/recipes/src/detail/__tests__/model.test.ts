/**
 * Unit tests for the recipe-detail model layer — the pure helpers the web and native detail views share.
 *
 * REWRITTEN for U8: `formatQuantity` takes the `exact | range | absent` value object instead of a number,
 * so every case now names the member it is formatting. The properties the previous suite proved are all
 * retained (Intl grouping, fractional precision, an empty-string unit meaning no unit); what is added is
 * the two members a scalar could not express.
 */
import { describe, expect, it } from 'vitest';

import { ABSENT_QUANTITY, statedQuantity, type IngredientQuantity } from '@kitchensink/recipe-core';

import { makeNutrition } from '../../__fixtures__/index.js';
import { MAX_SCALED_SERVINGS, MIN_SCALED_SERVINGS } from '@kitchensink/recipe-core/scaling';

import { formatQuantity, rangeDerivedNotice, servingsAnnouncement, staleNutritionNotice } from '../model.js';

/** A quantity the source stated exactly. */
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

describe('formatQuantity — an exact quantity', () => {
    it('joins a quantity and unit', () => {
        expect(formatQuantity(exact(2), 'en-US', 'tbsp')).toBe('2 tbsp');
    });

    it('preserves fractional quantities', () => {
        expect(formatQuantity(exact(1.5), 'en-US', 'lbs')).toBe('1.5 lbs');
    });

    it('omits the unit when absent', () => {
        expect(formatQuantity(exact(3), 'en-US', undefined)).toBe('3');
    });

    it('treats an empty-string unit as no unit', () => {
        expect(formatQuantity(exact(3), 'en-US', '')).toBe('3');
    });

    it('locale-groups a large quantity via Intl (never string concatenation)', () => {
        expect(formatQuantity(exact(1000), 'en-US')).toBe('1,000');
    });

    it('formats a fractional quantity with a unit correctly for en-US', () => {
        expect(formatQuantity(exact(2.5), 'en-US', 'cups')).toBe('2.5 cups');
    });
});

describe('formatQuantity — a stated range (R36/R42)', () => {
    it('renders BOTH bounds with ONE unit', () => {
        expect(formatQuantity(range(2, 3), 'en-US', 'cups')).toBe('2–3 cups');
    });

    it('renders a range with no unit', () => {
        expect(formatQuantity(range(1, 2), 'en-US')).toBe('1–2');
    });

    // Each bound goes through Intl separately, so a grouped thousand stays grouped at both ends. A
    // concatenated `${low}-${high}` would print `1000-2000` and lose the locale's separator.
    it('locale-formats each bound rather than concatenating the pair', () => {
        expect(formatQuantity(range(1000, 2000), 'en-US', 'g')).toBe('1,000–2,000 g');
    });

    it('preserves fractional bounds', () => {
        expect(formatQuantity(range(0.5, 0.75), 'en-US', 'tsp')).toBe('0.5–0.75 tsp');
    });
});

describe('formatQuantity — an absent quantity (R40)', () => {
    // ⛔ NOT "0", and not "1". The source stated no amount; the line still has to render, and what it
    // renders is its unit and name — "butter the size of an egg" carries its meaning in the notes.
    it('renders NOTHING for the quantity, never a fabricated number', () => {
        expect(formatQuantity(ABSENT_QUANTITY, 'en-US')).toBe('');
        expect(formatQuantity(ABSENT_QUANTITY, 'en-US', '')).toBe('');
    });

    it('renders the unit alone when the line states one, with no stray separator', () => {
        expect(formatQuantity(ABSENT_QUANTITY, 'en-US', 'pinch')).toBe('pinch');
    });
});

/**
 * U9 / R38 — the disclosure that a total was computed from ONE bound of a stated range.
 *
 * `computeRecipeNutrition` already records which bound it collapsed to; nothing rendered it, so a figure up
 * to a third under the recipe's upper bound was indistinguishable from an exact one. This selector is the
 * single place that fact becomes copy, on both platforms and on both the detail and the editor surface.
 */
describe('rangeDerivedNotice (R38)', () => {
    const notices = { low: 'from the lower amount', high: 'from the upper amount' };

    it('returns nothing when no range was collapsed — absence IS the "not applicable"', () => {
        expect(rangeDerivedNotice(makeNutrition(), notices)).toBeUndefined();
    });

    it('names the LOWER bound when the figure came from it', () => {
        expect(rangeDerivedNotice(makeNutrition({ rangeDerivedBound: 'low' }), notices)).toBe('from the lower amount');
    });

    it('names the UPPER bound when the figure came from it', () => {
        // Today's policy only ever collapses to `low`; the client renders the bound it is TOLD, so a policy
        // change is a one-line server edit rather than a client release.
        expect(rangeDerivedNotice(makeNutrition({ rangeDerivedBound: 'high' }), notices)).toBe('from the upper amount');
    });
});

describe('staleNutritionNotice (KTD-3b — serve stale, MARKED)', () => {
    const notice = 'may be out of date';

    it('returns the notice when the figure was served from cache', () => {
        expect(staleNutritionNotice(makeNutrition({ freshness: 'stale' }), notice)).toBe(notice);
    });

    it('returns nothing for a figure fetched for this read — a fresh reading carries no reassuring sentence', () => {
        expect(staleNutritionNotice(makeNutrition({ freshness: 'fresh' }), notice)).toBeUndefined();
    });
});

/**
 * What the serving stepper SAYS after + or − (staff-ux-engineer ruling): the count, pluralised for the locale, and
 * — at an end of the range — that it IS the end, so an unavailable + explains itself.
 */
describe('servingsAnnouncement', () => {
    const copy = {
        servingsValueOne: '{count} serving',
        servingsValueOther: '{count} servings',
        servingsValueAtMinimum: '{value}, minimum',
        servingsValueAtMaximum: '{value}, maximum',
    };

    it('names the count, pluralised', () => {
        expect(servingsAnnouncement(4, 4, copy, 'en')).toBe('4 servings');
        expect(servingsAnnouncement(2, 4, copy, 'en')).toBe('2 servings');
    });

    it('says when the count is the fewest the range allows', () => {
        expect(MIN_SCALED_SERVINGS).toBe(1);
        expect(servingsAnnouncement(MIN_SCALED_SERVINGS, 4, copy, 'en')).toBe('1 serving, minimum');
    });

    it('says when the count is the most the range allows', () => {
        expect(servingsAnnouncement(MAX_SCALED_SERVINGS, 4, copy, 'en')).toBe(
            `${MAX_SCALED_SERVINGS} servings, maximum`,
        );
    });

    it('treats a recipe authored above the display cap as at its maximum on its own yield', () => {
        const huge = MAX_SCALED_SERVINGS + 150;

        expect(servingsAnnouncement(huge, huge, copy, 'en')).toBe(`${huge} servings, maximum`);
        expect(servingsAnnouncement(huge - 1, huge, copy, 'en')).toBe(`${huge - 1} servings`);
    });
});
