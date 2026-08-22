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

import { formatQuantity } from '../model.js';

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
