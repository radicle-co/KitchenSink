/**
 * Integration tier for U38: an ABSENT CRF amount is absence, not dissent — and the census and the merge
 * must dispose of it the same way.
 *
 * ## ⛔ WHAT ONLY THIS TIER CAN PROVE
 *
 * `parseComparator.test.ts` proves the winner rule and `parseAgreement.test.ts` proves the verdict, but
 * both state the CRF's reading as a literal written into the file. Two claims sit under that literal, and
 * neither is a fact about our code:
 *
 *  1. the real `ingredient-parser-nlp==2.3.0` really does return a UNIT and NO AMOUNT for `a cup of water`
 *     — a measure text of `cup` — which is the whole shape the ruling is about; and
 *  2. it really does return `dozen` for `a dozen small cantaloupes`, which is the measured line that makes
 *     the units-agree conjunct load-bearing rather than decorative.
 *
 * If either moved, the rule would quietly stop firing (or start firing on a shape nobody measured) while
 * every unit test in this repository stayed green. So this tier drives the REAL Python engine over the REAL
 * sidecar, and — like `joinedAmountAlignment.integration.test.ts` — asserts BOTH code paths in the same
 * assertion: the census (`compareParses` + `disposeAgreement`, the comparison harness) and the merge
 * (`promoteCrfReading` + `promoteLlmParse` + `recipe-import-core`'s own `compareParses`, the shipped
 * pipeline). A test that re-stated only one of them would have passed on the day they diverged.
 *
 * ⚠️ The model half is STATED, not billed: no Bedrock call is made by any test (ADR-0024 guards none), so
 * each row carries the measure phrase the source plainly states — which is what the owner's 2026-08-28
 * re-run of both engines over 40 of the 206 defective lines reported the model reading.
 *
 * Skipped (not failed) when `python3 -c "import ingredient_parser"` does not succeed — the same guard
 * `crfParse.integration.test.ts` uses, for the same reason.
 */
import { execFileSync } from 'node:child_process';

import { compareParses as mergeParses, promoteCrfReading, promoteLlmParse } from '@kitchensink/recipe-import-core';
import { describe, expect, it } from 'vitest';

import { parseLinesWithCrf } from '../src/parseComparison/crfProcess.js';
import { compareParses, disposeAgreement } from '../src/parseComparison/parseAgreement.js';
import type { AgreementDisposition } from '../src/parseComparison/parseAgreement.js';
import type { ModelParse } from '../src/parseComparison/parseResponse.js';

function crfIsInstalled(): boolean {
    try {
        execFileSync('python3', ['-c', 'import ingredient_parser'], { stdio: 'ignore' });

        return true;
    } catch {
        return false;
    }
}

const describeIfInstalled = crfIsInstalled() ? describe : describe.skip;

/** One measured line, the reading each engine gave it, and what BOTH paths must then say. */
interface AlignmentCase {
    /** The ingredient line, handed to the real engine verbatim. */
    readonly line: string;
    /** The measure phrase the model read, transcribed rather than idealised. */
    readonly model: ModelParse;
    /**
     * The measure text the REAL engine returns, verbatim.
     *
     * ⛔ Pinned as engine OUTPUT rather than derived from our own reader — a derived check ("the CRF states
     * no amount") would restate the rule and would pass on the day the engine stopped producing the shape.
     */
    readonly crfMeasure: string;
    /** What the census does about the line. */
    readonly disposition: AgreementDisposition;
    /** The amount the MERGE stores, as a plain number, or `null` when it stores none. */
    readonly mergedQuantity: number | null;
    /** Which engine the stored amount is credited to. */
    readonly quantityFrom: 'crf' | 'llm';
    /** The unit the MERGE stores. */
    readonly mergedUnit: string | null;
    /** Why this row is in the table, so a failure reports an argument rather than a diff. */
    readonly why: string;
}

