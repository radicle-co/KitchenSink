/**
 * Integration tier for U37: a JOINED CRF amount is several amounts, and the census and the merge must
 * dispose of it the same way.
 *
 * ## ⛔ WHAT ONLY THIS TIER CAN PROVE
 *
 * `parseNormalization.test.ts` proves the fold no longer calls a number a unit, and
 * `parseAgreement.test.ts` proves the verdict that follows. Neither can notice the thing the whole repair
 * rests on, because both state the CRF's measure text as a literal written into the file:
 *
 * > the engine really does return SEVERAL amounts for these lines, and `crfProcess.ts` really does join
 * > them into one string with the second amount's number sitting where a unit would be.
 *
 * That is a claim about a third-party model (`ingredient-parser-nlp==2.3.0`) we neither own nor pin beyond
 * a version string. If a future engine stops joining — or starts emitting a unit for the first amount —
 * the repaired branch quietly stops firing and every unit test in this repository stays green. So this tier
 * drives the REAL Python engine over the REAL sidecar.
 *
 * ## ⛔ AND IT CROSSES THE SEAM THE DIVERGENCE LIVED IN
 *
 * §14.6 of the 2026-08-23 report is not a fact about one function: it is two code paths answering the same
 * question differently. So this tier asserts BOTH — the census (`compareParses` + `disposeAgreement`, the
 * comparison harness) and the merge (`promoteCrfReading` + `promoteLlmParse` + `recipe-import-core`'s own
 * `compareParses`, the shipped pipeline) — on the same engine output, in the same assertion. A test that
 * only re-stated the census would have passed on the day the divergence was opened.
 *
 * ⚠️ The model half is stated here, not billed: no Bedrock call is made by any test (ADR-0024 guards none),
 * so each row carries the reading the source plainly states. Those readings are transcribed from the Nova
 * Micro run of 2026-08-25 that §14 was measured over — they are what the model actually returned, not an
 * idealisation of it.
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
import { normalizeMeasure } from '../src/parseComparison/parseNormalization.js';
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

/** One of §14.6's divergent lines, with the reading each engine gave it and what the two paths must say. */
interface DivergentCase {
    /** The oracle seed id, so a failure names the corpus row rather than a string. */
    readonly id: string;
    /** The ingredient line, handed to the real engine verbatim. */
    readonly line: string;
    /** What Nova Micro returned for it on 2026-08-25 — transcribed, not idealised. */
    readonly model: ModelParse;
    /**
     * The measure text the REAL engine returns, verbatim.
     *
     * ⛔ THE PRECONDITION THE WHOLE REPAIR RESTS ON, and it is pinned as engine OUTPUT rather than derived
     * from the fold — a derived check ("the residue is non-empty") would be a restatement of the repair and
     * would have passed on the day the divergence was opened. What must not change silently is that
     * `crfProcess.ts` receives several amount tuples and JOINS them into one string.
     */
    readonly crfMeasure: string;
    /** Whether the CRF's measure text folds to NO unit. `true` is the repair; L00777 is why it is a field. */
    readonly crfUnitIsEmpty: boolean;
    /** What the census does about the line. */
    readonly disposition: AgreementDisposition;
    /** Why this row is in the table, so a failure reports an argument rather than a diff. */
    readonly why: string;
}

/**
 * The eight lines §14.6 measured, every one of them.
 *
 * ⛔ ALL EIGHT, not the seven that move. L00777 is the one the repair does NOT reach, and leaving it out
 * would let "the divergence is closed" round 7 up to 8 — the exact overstatement this table exists to
 * prevent. It is also the anti-over-reach row: a mutant that made `normalizeMeasure` reject ANY unit it
 * could not place would take `quart` out of L00777 too, and only this row would fail.
 */
