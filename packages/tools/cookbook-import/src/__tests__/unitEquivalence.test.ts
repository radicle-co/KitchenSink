/**
 * Unit tests for historical-unit equivalence — R32, R33, R34, R35.
 *
 * ⛔ THE HEADLINE CASE IS THE FIRST TEST IN THIS FILE, and it is the reason the whole module exists: a
 * gill from an American book is 118 mL and a gill from *The Jewish Manual* is 142 mL. A single global
 * convention gets one of those wrong by 20% across a whole corpus, silently, and which corpus depends
 * only on which convention was picked.
 */
import { describe, it, expect } from 'vitest';
import { statedQuantity, type IngredientQuantity } from '@kitchensink/recipe-core';

import { COOKBOOKS } from '../cookbooks.js';
import {
    convertHistoricalUnit,
    resolveUnitEquivalence,
    unitEquivalenceFor,
    type BookMeasures,
} from '../unitEquivalence.js';

/** The registered American book that PRINTS its own table of weights and measures (#12350). */
const AMERICAN = COOKBOOKS['international-jewish'].measures;

/** Montefiore's *The Jewish Manual* (London, 1846) — British, and its own table has never been read. */
const BRITISH = COOKBOOKS['jewish-manual'].measures;

/** An exact quantity, spelled the way `statedQuantity` spells it, so a test never hand-builds the union. */
function exactly(value: number): IngredientQuantity {
    const quantity = statedQuantity(value);

    if (quantity === null) {
        throw new Error(`test fixture: ${value} is not a statable quantity`);
    }

    return quantity;
}

describe('resolveUnitEquivalence — the same word, two amounts (R32, R33)', () => {
    it('reads a gill at 118 mL from an American book and 142 mL from The Jewish Manual', () => {
        const american = resolveUnitEquivalence(AMERICAN, 'gill');
        const british = resolveUnitEquivalence(BRITISH, 'gill');

        expect(american?.millilitres).toBeCloseTo(118.29, 1);
        expect(british?.millilitres).toBeCloseTo(142.07, 1);
    });

    /** R34 — an equivalence that leaves EITHER of these implicit does not satisfy the requirement. */
    it('records the measure system AND the citation on both readings (R34)', () => {
        const american = resolveUnitEquivalence(AMERICAN, 'gill');
        const british = resolveUnitEquivalence(BRITISH, 'gill');

        expect(american?.measureSystem).toBe('us-customary');
        expect(british?.measureSystem).toBe('british-imperial');
        expect(american?.citation).toContain('UCUM');
        // Both books now cite the SAME authority — the gill is standardised, so its size does not
        // depend on which book asked. What differs is the system, asserted above.
        expect(british?.citation).toContain('UCUM');
        // ⚠️ NOT a minimum length any more. The citation renders into the recipe a cook reads, so it is
        // deliberately short; `standardUnitSource.test.ts` caps it at 80 characters. What R34 requires
        // is that it NAMES an authority, not that it is long.
        expect(american?.citation).toContain('UCUM');
        expect(british?.citation).toContain('UCUM');
    });

    /**
     * ⚠️ The value happens to AGREE with the external standard here — #12350's `2 gills = 1 cup` and the
     * standard's `4 gills = 1 pint` are the same statement in US customary. The citation is what differs,
     * and R34 is about the citation: "we read it in this book" and "we assumed the standard" are different
     * claims even when they produce the same number.
     */
    it('normalizes the spelling the source used before resolving it', () => {
        expect(resolveUnitEquivalence(AMERICAN, 'wineglassful')?.millilitres).toBeCloseTo(59.15, 1);
        expect(resolveUnitEquivalence(AMERICAN, 'Gills')?.millilitres).toBeCloseTo(118.29, 1);
    });

    /**
     * ⛔ The chain does NOT fall through when the book's own line is unreadable. Answering with the
     * external standard for a unit the book plainly defined would report `source: 'convention'`
     * against a book that printed a table — a false citation, which is the one thing R34 exists to
     * prevent — and it would hide a broken transcription behind a perfectly plausible number.
     */
    it('resolves nothing for a unit that is not historical at all', () => {
        expect(resolveUnitEquivalence(AMERICAN, 'cup')).toBeNull();
        expect(resolveUnitEquivalence(AMERICAN, 'g')).toBeNull();
        expect(resolveUnitEquivalence(AMERICAN, 'carrot')).toBeNull();
    });
});

/**
 * ⛔ R33's hard edge. "We have not established this book's origin" must never resolve as though it were
 * US customary — the unknown-origin case has no measure system, so it has no equivalence.
 */
describe('resolveUnitEquivalence — an unestablished origin (R33)', () => {
    const UNKNOWN: BookMeasures = {
        origin: { kind: 'unestablished', why: 'A test fixture standing in for a book nobody has placed.' },
    };

    it('refuses to size a historical unit rather than defaulting to a system', () => {
        expect(resolveUnitEquivalence(UNKNOWN, 'gill')).toBeNull();
        expect(resolveUnitEquivalence(UNKNOWN, 'wineglass')).toBeNull();
    });
});

describe('unitEquivalenceFor', () => {
    it('binds one book to the port, so a caller cannot mix two books’ factors', () => {
        const resolveAmerican = unitEquivalenceFor(AMERICAN);
        const resolveBritish = unitEquivalenceFor(BRITISH);

        expect(resolveAmerican('gill')?.millilitres).toBeCloseTo(118.29, 1);
        expect(resolveBritish('gill')?.millilitres).toBeCloseTo(142.07, 1);
    });
});