const CASES: readonly AlignmentCase[] = [
    {
        line: 'a cup of water',
        model: { measure: 'a cup', foods: [{ name: 'water', prep: null }] },
        crfMeasure: 'cup',
        disposition: 'llmWins',
        mergedQuantity: 1,
        quantityFrom: 'llm',
        mergedUnit: 'cup',
        why: 'the shape the ruling is about — the CRF reads the UNIT and no number',
    },
    {
        line: 'Forty-five large tomatoes',
        model: { measure: 'forty-five', foods: [{ name: 'tomatoes', prep: null }] },
        crfMeasure: '',
        disposition: 'llmWins',
        mergedQuantity: 45,
        quantityFrom: 'llm',
        mergedUnit: null,
        why: 'neither engine states a unit, so the units agree and the model has the only number',
    },
    {
        // ⛔ THE ANTI-MANUFACTURE ROW, and the only one the ruling DECLINES. The CRF reads `dozen` as the
        // unit of an amount it never found; the model folds that same word into `12`. Joining the two
        // publishes TWELVE DOZEN cantaloupes — a reading neither engine gave — so both paths leave the line
        // with the CRF and REPORT it. A mutant that drops the units-agree conjunct from either path fails
        // here and only here.
        line: 'a dozen small cantaloupes',
        model: { measure: 'a dozen', foods: [{ name: 'cantaloupes', prep: null }] },
        crfMeasure: 'dozen',
        disposition: 'crfWins',
        mergedQuantity: null,
        quantityFrom: 'crf',
        mergedUnit: 'dozen',
        why: 'the units disagree, so taking the number alone would store `12 dozen`',
    },
    {
        // The honestly-unstated case — 9 of the owner's 40-line sample. The model read no amount either, so
        // the phrase is transcribed as the bare unit, which is what `readStatedMeasure` answers
        // `ABSENT_QUANTITY` for. Nothing to rescue, nothing to re-attribute, and the two paths agree.
        line: 'a tablespoon of butter',
        model: { measure: 'tablespoon', foods: [{ name: 'butter', prep: null }] },
        crfMeasure: 'tablespoon',
        disposition: 'agreed',
        mergedQuantity: null,
        quantityFrom: 'crf',
        mergedUnit: 'tablespoon',
        why: 'both engines silent about the number — the anti-vacuity row for the whole table',
    },
];

describeIfInstalled('U38 — an absent CRF amount, against the real CRF engine', () => {
    it('reads the measured lines, and the census and the merge dispose of every one of them alike', async () => {
        const parses = await parseLinesWithCrf(CASES.map((entry) => entry.line));

        // ⛔ Anti-vacuity BEFORE the invariant. A run that returned nothing would make every mapped
        // assertion below trivially true, which is precisely how a suite comes to prove nothing at all.
        expect(parses).toHaveLength(CASES.length);

        const observed = CASES.map((entry, index) => {
            const crf = parses[index];

            if (crf === undefined) {
                throw new Error(`the CRF returned no row for "${entry.line}"`);
            }

            expect(crf.sentence, 'the sidecar echoed a different line back').toBe(entry.line);

            // The MERGE path — the shipped pipeline, through the real promotion adapters.
            const merged = mergeParses({
                crf: promoteCrfReading(crf, entry.line),
                llm: promoteLlmParse({ statedMeasure: entry.model.measure, foods: entry.model.foods }, entry.line),
            });
            const quantity = merged.merged?.quantity;

            return {
                line: entry.line,
                why: entry.why,
                crfMeasure: crf.measure,
                // The CENSUS path — the comparison harness.
                disposition: disposeAgreement(compareParses(entry.model, crf).kind),
                mergedQuantity: quantity?.kind === 'exact' ? quantity.value : null,
                quantityFrom: merged.merged?.provenance.quantity ?? null,
                mergedUnit: merged.merged?.unit ?? null,
            };
        });

        expect(observed, 'the real engine no longer produces the readings U38 was measured on').toStrictEqual(
            CASES.map((entry) => ({
                line: entry.line,
                why: entry.why,
                crfMeasure: entry.crfMeasure,
                disposition: entry.disposition,
                mergedQuantity: entry.mergedQuantity,
                quantityFrom: entry.quantityFrom,
                mergedUnit: entry.mergedUnit,
            })),
        );
    }, 300_000);

    it('⛔ never lets the census say `crfWins` about a line whose stored amount came from the model', async () => {
        // ⛔ THE ALIGNMENT AS A PROPERTY, stated over the table rather than row by row. §14.6 of the
        // 2026-08-23 report is what this exists to prevent: two code paths answering the same question
        // differently, discovered only by re-deriving a whole corpus. The row-by-row assertion above would
        // pass on a table someone updated to match a NEW divergence; this one cannot.
        const parses = await parseLinesWithCrf(CASES.map((entry) => entry.line));

        expect(parses).toHaveLength(CASES.length);

        for (const [index, entry] of CASES.entries()) {
            const crf = parses[index];

            if (crf === undefined) {
                throw new Error(`the CRF returned no row for "${entry.line}"`);
            }

            const merged = mergeParses({
                crf: promoteCrfReading(crf, entry.line),
                llm: promoteLlmParse({ statedMeasure: entry.model.measure, foods: entry.model.foods }, entry.line),
            });
            const disposition = disposeAgreement(compareParses(entry.model, crf).kind);

            if (merged.merged?.provenance.quantity === 'llm') {
                expect(
                    disposition,
                    `the census disposes ${disposition} where the merge took the model's amount`,
                ).not.toBe('crfWins');
            }
        }
    }, 300_000);
});
