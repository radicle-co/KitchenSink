/**
 * THE CRF'S ROW, PROMOTED TO THE CANONICAL PARSE (plan U22, phase 3).
 *
 * Nothing in the tree turned an engine's output into a `ParsedLine` before this: `compareParses` CONSUMES
 * one, `llmParse` produces an `LlmParse`, and the CRF Lambda produces a flattened row. This adapter closes
 * the CRF half of that gap.
 *
 * | Requirement | Test |
 * | ----------- | ---- |
 * | HAZ-041 — `raw` is the input byte-identical, unconditionally | "raw is the SOURCE line" |
 * | U16 — `null` is the ONE representation of "no measure stated" | "the measure the row states" |
 * | `ParsedFacts.statedMeasure` — the source's words, not the engine's | "the stated measure is the SOURCE`s words" |
 * | U16 / KTD-11b — `size` is IDENTITY and there is no `size` member | "size, which is identity" |
 * | U16 — a preparation belongs to the foods the line named | "the preparation the row states" |
 * | U16 — the foods are a fact; an empty list is not a failure | "a row that named no food" |
 * | KTD-13 — every fact the CRF produced is attributed to the CRF | "provenance" |
 *
 * ⚠️ The `size` and `preparation` tests are the ones that would pass against an adapter doing nothing, so
 * each is paired with an assertion that the OTHER field did not receive the word.
 */
import { describe, it, expect } from 'vitest';

import { compareParses } from '../parseComparator.js';
import { promoteCrfReading, type CrfReading } from '../promoteCrfReading.js';

/** One CRF row — a clean, single-food, fully-read line unless overridden. */
function makeCrfReading(overrides: Partial<CrfReading> = {}): CrfReading {
    return {
        sentence: '1 tablespoon butter',
        measure: '1 tablespoon',
        names: ['butter'],
        size: null,
        preparation: null,
        comment: null,
        ...overrides,
    };
}