/**
 * R35 — the historical-unit MARKER. A converted amount is no longer the amount the source printed, so the
 * value that leaves this module says so, and says where its factor came from.
 */
describe('convertHistoricalUnit (R35)', () => {
    it('restates a gill in a unit the food catalog’s household portions actually carry', () => {
        const converted = convertHistoricalUnit(unitEquivalenceFor(AMERICAN), exactly(1), 'gill');

        expect(converted?.restated).toEqual({ quantity: exactly(0.5), unit: 'cup' });
        expect(converted?.stated).toEqual({ quantity: exactly(1), unit: 'gill' });
    });

    it('carries the citation and the measure system onto the converted value (R34, R35)', () => {
        const converted = convertHistoricalUnit(unitEquivalenceFor(BRITISH), exactly(1), 'gill');

        expect(converted?.equivalence.measureSystem).toBe('british-imperial');
        // A gill is standardised (UCUM `[gil_br]`), not a household convention.
        expect(converted?.equivalence.source).toBe('standard');
        expect(converted?.equivalence.citation).toContain('UCUM');
        // An imperial gill is 142.07 mL, and a US customary cup is 236.59 mL: 0.6 of one.
        expect(converted?.restated).toEqual({ quantity: exactly(0.6), unit: 'cup' });
    });

    /**
     * ⚠️ The target unit is chosen so the restatement LOSES NOTHING to the column's 3 decimal places, and
     * is the largest such unit. A saltspoon expressed in cups is 0.005208… — stored as 0.005, a 4% error,
     * and a number no cook recognises; expressed in teaspoons it is exactly 0.25, which is also the
     * framing #12350's own table uses ("4 saltspoons = 1 teaspoon"). The agreement is the point: the rule
     * reproduces each authority's own words rather than picking a unit arbitrarily.
     */
    it.each([
        ['gill', 0.5, 'cup'],
        ['wineglass', 0.25, 'cup'],
        ['dessertspoon', 2, 'teaspoon'],
        ['saltspoon', 0.25, 'teaspoon'],
    ])('restates one %s as %d %s', (unit, value, target) => {
        const converted = convertHistoricalUnit(unitEquivalenceFor(AMERICAN), exactly(1), unit);

        expect(converted?.restated).toEqual({ quantity: exactly(value), unit: target });
    });

    it('scales the amount rather than only the unit', () => {
        const converted = convertHistoricalUnit(unitEquivalenceFor(AMERICAN), exactly(3), 'gill');

        expect(converted?.restated.quantity).toEqual(exactly(1.5));
    });

    it('converts BOTH bounds of a stated range, keeping it a range (R36)', () => {
        const range = statedQuantity(2, 4);
        const converted = convertHistoricalUnit(unitEquivalenceFor(AMERICAN), range as IngredientQuantity, 'gill');

        expect(converted?.restated.quantity).toEqual(statedQuantity(1, 2));
    });

    it('converts nothing when the source stated no amount (R40)', () => {
        const converted = convertHistoricalUnit(unitEquivalenceFor(AMERICAN), { kind: 'absent' }, 'gill');

        expect(converted).toBeNull();
    });

    it('converts nothing for a modern unit, so a line the catalog already understands is left alone', () => {
        expect(convertHistoricalUnit(unitEquivalenceFor(AMERICAN), exactly(2), 'cup')).toBeNull();
        expect(convertHistoricalUnit(unitEquivalenceFor(AMERICAN), exactly(2), 'tablespoon')).toBeNull();
    });

    it('converts nothing when the book has no measure system to read the unit in (R33)', () => {
        const resolve = unitEquivalenceFor({
            origin: { kind: 'unestablished', why: 'A test fixture standing in for a book nobody has placed.' },
        });

        expect(convertHistoricalUnit(resolve, exactly(1), 'gill')).toBeNull();
    });
});

/**
 * R33's second sentence — a book with a known origin follows its origin's measure system, and one whose
 * origin is unestablished follows nothing. Its FIRST sentence, about transcribing each book's own printed
 * table, no longer applies: that table is gone (see `standardUnits.ts`).
 */
describe('the corpus registry records what is known about each book (R33)', () => {
    /**
     * ⚠️ The table assertions that stood here are GONE with the field. They proved that #12350's own
     * printed ratios were transcribed and that Montefiore's were not — real coverage of a real mechanism,
     * which was removed once measurement showed the transcribed ratios were bit-identical to the standard
     * (`diff 0.000000000` on all three). What they protected was a per-book table producing a per-book
     * number; there is no per-book number any more.
     *
     * Where the coverage went: `standardUnitSource.test.ts` now pins which units come from a published
     * standard and which are our own conventions, and the two cases below keep the fact that DID matter —
     * that each book is placed in a measure system, and that an unplaced one is not silently defaulted.
     */
    it('places each registered book in a measure system, or says it cannot', () => {
        for (const book of Object.values(COOKBOOKS)) {
            expect(['established', 'unestablished']).toContain(book.measures.origin.kind);
        }
    });

    it('puts Montefiore on the imperial system by ORIGIN', () => {
        expect(BRITISH.origin).toEqual({ kind: 'established', system: 'british-imperial', basis: expect.any(String) });
    });
});
