/**
 * ONE READING OF A STATED MEASURE PHRASE (plan U22, phase 3).
 *
 * `statedMeasure` is the source's own WORDS. `quantity` and `unit` are a READING of them, and both engines'
 * readings must come from the same reader or the comparator reports a disagreement that is really two
 * different arithmetics. This is that reader.
 *
 * | Requirement | Test |
 * | ----------- | ---- |
 * | U16 — `null` is the ONE representation of "no measure stated" | "a phrase that states nothing" |
 * | R40 — `absent` is never a fabricated `1` and never a `0` | "a phrase no number can hold" |
 * | KTD-13 — the historical measures are read, not folded into a name | "the measures the CRF is blind to" |
 * | U16 — an unstorable amount is `absent` AND flagged, never narrowed | "amounts the column cannot hold" |
 * | U16 — an absent quantity always says WHY | "every absence is explained" |
 *
 * ⚠️ The unit cases are the ones that matter, and they are the ones a hand-written expectation gets wrong.
 * `parse-ingredient` will not identify a unit with nothing following it — `parseIngredient('2 cups')` returns
 * `unitOfMeasure: null` and `description: 'cups'`, measured 2026-08-25 against 2.2.0 — so a naive reader
 * would report EVERY bare measure phrase as unitless. Each assertion below names the unit it expects.
 */
import { ABSENT_QUANTITY } from '@kitchensink/recipe-core';
import { describe, it, expect, vi } from 'vitest';

import { parseIngredientLine } from '../../ingredientLine.js';
import { readStatedMeasure } from '../readStatedMeasure.js';

/**
 * ⛔ THE COLLABORATOR IS MOCKABLE FOR EXACTLY ONE TEST — the postcondition below — and DELEGATES to the
 * real module everywhere else, so every other assertion in this file still runs the real parser.
 *
 * Why mock at all: "an absent amount always carries a reason" is a guarantee this module makes to its
 * callers, and today `parseIngredientLine` happens to satisfy it unaided — so no input can reach the branch
 * that enforces it, and a mutation that DELETED the enforcement passed the whole suite. Testing a
 * postcondition that a collaborator currently makes redundant requires taking the collaborator away.
 */
vi.mock('../../ingredientLine.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../ingredientLine.js')>();

    return { ...actual, parseIngredientLine: vi.fn(actual.parseIngredientLine) };
});