describe('promoteCrfReading', () => {
    describe('raw is the SOURCE line, never the engine`s echo of it', () => {
        /**
         * ⛔ THE TWO DOCSTRINGS DISAGREE, WHICH IS WHY THE SOURCE LINE IS A PARAMETER. `crfParse.ts` calls
         * `sentence` "the line as it was submitted, echoed back"; `engine.schema.ts` calls the very same
         * field "the parser's NORMALISED sentence". Only one of those can be byte-identical to the input,
         * and HAZ-041 requires `raw` to be. So the caller supplies it and this adapter never guesses.
         */
        it('carries the source line through even when the engine normalised what it read', () => {
            const promoted = promoteCrfReading(
                makeCrfReading({ sentence: '1 tablespoon butter' }),
                '  One  tablespoon of BUTTER\t',
            );

            expect(promoted.raw).toBe('  One  tablespoon of BUTTER\t');
        });

        it('carries a source line the engine could read nothing out of', () => {
            const promoted = promoteCrfReading(
                makeCrfReading({ measure: '', names: [], preparation: null }),
                'CAKES AND COOKIES',
            );

            expect(promoted.raw).toBe('CAKES AND COOKIES');
            expect(promoted.foods).toEqual([]);
        });
    });

    describe('the measure the row states', () => {
        it('reads the amount and the unit out of the row`s own measure text', () => {
            const promoted = promoteCrfReading(makeCrfReading({ measure: 'two cups' }), 'two cups of flour');

            expect(promoted.statedMeasure).toBe('two cups');
            expect(promoted.quantity).toEqual({ kind: 'exact', value: 2 });
            expect(promoted.unit).toBe('cup');
        });

        /**
         * ⛔ U16's invariant, and the CRF is the engine that violates it: it returns `''` where the LLM
         * returns `null`. Two representations of one fact would partition the parse cache and would make
         * the comparator report a measure disagreement between two engines that agree there is none.
         */
        it.each(['', '   '])('collapses the empty measure %j to null, never to an empty string', (measure) => {
            const promoted = promoteCrfReading(makeCrfReading({ measure }), 'salt');

            expect(promoted.statedMeasure).toBeNull();
            expect(promoted.quantity).toEqual({ kind: 'absent' });
            expect(promoted.reviewReasons).toContain('no_quantity');
        });

        it('carries the reading`s reasons rather than deriving its own', () => {
            const promoted = promoteCrfReading(makeCrfReading({ measure: '3 to 2 cups' }), '3 to 2 cups of flour');

            expect(promoted.reviewReasons).toEqual(['quantity_bounds_inverted']);
            expect(promoted.quantity).toEqual({ kind: 'absent' });
        });
    });

    /**
     * ⛔ `statedMeasure` is the measure "EXACTLY as the source stated it" (`ParsedFacts`), and the engine's `measure`
     * is not: `ingredient-parser-nlp` 2.3.0 re-renders its amount text. Every engine text below is that engine's REAL
     * answer for the line, measured 2026-11-06, unless the case says it is built to test one rule. Two readers trust
     * the contract: the editor saves a pasted row's unit from these words (`pastedLineRowOf`), and the match list draws
     * the line's leading measure from them (`lineTextOf`). Fed `2-3 cup` for `2-3 cups chicken stock`, the first saved
     * the unit `cup` and the second drew `2-3 cup` + `s chicken stock`.
     */
    describe('the stated measure is the SOURCE`s words, never the engine`s re-rendering of them', () => {
        it.each([
            ['2-3 cups chicken stock', '2-3 cup', '2-3 cups', { kind: 'range', low: 2, high: 3 }, 'cup'],
            ['2 to 3 cups rice', '2-3 cup', '2 to 3 cups', { kind: 'range', low: 2, high: 3 }, 'cup'],
            ['2–3 cups stock', '2-3 cup', '2–3 cups', { kind: 'range', low: 2, high: 3 }, 'cup'],
            ['1½ cups flour', '1 1/2 cups', '1½ cups', { kind: 'exact', value: 1.5 }, 'cup'],
            ['½ cup sugar', '1/2 cups', '½ cup', { kind: 'exact', value: 0.5 }, 'cup'],
            [
                '2 to 3 heaping cups flour',
                '2-3 heaping cup',
                '2 to 3 heaping cups',
                { kind: 'range', low: 2, high: 3 },
                null,
            ],
            [
                '1-2 cups plus 1 tablespoon broth',
                '1-2 cup plus 1 tablespoon',
                '1-2 cups plus 1 tablespoon',
                { kind: 'range', low: 1, high: 2 },
                'cup',
            ],
            // The engine adds an `s` to an abbreviation it pluralises, a spelling no reader knows, so it reads no unit.
            ['2 Tbsp olive oil', '2 Tbsps', '2 Tbsp', { kind: 'exact', value: 2 }, null],
            ['2 Tbsp. butter', '2 Tbsps', '2 Tbsp.', { kind: 'exact', value: 2 }, null],
            ['1/2 tsp vanilla', '1/2 tsps', '1/2 tsp', { kind: 'exact', value: 0.5 }, null],
        ] as const)('%j, read by the engine as %j, states %j', (line, measure, words, quantity, unit) => {
            const promoted = promoteCrfReading(makeCrfReading({ sentence: line, measure }), line);

            expect(promoted.statedMeasure).toBe(words);
            // Only the words move: the amount and the unit are still the engine's own reading.
            expect(promoted.quantity).toEqual(quantity);
            expect(promoted.unit).toBe(unit);
        });

        it('keeps the source`s own spacing inside the measure', () => {
            const line = '2-3  cups chicken stock';

            expect(promoteCrfReading(makeCrfReading({ sentence: line, measure: '2-3 cup' }), line).statedMeasure).toBe(
                '2-3  cups',
            );
        });

        // A list separator after the measure is the line's punctuation, not the cook's unit.
        it.each([
            ['2 cups, sifted flour', '2 cups', '2 cups'],
            ['2-3 cups, warmed stock', '2-3 cup', '2-3 cups'],
            [
                '3 tablespoons, plus 1 tablespoon, butter',
                '3 tablespoons plus 1 tablespoon',
                '3 tablespoons, plus 1 tablespoon',
            ],
        ])('ends %j`s measure before the separator that follows it', (line, measure, words) => {
            expect(promoteCrfReading(makeCrfReading({ sentence: line, measure }), line).statedMeasure).toBe(words);
        });

        it.each([
            ['2 cups and 1 tablespoon flour', '2 cups and 1 tablespoon'],
            ['6 thin slices lemon or orange', '6 thin slices'],
            ['2 small cans tuna', '2 small cans'],
        ])('keeps %j`s measure %j, which the source already states in those words', (line, measure) => {
            expect(promoteCrfReading(makeCrfReading({ sentence: line, measure }), line).statedMeasure).toBe(measure);
        });

        /**
         * Where the line's words cannot be lined up with the engine's one for one, the engine's text stands, which is
         * what every line stored before this. Naming a span anyway is the worse failure: the editor would save a food's
         * words as the unit, and the match list would draw them heavier as the measure.
         */
        it.each([
            // The engine joined two amounts from two places in the line (measured on a 2010 cookbook).
            ['1 yeast roll recipe (p. 59)', '1 59'],
            ['½ cup ice cream = ¼ cup milk', '1/2 cups 1/4 cups'],
            ['1 (14 oz) can tomatoes', '1 can 14 oz'],
            // The line leads with the food, so nothing before the measure is an amount like the engine's.
            ['Chicken stock, 2-3 cups', '2-3 cup'],
            ['Flour, 2 cups', '2 cups'],
            // One cup is not one to two cups: the amounts must be the same amount.
            ['1 cup or 2 cups flour', '1-2 cup'],
            // The engine read the unit and no amount, past the article the line leads with.
            ['a cup of water', 'cup'],
            // The house amount reader reads digits, not number words; the editor reads a saved measure with it too.
            ['one cup sugar', '1 cup'],
            // Built to test one rule each: a word must state the same unit, and a word that states no measure must be
            // the same word.
            ['2 large eggs', '2 small'],
            ['6 thick slices bread', '6 thin slices'],
            // Built: only a word that states a unit takes the engine's `s`; `thins` is not `thin` pluralised.
            ['6 thin slices bread', '6 thins slices'],
            // The engine read no amount, so the line's `2` must not ride into the measure: the editor reads the amount
            // it saves out of these words, and would save one the parse never read.
            ['2 cups flour', 'cups'],
        ])('keeps the engine`s text for %j, whose words do not line up with %j', (line, measure) => {
            expect(promoteCrfReading(makeCrfReading({ sentence: line, measure }), line).statedMeasure).toBe(measure);
        });
    });

    /**
     * ⛔ U16's owner ruling, reversing an earlier draft: `ParsedLine` has NO `size` member, because `large`
     * is an adjective and KTD-11b files an adjective as IDENTITY. There is no exception for `large` that
     * does not also reopen `sweet`, `brown` and `Italian`.
     */
    describe('size, which is identity', () => {
        it('canonicalises the size into the name, and NOT into the preparation', () => {
            const promoted = promoteCrfReading(makeCrfReading({ names: ['onion'], size: 'large' }), '1 large onion');

            expect(promoted.foods).toEqual([{ name: 'large onion', prep: null }]);
        });

        it('leaves the name untouched when the row states no size', () => {
            expect(promoteCrfReading(makeCrfReading({ names: ['onion'] }), '1 onion').foods).toEqual([
                { name: 'onion', prep: null },
            ]);
        });

        it('does not say the size twice when the engine already put it in the name', () => {
            const promoted = promoteCrfReading(
                makeCrfReading({ names: ['Large onion'], size: 'large' }),
                '1 Large onion',
            );

            expect(promoted.foods).toEqual([{ name: 'Large onion', prep: null }]);
        });

        /**
         * ⛔ The promoted line must already satisfy KTD-11b, not rely on the comparator to repair it — a
         * parse is CACHED per engine (U20), and a cached row filing an adjective under preparation would be
         * served to every later reader. This asserts idempotence: the comparator moves nothing.
         */
        it('produces a line the comparator`s placement rule leaves alone', () => {
            const promoted = promoteCrfReading(
                makeCrfReading({ names: ['onion'], size: 'large', preparation: 'chopped' }),
                '1 large onion, chopped',
            );
            const comparison = compareParses({ crf: promoted, llm: { unavailable: true } });

            expect(comparison.merged?.foods).toEqual(promoted.foods);
        });
    });

    describe('the preparation the row states', () => {
        it('gives the preparation to the food, and NOT to the name', () => {
            const promoted = promoteCrfReading(
                makeCrfReading({ names: ['butter'], preparation: 'melted' }),
                '1 tablespoon butter, melted',
            );

            expect(promoted.foods).toEqual([{ name: 'butter', prep: 'melted' }]);
        });

        /**
         * ⚠️ DISTRIBUTED, deliberately. The sidecar flattens a per-token label into ONE field, so the
         * adjacency that said WHICH food was prepared is already gone by the time it reaches us. Giving it
         * to the first food only would silently drop it for the rest; giving it to all of them over-applies
         * a fact that is not identity and that `projectToIngredientLine` drops anyway.
         */
        it('distributes one preparation across every food the row named', () => {
            const promoted = promoteCrfReading(
                makeCrfReading({ names: ['onion', 'celery', 'carrot'], preparation: 'chopped' }),
                'chopped onion, celery and carrot',
            );

            expect(promoted.foods).toEqual([
                { name: 'onion', prep: 'chopped' },
                { name: 'celery', prep: 'chopped' },
                { name: 'carrot', prep: 'chopped' },
            ]);
        });

        it.each(['', '   '])('collapses the empty preparation %j to null', (preparation) => {
            expect(promoteCrfReading(makeCrfReading({ preparation }), '1 tablespoon butter').foods).toEqual([
                { name: 'butter', prep: null },
            ]);
        });
    });

    /**
     * ⚠️ `comment` is the CRF's own "trailing matter I declined to call a name or a preparation". There is
     * no field for it and inventing one would let a third-party parser's output shape our schema — the very
     * mistake U16 recorded for `size`. Nothing is lost: `raw` carries the whole line byte-identical.
     */
    describe('comment, which has no field', () => {
        it('discards the comment without putting it in the name or the preparation', () => {
            const promoted = promoteCrfReading(
                makeCrfReading({ names: ['butter'], comment: 'or margarine' }),
                '1 tablespoon butter or margarine',
            );

            expect(promoted.foods).toEqual([{ name: 'butter', prep: null }]);
            expect(promoted.raw).toContain('or margarine');
            expect(promoted).not.toHaveProperty('comment');
        });
    });

    describe('a row that named no food', () => {
        it('promotes an empty name list to an empty food list, which is a fact rather than a failure', () => {
            const promoted = promoteCrfReading(makeCrfReading({ names: [], preparation: 'chopped' }), 'Chop finely.');

            expect(promoted.foods).toEqual([]);
        });

        it('drops a nameless entry rather than carrying a food with no identity', () => {
            const promoted = promoteCrfReading(makeCrfReading({ names: ['butter', '  ', ''] }), '1 tablespoon butter');

            expect(promoted.foods).toEqual([{ name: 'butter', prep: null }]);
        });
    });

    describe('provenance', () => {
        it('attributes every fact to the CRF, because the CRF read every one of them', () => {
            expect(promoteCrfReading(makeCrfReading(), '1 tablespoon butter').provenance).toEqual({
                statedMeasure: 'crf',
                quantity: 'crf',
                unit: 'crf',
                foods: 'crf',
            });
        });
    });

    describe('purity', () => {
        it('does not mutate the row it was handed', () => {
            const reading = makeCrfReading({ names: ['onion'], size: 'large', preparation: 'chopped' });
            const before = structuredClone(reading);

            promoteCrfReading(reading, '1 large onion, chopped');

            expect(reading).toEqual(before);
        });
    });
});

/**
 * Owner ruling 2026-11-06, the CRF stage. The engine itself keeps `dried`, `frozen` and `canned` in its `names` (real
 * answers, `ingredient-parser-nlp` 2.3.0, 2026-11-06; across the 2,490-line 1919 corpus it never tags one as
 * preparation). The adapter passes the name through whole, and a cook's own step after the comma stays preparation.
 */
describe('promoteCrfReading — a form the cook buys', () => {
    it.each([
        ['1 tsp dried thyme', '1 tsp', 'dried thyme', null],
        ['2 cups frozen blueberries, thawed', '2 cups', 'frozen blueberries', 'thawed'],
        ['2 cups canned tomatoes', '2 cups', 'canned tomatoes', null],
    ] as const)('%j keeps its food %j whole', (sentence, measure, name, preparation) => {
        const parsed = promoteCrfReading(makeCrfReading({ sentence, measure, names: [name], preparation }), sentence);

        expect(parsed.foods).toEqual([{ name, prep: preparation }]);
    });
});
