/**
 * Integration tier — THE PROMOTION LAYER OVER A COMMITTED SLICE OF REAL 1919 COOKBOOK TEXT (plan U22).
 *
 * | Requirement | Test |
 * | ----------- | ---- |
 * | U22 — an engine's output becomes a `ParsedLine` | "promotes every hand-checked phrase" |
 * | U16 — the same measure reads the same way for BOTH engines | "the two engines read one arithmetic" |
 * | KTD-12 — an engine that answered nothing is `single-engine`, not `differ` | "one engine silent" |
 * | GR-007 — every value the promotion emits is storable by recipe-core's schemas | "downstream contract" |
 * | HAZ-041 — `raw` is the source line byte-identical | "raw survives the promotion" |
 *
 * What this tier proves that the unit tier structurally cannot:
 *
 * 1. It runs the REAL `parse-ingredient` over measure phrases nobody wrote for a test. The unit tier pins
 *    hand-picked phrases; only this one runs the whole hand-checked corpus slice through the promotion.
 * 2. It crosses the seam the promotion's ONE non-obvious mechanism lives on. `parse-ingredient` will not
 *    name a unit with nothing after it, so `readStatedMeasure` re-reads the phrase with a placeholder food
 *    appended. If that mechanism ever stops working, EVERY promoted line silently loses its unit — and the
 *    assertion that catches it is exactly this one: the promotion's reading of the measure ALONE must equal
 *    the hand-checked unit the whole line was read into.
 * 3. It asserts the two promotions produce one arithmetic. `FACT_COMPARATORS.quantity` compares READINGS,
 *    so two adapters with two arithmetics would report engines disagreeing about numbers on lines where
 *    they agree about the words — invisible to any test that promotes only one side.
 * 4. Every value it calls resolved SATISFIES the schemas that guard the persisted columns.
 *
 * ⚠️ The measure phrase is DERIVED from the golden, not invented: the hand-checked `name` is stripped off
 * the hand-checked `phrase`, and the derivation is asserted (`the golden supports the derivation`) before
 * anything is promoted. Both halves were read out of the committed file by a human.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { recipeIngredientNameSchema, recipeIngredientQuantitySchema } from '@kitchensink/recipe-core';
import { describe, it, expect } from 'vitest';

import { compareParses, promoteCrfReading, promoteLlmParse, type CrfReading, type ParsedLine } from '../src/index.js';

import { GOLDEN_INGREDIENTS, type GoldenIngredient } from './__fixtures__/goldenCorpusParse.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CORPUS_MARKER = '--- CORPUS BEGINS ---';

/**
 * The corpus slice with its provenance block stripped, line endings normalized to LF.
 *
 * ⚠️ Same reader as `corpusPipeline.integration.test.ts`, and deliberately restated rather than shared:
 * DAMP over DRY in tests (CODING_STANDARDS §7), and a fixture reader extracted into a helper is a
 * dependency between two suites that must be able to fail independently.
 */
function readCorpus(): string {
    const file = readFileSync(join(HERE, '__fixtures__', 'internationalJewishCookBook.txt'), 'utf8');
    const body = file.split(CORPUS_MARKER)[1];

    if (body === undefined) {
        throw new Error(`Corpus fixture is missing its "${CORPUS_MARKER}" marker.`);
    }

    return body.replace(/\r\n/g, '\n');
}

/** How MOD-018 hands a wrapped source phrase to the parser: one line, single-spaced. */
function asExtractedField(phrase: string): string {
    return phrase.replace(/\s+/g, ' ').trim();
}

/**
 * The measure half of a hand-checked phrase — everything the hand-checked NAME is not.
 *
 * ⚠️ A trailing `of` goes with the measure: `"one cup of brown sugar"` states the measure `"one cup"`, and
 * the preposition belongs to neither half. `parse-ingredient` strips it from the description itself, which
 * is why the golden's name never carries it.
 *
 * @param golden - One hand-checked corpus phrase.
 * @returns The stated measure, or `''` when the phrase is all food. Pure.
 */
function statedMeasureOf(golden: GoldenIngredient): string {
    const line = asExtractedField(golden.phrase);

    return line
        .slice(0, line.length - golden.name.length)
        .trim()
        .replace(/\bof$/iu, '')
        .trim();
}

/** The CRF's row for a hand-checked phrase: the same measure and the same food, in the engine's shape. */
function asCrfRow(golden: GoldenIngredient): CrfReading {
    return {
        sentence: asExtractedField(golden.phrase),
        measure: statedMeasureOf(golden),
        names: [golden.name],
        size: null,
        preparation: null,
        comment: null,
    };
}

/** The two engines' promoted parses of one hand-checked phrase. */
function promoteBoth(golden: GoldenIngredient): { readonly crf: ParsedLine; readonly llm: ParsedLine } {
    const line = asExtractedField(golden.phrase);
    const measure = statedMeasureOf(golden);

    return {
        crf: promoteCrfReading(asCrfRow(golden), line),
        llm: promoteLlmParse(
            { statedMeasure: measure === '' ? null : measure, foods: [{ name: golden.name, prep: null }] },
            line,
        ),
    };
}

const corpus = readCorpus();