describe('readStatedMeasure', () => {
    describe('a phrase that states nothing', () => {
        it.each([null, '', '   '])('reads %j as absent, unitless, and says why', (stated) => {
            const reading = readStatedMeasure(stated);

            expect(reading.quantity).toEqual({ kind: 'absent' });
            expect(reading.unit).toBeNull();
            expect(reading.reviewReasons).toEqual(['no_quantity']);
        });
    });

    describe('an amount and a unit', () => {
        it.each([
            ['2 cups', 2, 'cup'],
            ['one tablespoon', 1, 'tablespoon'],
            ['one-half cup', 0.5, 'cup'],
            ['one and one-half cups', 1.5, 'cup'],
            ['2 lbs.', 2, 'lb'],
            ['1½ cups', 1.5, 'cup'],
        ])('reads %s as %d %s', (stated, value, unit) => {
            const reading = readStatedMeasure(stated);

            expect(reading.quantity).toEqual({ kind: 'exact', value });
            expect(reading.unit).toBe(unit);
            expect(reading.reviewReasons).toEqual([]);
        });

        it('reads a two-bound range as a range, keeping BOTH bounds', () => {
            const reading = readStatedMeasure('2 to 3 cups');

            expect(reading.quantity).toEqual({ kind: 'range', low: 2, high: 3 });
            expect(reading.unit).toBe('cup');
        });

        /**
         * ⛔ LOAD-BEARING, not a trivial case. To name a unit at all this reader re-reads the phrase with a
         * placeholder food appended, so if that placeholder were itself a unit word EVERY unitless phrase
         * would come back carrying it — a unit the source never wrote, on every such line. These are the
         * assertions that would fail if the placeholder were ever changed to a word the vocabulary knows.
         */
        it.each(['3', 'one-half', '1 to 2'])('reads %s as an amount with NO unit invented for it', (stated) => {
            expect(readStatedMeasure(stated).unit).toBeNull();
        });

        it('reads a bare amount as the amount itself', () => {
            expect(readStatedMeasure('3').quantity).toEqual({ kind: 'exact', value: 3 });
        });
    });

    /**
     * ⛔ KTD-13's whole reason for the LLM leg's measure rescue: the CRF is trained on modern text and has
     * never heard of a gill. This reader must know them, or the rescue has nothing to rescue WITH — the
     * LLM would state `"one gill"` and this would report no unit, and the comparator's
     * `llmRescuedTheMeasure` would never fire on any line in the corpus.
     */
    describe('the measures the CRF is blind to', () => {
        it.each([
            ['one gill', 'gill'],
            ['one wineglass', 'wineglass'],
            ['one saltspoon', 'saltspoon'],
            ['one dessertspoonful', 'dessertspoon'],
            ['2 tablespoonfuls', 'tablespoon'],
            ['one-half teaspoonful', 'teaspoon'],
        ])('reads %s as the unit %s', (stated, unit) => {
            expect(readStatedMeasure(stated).unit).toBe(unit);
        });
    });

    /**
     * ⛔ R40. `"the size of an egg"` states something real that no number can hold. Reading it as `1` would
     * publish an amount the source never gave, and this is the class `statedMeasure` exists for.
     */
    describe('a phrase no number can hold', () => {
        it.each(['the size of an egg', 'a little', 'a few'])('reads %s as absent rather than one', (stated) => {
            const reading = readStatedMeasure(stated);

            expect(reading.quantity).toEqual({ kind: 'absent' });
            expect(reading.unit).toBeNull();
            expect(reading.reviewReasons).toContain('no_quantity');
        });
    });

    describe('amounts the column cannot hold', () => {
        it('reports an out-of-range amount as absent AND flagged, never narrowed', () => {
            const reading = readStatedMeasure('1000001 cups');

            expect(reading.quantity).toEqual({ kind: 'absent' });
            expect(reading.reviewReasons).toContain('quantity_out_of_storage_range');
        });

        it('reports inverted bounds as absent AND flagged, keeping the unit the phrase stated', () => {
            const reading = readStatedMeasure('3 to 2 cups');

            expect(reading.quantity).toEqual({ kind: 'absent' });
            expect(reading.reviewReasons).toContain('quantity_bounds_inverted');
            expect(reading.unit).toBe('cup');
        });

        /**
         * ⚠️ The paired NEGATIVE. Without it the two assertions above would pass against a reader that
         * flagged everything.
         */
        it('flags nothing on a phrase it read whole', () => {
            expect(readStatedMeasure('2 cups').reviewReasons).toEqual([]);
        });
    });

    /**
     * ⛔ THE INVARIANT: an absent quantity ALWAYS carries a reason. `projectToIngredientLine` deliberately
     * derives no reason of its own — "a `ParsedLine` with an absent quantity was already judged by its
     * producer" — so if this producer stays silent, nobody downstream ever asks about the line.
     */
    describe('every absence is explained', () => {
        it.each([null, '', 'the size of an egg', 'a pinch of', '1000001 cups', '3 to 2 cups', 'teaspoonfuls'])(
            'raises a reason whenever %j reads as absent',
            (stated) => {
                const reading = readStatedMeasure(stated);

                if (reading.quantity.kind === 'absent') {
                    expect(reading.reviewReasons.length).toBeGreaterThan(0);
                }
            },
        );

        /**
         * ⛔ THE GUARANTEE, WITH THE COLLABORATOR TAKEN AWAY. `parseIngredientLine` reports absences the
         * measure filter drops — `empty_input` is about the LINE, not about the measure — and it is free to
         * grow more of them. Whatever it says, an absence must leave THIS module explained, because
         * `projectToIngredientLine` derives no reason of its own and a silent `absent` is a line nobody is
         * ever asked about.
         */
        it('explains an absence its collaborator reported only in line-level terms', () => {
            vi.mocked(parseIngredientLine).mockReturnValueOnce({
                raw: 'For the sauce:',
                quantity: ABSENT_QUANTITY,
                unit: null,
                name: '',
                needsReview: true,
                reviewReasons: ['group_header', 'empty_input'],
            });

            const reading = readStatedMeasure('For the sauce:');

            expect(reading.quantity).toEqual({ kind: 'absent' });
            expect(reading.reviewReasons).toEqual(['no_quantity']);
        });

        /**
         * ⚠️ The PAIR. Without it the guarantee above would pass against a module that appended
         * `no_quantity` to every reading, including the ones that already say why.
         */
        it('does not say no_quantity twice when the reading already explained itself', () => {
            expect(readStatedMeasure('1000001 cups').reviewReasons).not.toContain('no_quantity');
            expect(readStatedMeasure('3 to 2 cups').reviewReasons).not.toContain('no_quantity');
        });
    });

    /**
     * ⛔ THE DRIFT GUARD, and the reason this module holds no unit table of its own. The vocabulary this
     * import understands — `parse-ingredient`'s own units, the `*ful` family (R31) and the historical
     * measures (R32) — is ONE piece of knowledge, and it lives in `ingredientLine.ts`'s `IMPORT_UNITS`.
     * This reader reaches it through `parseIngredientLine` rather than restating it, and the assertion
     * below crosses that seam: a spelling taught to the parser is understood here with no second edit, and
     * a second table added here would show up as a disagreement.
     */
    describe('the unit vocabulary is the import`s, not a second copy', () => {
        it.each(['cup', 'cups', 'teaspoonfuls', 'cupfuls', 'gill', 'wineglass', 'saltspoon', 'dessertspoon', 'lbs.'])(
            'reads the unit of "2 %s" exactly as the whole-line parser does',
            (spelling) => {
                expect(readStatedMeasure(`2 ${spelling}`).unit).toBe(parseIngredientLine(`2 ${spelling} flour`).unit);
            },
        );
    });

    describe('purity', () => {
        it('is total — no input throws, including hostile text', () => {
            for (const stated of ['(((', '2 cups (', '\u0000', ' '.repeat(4000), '½'.repeat(500)]) {
                expect(() => readStatedMeasure(stated)).not.toThrow();
            }
        });

        it('reads the same phrase the same way every time, independent of what came before', () => {
            const first = readStatedMeasure('one gill');
            readStatedMeasure('2 to 3 cups');
            const second = readStatedMeasure('one gill');

            expect(second).toEqual(first);
        });
    });
});
