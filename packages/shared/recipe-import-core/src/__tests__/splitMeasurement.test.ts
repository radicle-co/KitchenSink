/**
 * Splitting a measurement phrase into the parts that SUM, and the parts that only restate.
 *
 * ## Why this exists
 *
 * `normalizeQuantity` reads the LEADING quantity phrase and nothing else, so a line stating more than one
 * measurement loses the rest — measured 2026-08-23, `parseIngredientLine` put "and 1 tablespoon" and
 * "(about 4 cups)" into the FOOD NAME, with `reviewReasons` empty. A food name carrying a measurement
 * matches no catalog row, and an empty review reason means nobody is asked to fix it.
 *
 * ## ⛔ THE DISTINCTION THAT MUST NOT INVERT
 *
 * Three shapes look alike and mean different things:
 *
 *  - **additive** — "2 cups and 1 tablespoon" is 2 cups PLUS a tablespoon.
 *  - **equivalent** — "1 pound (about 4 cups)" is ONE amount said twice. Summing it DOUBLES the ingredient.
 *  - **container and net** — "1 (14.5 ounce) can" is one container holding that much.
 *
 * Getting equivalent backwards is the dangerous direction: it silently doubles a quantity, and nothing
 * downstream can tell. So the rule is deliberately narrow — a conjunction joins, a parenthetical never does.
 *
 * MUTATION LENS: every case asserts BOTH `summed` and `restated`. A splitter that returned its input as a
 * single summed part would pass none of the multi-part cases; one that summed the parentheticals would fail
 * every `restated` assertion.
 */
import { describe, it, expect } from 'vitest';

import { splitMeasurement } from '../splitMeasurement.js';

describe('splitMeasurement — one measurement', () => {
    it('returns a lone measurement as the only summed part', () => {
        expect(splitMeasurement('1/3 cup')).toEqual({ summed: ['1/3 cup'], restated: [] });
    });

    it('keeps a range together rather than reading it as two parts', () => {
        // ⛔ "1 to 2 teaspoons" is ONE measurement with two bounds. Splitting it here would turn a range
        // into a sum and treble the ingredient.
        expect(splitMeasurement('1 to 2 teaspoons')).toEqual({ summed: ['1 to 2 teaspoons'], restated: [] });
    });

    it('returns a subjective measurement untouched, for the caller to keep as prose', () => {
        expect(splitMeasurement('to taste')).toEqual({ summed: ['to taste'], restated: [] });
    });

    it('is total on an empty phrase', () => {
        expect(splitMeasurement('')).toEqual({ summed: [], restated: [] });
        expect(splitMeasurement('   ')).toEqual({ summed: [], restated: [] });
    });
});

describe('splitMeasurement — parts that add up', () => {
    it('splits a conjunction into parts that sum', () => {
        expect(splitMeasurement('2 cups and 1 tablespoon')).toEqual({
            summed: ['2 cups', '1 tablespoon'],
            restated: [],
        });
    });

    it('splits on "plus" as well as "and"', () => {
        expect(splitMeasurement('2 cups, plus 2 tablespoons')).toEqual({
            summed: ['2 cups', '2 tablespoons'],
            restated: [],
        });
    });

    it('splits on an ampersand and a plus sign, which cooks write as often as the words', () => {
        expect(splitMeasurement('2 cups & 1 tablespoon')).toEqual({ summed: ['2 cups', '1 tablespoon'], restated: [] });
        expect(splitMeasurement('2 cups + 1 tablespoon')).toEqual({ summed: ['2 cups', '1 tablespoon'], restated: [] });
    });

    it('splits three parts', () => {
        expect(splitMeasurement('1 quart and 1 cup and 2 tablespoons')).toEqual({
            summed: ['1 quart', '1 cup', '2 tablespoons'],
            restated: [],
        });
    });

    /**
     * ⛔ "and" inside a UNIT is not a conjunction between measurements. A splitter keying on the bare word
     * would cut this in half and report a fifth of a pound as two ingredients.
     */
    it('does not split a conjunction that is part of the amount itself', () => {
        expect(splitMeasurement('one and a half cups')).toEqual({
            summed: ['one and a half cups'],
            restated: [],
        });
    });
});

describe('splitMeasurement — parts that only restate', () => {
    it('never sums a parenthetical, because it says the same amount again', () => {
        expect(splitMeasurement('1 pound (about 4 cups)')).toEqual({
            summed: ['1 pound'],
            restated: ['about 4 cups'],
        });
    });

    it('keeps a container’s net weight rather than discarding it', () => {
        // The cook measures cans; the nutrition is in the ounces. Neither is summed, and the net is kept so
        // a later reader can choose which one it wants.
        expect(splitMeasurement('1 (14.5 ounce) can')).toEqual({
            summed: ['1 can'],
            restated: ['14.5 ounce'],
        });
    });

    it('restates and adds in the same phrase without confusing the two', () => {
        expect(splitMeasurement('1 pound (about 4 cups) and 2 tablespoons')).toEqual({
            summed: ['1 pound', '2 tablespoons'],
            restated: ['about 4 cups'],
        });
    });

    it('is total on an unclosed parenthesis rather than throwing', () => {
        expect(splitMeasurement('1 pound (about 4 cups')).toEqual({
            summed: ['1 pound'],
            restated: ['about 4 cups'],
        });
    });
    /**
     * ⛔ ReDoS REGRESSION GUARD (CodeQL `js/polynomial-redos`, PR 91, 2026-08-25).
     *
     * Both regexes here shipped with two ADJACENT unanchored whitespace quantifiers: `PARENTHETICAL`
     * wrapped its capture group in one on each side, and `JOINS` carried the prefix `\s*,?\s*`. Two
     * quantifiers that can each consume the SAME whitespace make the number of ways to split a run of
     * spaces grow with its length, and every one of them is retried at every start position.
     *
     * MEASURED before the fix: `PARENTHETICAL` went 1.2ms → 66.6ms across 2k → 16k spaces (doubling the
     * input roughly QUADRUPLED the time), and `JOINS` did not finish 4k spaces in 120 SECONDS. CodeQL
     * flagged only the first; the second was found by measuring the sibling rather than trusting the alert
     * to be exhaustive.
     *
     * ⚠️ This input is not hypothetical. `splitMeasurement` reads a measurement lifted from imported
     * recipe prose — a public-domain book today, and whatever 004/017's capture waterfall fetches later.
     * Nothing between the source text and this function bounds a run of whitespace.
     */
    it('does not backtrack catastrophically on a long whitespace run (ReDoS guard)', () => {
        const pathological = `${' '.repeat(20_000)}x`;
        const started = performance.now();

        expect(splitMeasurement(pathological)).toEqual({ summed: ['x'], restated: [] });
        expect(performance.now() - started).toBeLessThan(100);
    });
});
