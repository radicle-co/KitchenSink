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
        expect(american?.citation).toContain('12350');
        expect(british?.citation).toContain('NIST Handbook 44');
        expect(american?.citation.length).toBeGreaterThan(20);
        expect(british?.citation.length).toBeGreaterThan(20);
    });

    /**
     * ⚠️ The value happens to AGREE with the external standard here — #12350's `2 gills = 1 cup` and the
     * standard's `4 gills = 1 pint` are the same statement in US customary. The citation is what differs,
     * and R34 is about the citation: "we read it in this book" and "we assumed the standard" are different
     * claims even when they produce the same number.
     */
    it('attributes the American gill to the BOOK, not to the standard, because the book prints it', () => {
        const american = resolveUnitEquivalence(AMERICAN, 'gill');
        const british = resolveUnitEquivalence(BRITISH, 'gill');

        expect(american?.source).toBe('source-book-table');
        expect(british?.source).toBe('external-standard');
    });

    it('reads the rest of #12350\'s own table: "4 tablespoons = 1 wine-glass", "4 saltspoons = 1 teaspoon"', () => {
        expect(resolveUnitEquivalence(AMERICAN, 'wineglass')?.millilitres).toBeCloseTo(59.15, 1);
        expect(resolveUnitEquivalence(AMERICAN, 'saltspoon')?.millilitres).toBeCloseTo(1.232, 2);
        expect(resolveUnitEquivalence(AMERICAN, 'wineglass')?.source).toBe('source-book-table');
        expect(resolveUnitEquivalence(AMERICAN, 'saltspoon')?.source).toBe('source-book-table');
    });

    /**
     * AE16 — #12350 USES dessertspoons and never defines one. R32's fallthrough covers exactly that gap,
     * and the citation must name the STANDARD rather than the book, because the book did not say it.
     */
    it('falls through to the named external standard for a unit the book leaves undefined (AE16)', () => {
        const dessertspoon = resolveUnitEquivalence(AMERICAN, 'dessertspoon');

        expect(dessertspoon?.source).toBe('external-standard');
        expect(dessertspoon?.measureSystem).toBe('us-customary');
        expect(dessertspoon?.citation).not.toContain('12350');
        // 2 US customary teaspoons.
        expect(dessertspoon?.millilitres).toBeCloseTo(9.86, 1);
    });

    it('normalizes the spelling the source used before resolving it', () => {
        expect(resolveUnitEquivalence(AMERICAN, 'wineglassful')?.millilitres).toBeCloseTo(59.15, 1);
        expect(resolveUnitEquivalence(AMERICAN, 'Gills')?.millilitres).toBeCloseTo(118.29, 1);
    });

    /**
     * ⛔ The chain does NOT fall through when the book's own line is unreadable. Answering with the
     * external standard for a unit the book plainly defined would report `source: 'external-standard'`
     * against a book that printed a table — a false citation, which is the one thing R34 exists to
     * prevent — and it would hide a broken transcription behind a perfectly plausible number.
     */
    it('refuses rather than substituting the standard when a book’s own line cannot be read', () => {
        const badTranscription: BookMeasures = {
            origin: { kind: 'established', system: 'us-customary', basis: 'A test fixture with a known origin.' },
            table: {
                kind: 'transcribed',
                citation: 'A test fixture table with one unreadable line.',
                // `firkin` is not a unit any measurement standard here sizes, so this line has no value.
                entries: [{ unit: 'gill', count: 0.25, per: 'firkin', printed: '4 gills = 1 firkin' }],
            },
        };

        expect(resolveUnitEquivalence(badTranscription, 'gill')).toBeNull();
        // …and the units that line says nothing about still resolve, so the refusal is scoped to the defect.
        expect(resolveUnitEquivalence(badTranscription, 'dessertspoon')?.source).toBe('external-standard');
    });

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
        table: { kind: 'not-transcribed', why: 'A test fixture; no table has been read.' },
    };

    it('refuses to size a historical unit rather than defaulting to a system', () => {
        expect(resolveUnitEquivalence(UNKNOWN, 'gill')).toBeNull();
        expect(resolveUnitEquivalence(UNKNOWN, 'wineglass')).toBeNull();
    });

    /**
     * Even a book that PRINTS a relational table cannot be read without a system: "2 gills = 1 cup" is
     * not a millilitre value until you know whose cup.
     */
    it('refuses even when the book printed its own table, because a relation is not a value', () => {
        const tabledButPlaceless: BookMeasures = {
            origin: { kind: 'unestablished', why: 'A test fixture standing in for a book nobody has placed.' },
            table: {
                kind: 'transcribed',
                citation: 'A test fixture table.',
                entries: [{ unit: 'gill', count: 0.5, per: 'cup', printed: '2 gills = 1 cup' }],
            },
        };

        expect(resolveUnitEquivalence(tabledButPlaceless, 'gill')).toBeNull();
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
        expect(converted?.equivalence.source).toBe('external-standard');
        expect(converted?.equivalence.citation).toContain('NIST Handbook 44');
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
            table: { kind: 'not-transcribed', why: 'A test fixture; no table has been read.' },
        });

        expect(convertHistoricalUnit(resolve, exactly(1), 'gill')).toBeNull();
    });
});

/**
 * R33's first sentence — "each registered book's own table is read and recorded BEFORE that book is
 * imported". Four of the five files are not held locally, so the honest record is that their tables have
 * NOT been transcribed, said out loud in the manifest rather than left as an absent field.
 */
describe('the corpus registry records what is known about each book (R33)', () => {
    it.each(Object.entries(COOKBOOKS))('%s declares an origin and a table state', (_key, book) => {
        expect(book.measures.origin.kind).toMatch(/^(established|unestablished)$/);

        if (book.measures.origin.kind === 'established') {
            expect(book.measures.origin.basis.length).toBeGreaterThan(20);
        } else {
            expect(book.measures.origin.why.length).toBeGreaterThan(20);
        }

        if (book.measures.table.kind === 'transcribed') {
            expect(book.measures.table.entries.length).toBeGreaterThan(0);
            expect(book.measures.table.citation.length).toBeGreaterThan(20);

            for (const entry of book.measures.table.entries) {
                expect(entry.printed.length).toBeGreaterThan(0);
                expect(entry.count).toBeGreaterThan(0);
            }
        } else {
            expect(book.measures.table.why.length).toBeGreaterThan(20);
        }
    });

    it('puts Montefiore on the imperial system by ORIGIN, with no table of her own', () => {
        expect(BRITISH.origin).toEqual({ kind: 'established', system: 'british-imperial', basis: expect.any(String) });
        expect(BRITISH.table.kind).toBe('not-transcribed');
    });

    it('is the ONLY book whose table has been read from the bytes', () => {
        const transcribed = Object.entries(COOKBOOKS).filter(([, book]) => book.measures.table.kind === 'transcribed');

        expect(transcribed.map(([key]) => key)).toEqual(['international-jewish']);
    });
});
