/**
 * Unit tests for the ONE mapping between `IngredientQuantity` and its two `numeric` columns (U8).
 *
 * The property under test is that the pair is a genuine ISOMORPHISM over the three members, in both
 * directions. Six call sites in `recipes.service.ts` read a `recipe_ingredients` row and one DAL writes it;
 * before U8 each of them spelled `Number(row.quantity)` for itself, which is exactly how a `null` column
 * became `NaN` in five places at once. These tests are the reason there is now one spelling.
 *
 * ⚠️ `numeric` arrives from `pg` as a STRING, and at a scale the column chose (`2` comes back as `'2.000'`).
 * Half of the cases below exist because that string is the actual shape at the boundary — a test that fed
 * numbers in would prove nothing about the code that runs.
 */
import { describe, expect, it } from 'vitest';

import { ABSENT_QUANTITY, statedQuantity, type IngredientQuantity, type StatedAmount } from '@kitchensink/recipe-core';

import {
    quantityColumns,
    quantityFromColumns,
    statedMeasureColumns,
    statedMeasureFromColumns,
} from '../quantityColumns.js';

/** The same fixture, narrowed to the union a stated measure admits. `absent` is not in it. */
function statedAmount(value: number): StatedAmount {
    const quantity = exact(value);

    if (quantity.kind === 'absent') {
        throw new Error('test fixture: an exact quantity is never absent');
    }

    return quantity;
}

/** A stated range, narrowed the same way. */
function statedRange(low: number, high: number): StatedAmount {
    const quantity = range(low, high);

    if (quantity.kind === 'absent') {
        throw new Error('test fixture: a range is never absent');
    }

    return quantity;
}

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

describe('quantityColumns — domain to columns', () => {
    it('writes an exact quantity to the low column, leaving the high column NULL', () => {
        expect(quantityColumns(exact(2.5))).toEqual({ quantity: '2.5', quantityHigh: null });
    });

    it('writes both bounds of a range', () => {
        expect(quantityColumns(range(2, 3))).toEqual({ quantity: '2', quantityHigh: '3' });
    });

    // ⛔ R40. NULL, never `'0'` — the coherence and positive checks would both accept a `0` in the low
    // column, so nothing in the database would catch this if the mapper got it wrong.
    it('writes an absent quantity as NULL in BOTH columns, never as a zero', () => {
        expect(quantityColumns(ABSENT_QUANTITY)).toEqual({ quantity: null, quantityHigh: null });
    });
});

describe('quantityFromColumns — columns to domain', () => {
    it('reads a low column alone as an exact quantity', () => {
        expect(quantityFromColumns({ quantity: '2.000', quantityHigh: null })).toEqual(exact(2));
    });

    it('reads both columns as a range', () => {
        expect(quantityFromColumns({ quantity: '2.000', quantityHigh: '3.500' })).toEqual(range(2, 3.5));
    });

    it('reads two NULLs as absent, not as zero', () => {
        expect(quantityFromColumns({ quantity: null, quantityHigh: null })).toEqual(ABSENT_QUANTITY);
    });

    /**
     * ⚠️ THE FAIL-SAFE, and the reason this returns a quantity rather than throwing.
     *
     * `recipe_ingredients_quantity_coherent` is `NOT VALID`, so it polices writes but was never verified
     * against the rows already in the table. A row that somehow holds an upper bound with no lower — a
     * hand-run `UPDATE`, a restore from an older dump — must still RENDER. Reporting it as `absent` says
     * the honest thing (no amount can be read from this row) instead of throwing a 500 on a GET, or worse,
     * silently promoting a stray upper bound to the stated amount.
     */
    it('reports an incoherent row as absent rather than inventing an amount from the stray bound', () => {
        expect(quantityFromColumns({ quantity: null, quantityHigh: '3.000' })).toEqual(ABSENT_QUANTITY);
        expect(quantityFromColumns({ quantity: '3.000', quantityHigh: '2.000' })).toEqual(ABSENT_QUANTITY);
        expect(quantityFromColumns({ quantity: 'not a number', quantityHigh: null })).toEqual(ABSENT_QUANTITY);
    });

    // Coincident bounds collapse to `exact` — the value object's own rule, reached through the mapper so a
    // legacy row written as `2.000 / 2.000` cannot produce a second representation of one amount.
    it('collapses coincident bounds to an exact quantity', () => {
        expect(quantityFromColumns({ quantity: '2.000', quantityHigh: '2.000' })).toEqual(exact(2));
    });
});

describe('the two directions compose', () => {
    it('round-trips every member through the columns and back', () => {
        for (const quantity of [exact(2), exact(0.125), range(2, 3.5), ABSENT_QUANTITY]) {
            expect(quantityFromColumns(quantityColumns(quantity))).toEqual(quantity);
        }
    });
});