const CASES: readonly DivergentCase[] = [
    {
        id: 'L00054',
        line: 'one and one-half or two pounds of beef',
        model: { measure: 'one and one-half or two pounds', foods: [{ name: 'beef', prep: null }] },
        crfMeasure: '1 1/2 2 pounds',
        crfUnitIsEmpty: true,
        disposition: 'llmWins',
        why: 'a fraction joined to a second whole amount — the CRF measure text is `1 1/2 2 pounds`',
    },
    {
        id: 'L00290',
        line: 'three or four large spoonfuls)',
        model: { measure: 'three or four large spoonfuls', foods: [{ name: 'spoonfuls', prep: null }] },
        crfMeasure: '3 4',
        crfUnitIsEmpty: true,
        disposition: 'llmWins',
        why: 'two amounts and NOTHING after them — the CRF measure text is the bare `3 4`',
    },
    {
        id: 'L00843',
        line: 'three or four ounces of smoked fat meat in the centre',
        model: { measure: 'three or four ounces', foods: [{ name: 'smoked fat meat', prep: null }] },
        crfMeasure: '3 4 ounces',
        crfUnitIsEmpty: true,
        disposition: 'llmWins',
        why: 'the plain range shape, on a unit the CRF knows perfectly well',
    },
    {
        id: 'L01547',
        line: 'one to one and one-half boxes of strawberries to taste',
        model: { measure: 'one to one and one-half boxes', foods: [{ name: 'strawberries', prep: null }] },
        crfMeasure: '1 1 1/2 boxes',
        crfUnitIsEmpty: true,
        disposition: 'llmWins',
        why: 'the second amount is a FRACTION (`1 1 1/2 boxes`), which a digit-shaped guard would miss',
    },
    {
        id: 'L01548',
        line: 'one to one and one-half boxes of berries to each short cake',
        model: { measure: 'one to one and one-half boxes', foods: [{ name: 'berries', prep: null }] },
        crfMeasure: '1 1 1/2 boxes',
        crfUnitIsEmpty: true,
        disposition: 'llmWins',
        why: 'the same fractional shape on a different food — 2 of the 8 are this line',
    },
    {
        id: 'L01724',
        line: 'six or eight tablespoons of cold water',
        model: { measure: 'six or eight tablespoons', foods: [{ name: 'cold water', prep: null }] },
        crfMeasure: '6 8 tablespoons',
        crfUnitIsEmpty: true,
        disposition: 'llmWins',
        why: 'larger numbers, same shape — the repair must not be about the particular digits',
    },
    {
        id: 'L02100',
        line: 'two or three tablespoons of rum',
        model: { measure: 'two or three tablespoons', foods: [{ name: 'rum', prep: null }] },
        crfMeasure: '2 3 tablespoons',
        crfUnitIsEmpty: true,
        disposition: 'llmWins',
        why: 'the exemplar §14.6 and ADR-0026 §8a both quote',
    },
    {
        // ⛔ THE ROW THAT DOES NOT MOVE, and the reason the report says 7 rather than 8.
        id: 'L00777',
        line: 'a quart of spinach about fifteen minutes',
        model: { measure: 'a quart', foods: [{ name: 'spinach', prep: null }] },
        crfMeasure: 'quart 15',
        crfUnitIsEmpty: false,
        disposition: 'crfWins',
        why: 'a REAL unit joined to a stray amount (`quart 15`) — a different reader mismatch, still open',
    },
];

describeIfInstalled('U37 — a joined CRF amount, against the real CRF engine', () => {
    it('folds the joined measure to NO unit, and the census and the merge then agree on all but L00777', async () => {
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

            return {
                id: entry.id,
                why: entry.why,
                crfMeasure: crf.measure,
                crfUnitIsEmpty: normalizeMeasure(crf.measure).unit === '',
                // The CENSUS path — the comparison harness.
                disposition: disposeAgreement(compareParses(entry.model, crf).kind),
                // ⛔ Every one of the 8 is a line the MERGE rescues. That is what made the census's
                // `crfWins` a divergence rather than a disagreement, so it is asserted rather than assumed.
                mergeRescued: merged.merged?.provenance.unit === 'llm',
            };
        });

        expect(observed, 'the real engine no longer produces the readings §14.6 was measured on').toStrictEqual(
            CASES.map((entry) => ({
                id: entry.id,
                why: entry.why,
                crfMeasure: entry.crfMeasure,
                crfUnitIsEmpty: entry.crfUnitIsEmpty,
                disposition: entry.disposition,
                mergeRescued: true,
            })),
        );
    }, 300_000);

    it('⛔ leaves a measure the CRF read WHOLE completely alone — the anti-over-reach half', async () => {
        // Stated separately because the table above contains only lines that were already broken. A repair
        // that rejected units more eagerly — or that skipped past the joined number to the next word —
        // would pass every row up there and destroy the ordinary corpus, which is 1,289 ingredient lines
        // wide. These are the shapes it must not touch.
        const intact = [
            { line: '2 tablespoons olive oil', unit: 'tablespoon', quantity: '2' },
            { line: 'one and one-half cups of flour', unit: 'cup', quantity: '3/2' },
            { line: 'one-half pound chocolate', unit: 'lb', quantity: '1/2' },
        ] as const;

        const parses = await parseLinesWithCrf(intact.map((entry) => entry.line));

        expect(parses).toHaveLength(intact.length);
        expect(
            parses.map((parse) => {
                const folded = normalizeMeasure(parse.measure);

                return { unit: folded.unit, quantity: folded.quantity };
            }),
            'the repair reached a measure the CRF read as ONE amount',
        ).toStrictEqual(intact.map((entry) => ({ unit: entry.unit, quantity: entry.quantity })));
    }, 300_000);
});
