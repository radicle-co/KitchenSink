/**
 * THE MODEL'S READING, PROMOTED TO THE CANONICAL PARSE (plan U22, phase 3).
 *
 * `parseAnswer.ts` says outright that an `LlmParse` is "deliberately NOT a `ParsedLine`… turning `"2 cups"`
 * into a quantity and a canonical unit is a separate reading that the comparator owns". The comparator does
 * not do it — it consumes two `ParsedLine`s — so this is the module that was missing, and it is where the
 * separate reading actually happens.
 *
 * | Requirement | Test |
 * | ----------- | ---- |
 * | HAZ-041 — `raw` is the input byte-identical, unconditionally | "raw is the SOURCE line" |
 * | U16 — the same measure phrase reads the same way for BOTH engines | "one reader, both engines" |
 * | KTD-11b — the model's placement is NOT re-filed here | "the model`s own words" |
 * | KTD-13 — every fact the model produced is attributed to the LLM | "provenance" |
 */
import type { LlmParse } from '@kitchensink/recipe-core/parsing/parse-answer';
import { describe, it, expect } from 'vitest';

import { compareParses } from '../parseComparator.js';
import { promoteCrfReading } from '../promoteCrfReading.js';
import { promoteLlmParse } from '../promoteLlmParse.js';

/** One model reading — a clean, single-food, fully-read line unless overridden. */
function makeLlmParse(overrides: Partial<LlmParse> = {}): LlmParse {
    return { statedMeasure: '1 tablespoon', foods: [{ name: 'butter', prep: null }], ...overrides };
}

describe('promoteLlmParse', () => {
    describe('raw is the SOURCE line', () => {
        /**
         * ⛔ `LlmParse` carries no `raw` at all — the prompt shows the model the line and the answer comes
         * back holding only what it read. So the source line MUST be a parameter: an adapter that
         * reconstructed `raw` from the answer would be publishing the model's words as the cook's.
         */
        it('takes the source line from the caller, because the answer does not carry it', () => {
            expect(promoteLlmParse(makeLlmParse(), '  One  tablespoon of BUTTER\t').raw).toBe(
                '  One  tablespoon of BUTTER\t',
            );
        });
    });

    describe('the measure the model states', () => {
        it('reads the amount and the unit out of the stated phrase', () => {
            const promoted = promoteLlmParse(makeLlmParse({ statedMeasure: 'two cups' }), 'two cups of flour');

            expect(promoted.statedMeasure).toBe('two cups');
            expect(promoted.quantity).toEqual({ kind: 'exact', value: 2 });
            expect(promoted.unit).toBe('cup');
        });

        it('reads a stated measure no number can hold as absent, keeping the words', () => {
            const promoted = promoteLlmParse(
                makeLlmParse({ statedMeasure: 'the size of an egg', foods: [{ name: 'butter', prep: null }] }),
                'butter the size of an egg',
            );

            expect(promoted.statedMeasure).toBe('the size of an egg');
            expect(promoted.quantity).toEqual({ kind: 'absent' });
            expect(promoted.reviewReasons).toContain('no_quantity');
        });

        it('reads a null stated measure as absent and unitless', () => {
            const promoted = promoteLlmParse(makeLlmParse({ statedMeasure: null }), 'salt');

            expect(promoted.statedMeasure).toBeNull();
            expect(promoted.quantity).toEqual({ kind: 'absent' });
            expect(promoted.unit).toBeNull();
        });

        /**
         * ⚠️ `normalizeParseAnswer` already collapses `""` to `null` at the model boundary, and this
         * asserts the promotion does not RE-INTRODUCE the second representation if it is ever handed one —
         * the invariant belongs to the value, not to one producer of it.
         */
        it('collapses an empty stated measure to null', () => {
            expect(promoteLlmParse(makeLlmParse({ statedMeasure: '  ' }), 'salt').statedMeasure).toBeNull();
        });
    });

    /**
     * ⛔ THE MODEL'S PLACEMENT IS NOT RE-FILED HERE. KTD-11b is settled by the comparator's
     * canonicalisation, over BOTH engines' answers, immediately before they are compared — "removing a
     * disagreement never changes which engine's words are stored". An adapter that re-filed modifiers would
     * be a second copy of that rule, free to drift from the one the comparison actually uses.
     */
    describe('the model`s own words', () => {
        it('carries every food through verbatim, in the order the model named them', () => {
            const promoted = promoteLlmParse(
                makeLlmParse({
                    foods: [
                        { name: 'onion', prep: 'chopped' },
                        { name: 'sweet celery', prep: null },
                    ],
                }),
                'chopped onion and sweet celery',
            );

            expect(promoted.foods).toEqual([
                { name: 'onion', prep: 'chopped' },
                { name: 'sweet celery', prep: null },
            ]);
        });

        it('does NOT move a misplaced modifier, leaving that to the comparator', () => {
            const promoted = promoteLlmParse(
                makeLlmParse({ foods: [{ name: 'chopped onion', prep: null }] }),
                'chopped onion',
            );

            expect(promoted.foods).toEqual([{ name: 'chopped onion', prep: null }]);
            // The pair: the comparator DOES move it, so the assertion above is about layering, not inertia.
            expect(compareParses({ crf: { unavailable: true }, llm: promoted }).merged?.foods).toEqual([
                { name: 'onion', prep: 'chopped' },
            ]);
        });

        it('promotes an empty food list, which is a legitimate answer about a heading', () => {
            expect(promoteLlmParse(makeLlmParse({ foods: [] }), 'CAKES AND COOKIES').foods).toEqual([]);
        });
    });

    describe('provenance', () => {
        it('attributes every fact to the LLM', () => {
            expect(promoteLlmParse(makeLlmParse(), '1 tablespoon butter').provenance).toEqual({
                statedMeasure: 'llm',
                quantity: 'llm',
                unit: 'llm',
                foods: 'llm',
            });
        });
    });

    /**
     * ⛔ THE PROPERTY THE COMPARATOR DEPENDS ON. `FACT_COMPARATORS.quantity` and `.unit` compare the two
     * engines' READINGS. If each promotion did its own arithmetic, two engines that agreed about the phrase
     * could be reported as disagreeing about the number — a disagreement nobody could act on, on lines that
     * are not in dispute. One reader, so that cannot happen.
     */
    describe('one reader, both engines', () => {
        it.each(['two cups', 'one gill', '1½ cups', 'the size of an egg', '2 to 3 cups', ''])(
            'reads %j into the same amount and unit as the CRF promotion does',
            (measure) => {
                const line = `${measure} flour`;
                const crf = promoteCrfReading(
                    { sentence: line, measure, names: ['flour'], size: null, preparation: null, comment: null },
                    line,
                );
                const llm = promoteLlmParse(
                    { statedMeasure: measure === '' ? null : measure, foods: [{ name: 'flour', prep: null }] },
                    line,
                );

                expect(llm.quantity).toEqual(crf.quantity);
                expect(llm.unit).toBe(crf.unit);
                expect(compareParses({ crf, llm }).agreement).toEqual({ kind: 'agree' });
            },
        );
    });

    describe('purity', () => {
        it('does not mutate the answer it was handed', () => {
            const parse = makeLlmParse({ foods: [{ name: 'onion', prep: 'chopped' }] });
            const before = structuredClone(parse);

            promoteLlmParse(parse, 'chopped onion');

            expect(parse).toEqual(before);
        });
    });
});