/**
 * U7/U11 — the SAME isomorphism, one level over, for the pair the source PRINTED.
 *
 * The stated measure exists because the importer restates a historical unit at parse time: `one gill of
 * milk` persists as `0.5 cup`, and until migration 0027 the gill survived only as prose. U11's gate builds
 * its question from the persisted columns, so it was shown `0.5 cup` beside a source reading `one gill of
 * milk` and correctly disagreed with a line we parsed RIGHT.
 *
 * ⚠️ Two properties here are NOT shared with the quantity mapper, and each is asserted as a refusal:
 *
 *  1. **Absence is `undefined`, not a member.** A line with no restatement is the DOMINANT case, and there
 *     is no `ABSENT_MEASURE` to collapse it onto — a stated measure of nothing is not a thing.
 *  2. **A half-written row reads as ABSENT.** `recipe_ingredients_stated_measure_coherent` is `NOT VALID`,
 *     so it polices writes from 0027 onward but never verified the rows already there, and nothing stops a
 *     hand-run `UPDATE` or a restore from an older dump. A row holding a unit with no amount must still
 *     RENDER; reporting it as "no stated measure" says the honest thing rather than throwing a 500 on a GET
 *     or feeding the gate half a claim.
 */
describe('statedMeasureColumns / statedMeasureFromColumns', () => {
    it('spreads an exact stated measure across its three columns', () => {
        expect(statedMeasureColumns({ quantity: statedAmount(1), unit: 'gill' })).toEqual({
            statedQuantity: '1',
            statedQuantityHigh: null,
            statedUnit: 'gill',
        });
    });

    it('spreads a stated range across its three columns', () => {
        expect(statedMeasureColumns({ quantity: statedRange(1, 2), unit: 'wineglass' })).toEqual({
            statedQuantity: '1',
            statedQuantityHigh: '2',
            statedUnit: 'wineglass',
        });
    });

    // ⛔ ALL THREE columns, never a partial write. A `stated_unit` left over from a previous line would be a
    // restatement claim attached to an amount nobody restated.
    it('writes NULL to all three columns when there is no stated measure', () => {
        expect(statedMeasureColumns(undefined)).toEqual({
            statedQuantity: null,
            statedQuantityHigh: null,
            statedUnit: null,
        });
    });

    it('reads an exact stated measure back at the scale pg surfaces', () => {
        expect(
            statedMeasureFromColumns({ statedQuantity: '1.000', statedQuantityHigh: null, statedUnit: 'gill' }),
        ).toEqual({ quantity: exact(1), unit: 'gill' });
    });

    it('reads a stated range back', () => {
        expect(
            statedMeasureFromColumns({ statedQuantity: '1.000', statedQuantityHigh: '2.000', statedUnit: 'gill' }),
        ).toEqual({ quantity: range(1, 2), unit: 'gill' });
    });

    it('reads an all-null row as no stated measure', () => {
        expect(
            statedMeasureFromColumns({ statedQuantity: null, statedQuantityHigh: null, statedUnit: null }),
        ).toBeUndefined();
    });

    // Property 2 — every way a legacy or hand-edited row can be half a claim.
    it('reads a HALF-written row as no stated measure rather than half a claim', () => {
        expect(
            statedMeasureFromColumns({ statedQuantity: '1.000', statedQuantityHigh: null, statedUnit: null }),
        ).toBeUndefined();
        expect(
            statedMeasureFromColumns({ statedQuantity: null, statedQuantityHigh: null, statedUnit: 'gill' }),
        ).toBeUndefined();
        expect(
            statedMeasureFromColumns({ statedQuantity: null, statedQuantityHigh: '2.000', statedUnit: 'gill' }),
        ).toBeUndefined();
    });

    // ⛔ A blank unit is `recipe_ingredients.unit`'s spelling of "unitless", and a restatement is never FROM
    // nothing. Left admitted it would be a second spelling of "no stated measure".
    it('reads a BLANK stated unit as no stated measure', () => {
        expect(
            statedMeasureFromColumns({ statedQuantity: '1.000', statedQuantityHigh: null, statedUnit: '   ' }),
        ).toBeUndefined();
    });

    // An unreadable or incoherent amount cannot become a measure either — the value object's own smart
    // constructor is the gate, so a stray upper bound is never promoted to the stated amount.
    it('reads an incoherent stated amount as no stated measure', () => {
        expect(
            statedMeasureFromColumns({ statedQuantity: '3.000', statedQuantityHigh: '2.000', statedUnit: 'gill' }),
        ).toBeUndefined();
        expect(
            statedMeasureFromColumns({ statedQuantity: 'not a number', statedQuantityHigh: null, statedUnit: 'gill' }),
        ).toBeUndefined();
    });

    it('round-trips both members through the columns and back', () => {
        for (const measure of [
            { quantity: statedAmount(1), unit: 'gill' },
            { quantity: statedRange(1, 2), unit: 'saltspoon' },
        ]) {
            expect(statedMeasureFromColumns(statedMeasureColumns(measure))).toEqual(measure);
        }

        expect(statedMeasureFromColumns(statedMeasureColumns(undefined))).toBeUndefined();
    });
});