describe('the golden supports the derivation', () => {
    it('takes every phrase VERBATIM from the committed slice, so the corpus cannot drift into fiction', () => {
        for (const golden of GOLDEN_INGREDIENTS) {
            expect(corpus, `"${golden.phrase}" should occur in the corpus slice`).toContain(golden.phrase);
        }
    });

    it('ends every phrase with the food it names, which is what makes the measure derivable', () => {
        for (const golden of GOLDEN_INGREDIENTS) {
            expect(asExtractedField(golden.phrase).endsWith(golden.name), `"${golden.phrase}"`).toBe(true);
        }
    });

    /**
     * ⛔ ANTI-VACUITY. If the derivation collapsed to `''` everywhere, every assertion below would still
     * pass — against a promotion that read nothing. This is what makes the suite non-vacuous, and it is the
     * lesson the verification bake-off recorded: read the actual corpus before believing a rate from it.
     */
    it('derives a real measure for most of the corpus, and both a UNIT and a bare AMOUNT among them', () => {
        const measures = GOLDEN_INGREDIENTS.map(statedMeasureOf).filter((measure) => measure !== '');

        expect(measures.length).toBeGreaterThan(GOLDEN_INGREDIENTS.length / 2);
        expect(GOLDEN_INGREDIENTS.filter((golden) => golden.unit !== null).length).toBeGreaterThan(10);
        expect(
            GOLDEN_INGREDIENTS.filter((golden) => golden.unit === null && golden.quantity !== null).length,
        ).toBeGreaterThan(2);
    });
});

describe('promotes every hand-checked phrase', () => {
    it.each(GOLDEN_INGREDIENTS.map((golden) => [golden.phrase, golden] as const))(
        'reads %j into the amount and unit a human checked',
        (_phrase, golden) => {
            const { crf } = promoteBoth(golden);

            expect(crf.quantity).toEqual(
                golden.quantity === null ? { kind: 'absent' } : { kind: 'exact', value: golden.quantity },
            );
            expect(crf.unit).toBe(golden.unit);
        },
    );

    it('carries the source line through byte-identical, whatever the engine read', () => {
        for (const golden of GOLDEN_INGREDIENTS) {
            const line = asExtractedField(golden.phrase);

            expect(promoteCrfReading(asCrfRow(golden), line).raw).toBe(line);
            expect(promoteLlmParse({ statedMeasure: null, foods: [] }, golden.phrase).raw).toBe(golden.phrase);
        }
    });

    /**
     * ⚠️ The golden's `needsReview` is `parseIngredientLine`'s judgement of the WHOLE line, so it is not
     * this promotion's to reproduce — a promotion never sees the food text as part of the measure. What IS
     * asserted is the invariant that outlives that difference: an absent amount always says why.
     */
    it('never leaves an absent amount unexplained', () => {
        for (const golden of GOLDEN_INGREDIENTS) {
            const { crf } = promoteBoth(golden);

            if (crf.quantity.kind === 'absent') {
                expect(crf.reviewReasons.length, `"${golden.phrase}"`).toBeGreaterThan(0);
            }
        }
    });
});

describe('the two engines read one arithmetic', () => {
    it('promotes the same stated measure into the same amount and unit on both legs', () => {
        for (const golden of GOLDEN_INGREDIENTS) {
            const { crf, llm } = promoteBoth(golden);

            expect(llm.quantity, `"${golden.phrase}"`).toEqual(crf.quantity);
            expect(llm.unit, `"${golden.phrase}"`).toBe(crf.unit);
        }
    });

    it('reports two engines that read the same line as agreeing, not differing', () => {
        for (const golden of GOLDEN_INGREDIENTS) {
            const { crf, llm } = promoteBoth(golden);

            expect(compareParses({ crf, llm }).agreement, `"${golden.phrase}"`).toEqual({ kind: 'agree' });
        }
    });

    /**
     * ⛔ KTD-12. An engine that produced nothing is ABSENCE, not dissent — and the merged line must still
     * be the answering engine's parse, attributed wholly to it.
     */
    it('resolves one engine silent to single-engine, keeping the other`s reading', () => {
        const golden = GOLDEN_INGREDIENTS[0] as GoldenIngredient;
        const { crf } = promoteBoth(golden);
        const comparison = compareParses({ crf, llm: { unavailable: true } });

        expect(comparison.agreement).toEqual({ kind: 'single-engine', engine: 'crf' });
        expect(comparison.merged?.quantity).toEqual(crf.quantity);
        expect(comparison.merged?.provenance).toEqual({
            statedMeasure: 'crf',
            quantity: 'crf',
            unit: 'crf',
            foods: 'crf',
        });
    });
});

/**
 * GR-007 — the values this package emits must be storable by the schemas guarding the persisted columns. A
 * mocked boundary cannot make this assertion; it is the one that stops a `500` at INSERT.
 */
describe('downstream contract', () => {
    it('emits an amount every stated bound of which recipe-core will store', () => {
        for (const golden of GOLDEN_INGREDIENTS) {
            const { crf } = promoteBoth(golden);

            if (crf.quantity.kind === 'exact') {
                expect(recipeIngredientQuantitySchema.safeParse(crf.quantity.value).success, golden.phrase).toBe(true);
            }

            if (crf.quantity.kind === 'range') {
                expect(recipeIngredientQuantitySchema.safeParse(crf.quantity.low).success, golden.phrase).toBe(true);
                expect(recipeIngredientQuantitySchema.safeParse(crf.quantity.high).success, golden.phrase).toBe(true);
            }
        }
    });

    it('emits food names recipe-core will store', () => {
        for (const golden of GOLDEN_INGREDIENTS) {
            for (const food of promoteBoth(golden).crf.foods) {
                expect(recipeIngredientNameSchema.safeParse(food.name).success, food.name).toBe(true);
            }
        }
    });
});
