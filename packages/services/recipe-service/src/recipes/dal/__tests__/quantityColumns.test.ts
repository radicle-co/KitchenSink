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

import { ABSENT_QUANTITY, statedQuantity, type IngredientQuantity } from '@kitchensink/recipe-core';

import { quantityColumns, quantityFromColumns } from '../quantityColumns.js';

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
