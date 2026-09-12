/**
 * Integration tier for the 2026-08-25 ruling: an ABSENT CRF unit is absence, not dissent.
 *
 * ## ⛔ WHAT ONLY THIS TIER CAN PROVE
 *
 * `parseAgreement.test.ts` states the ruling against CRF rows written into the file. Those rows are
 * measured, but a fixture cannot notice that the engine moved — and the whole ruling rests on ONE empirical
 * claim about a third-party model we neither own nor pin beyond a version string:
 *
 * > every mis-read `<number> and a <fraction> <unit>` line comes back with an EMPTY unit, and every line
 * > the CRF reads correctly comes back with a populated one.
 *
 * If `ingredient-parser-nlp` ever starts emitting a unit for `one and a half quarts`, the discriminator
 * stops discriminating and the new verdict quietly stops firing while every unit test still passes. So this
 * tier drives the REAL Python engine over the REAL sidecar and asserts the classification end to end,
 * against the engine's own output rather than a transcription of it.
 *
 * ⚠️ The model half is still ours to write: no Bedrock call is billed by a test (ADR-0024 guards none), so
 * the LLM reading of each line is stated here as the reading the source plainly states — `1.5 quarts` for
 * `one and a half quarts`. That is the oracle's own R7 arithmetic, not a second engine, and it is the only
 * part of this tier that is not measured.
 *
 * Skipped (not failed) when `python3 -c "import ingredient_parser"` does not succeed — the same guard
 * `crfParse.integration.test.ts` uses, for the same reason.
 */
import { execFileSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import { parseLinesWithCrf } from '../src/parseComparison/crfProcess.js';
import { compareParses, disposeAgreement } from '../src/parseComparison/parseAgreement.js';
import type { AgreementDisposition, MeasureVerdict } from '../src/parseComparison/parseAgreement.js';
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

/** One line, the reading the source plainly states, and what the ruling says the pair amounts to. */
interface RulingCase {
    /** The ingredient line, handed to the real engine verbatim. */
    readonly line: string;
    /** The reading the line's own words state — R7 arithmetic, stated rather than parsed. */
    readonly model: ModelParse;
    /** Whether the CRF's normalized unit is expected to be empty. The discriminator, asserted directly. */
    readonly crfUnitIsEmpty: boolean;
    readonly measure: MeasureVerdict;
    readonly disposition: AgreementDisposition;
    /** Why this row is in the table, so a failure reports an argument rather than a diff. */
    readonly why: string;
}

const CASES: readonly RulingCase[] = [
    {
        line: 'one and a half quarts of boiling water',
        model: { measure: 'one and a half quarts', foods: [{ name: 'water', prep: 'boiling' }] },
        crfUnitIsEmpty: true,
        measure: 'crfUnitAbsent',
        disposition: 'llmWins',
        why: 'the corpus line the ruling was found on (9 occurrences; oracle seed L00177)',
    },
    {
        line: 'one and a quarter cups of milk',
        model: { measure: 'one and a quarter cups', foods: [{ name: 'milk', prep: null }] },
        crfUnitIsEmpty: true,
        measure: 'crfUnitAbsent',
        disposition: 'llmWins',
        why: 'the shape is the empty unit, not the particular fraction',
    },
    {
        line: 'two and a half pounds of beef',
        model: { measure: 'two and a half pounds', foods: [{ name: 'beef', prep: null }] },
        crfUnitIsEmpty: true,
        measure: 'crfUnitInName',
        disposition: 'llmWins',
        why: 'the unit is absent AND in the name, so the more specific shape must keep the row',
    },
    {
        line: 'one and a half cups of sugar',
        model: { measure: 'one and a half cups', foods: [{ name: 'sugar', prep: null }] },
        crfUnitIsEmpty: false,
        measure: 'quantityDiffers',
        disposition: 'crfWins',
        why: 'the SPLIT-AMOUNT spelling: the CRF states a unit, so it dissented rather than fell silent',
    },
    {
        line: 'one and one-half cups of flour',
        model: { measure: 'one and one-half cups', foods: [{ name: 'flour', prep: null }] },
        crfUnitIsEmpty: false,
        measure: 'agree',
        disposition: 'agreed',
        why: 'the same composite, spelled the way the CRF understands — the rule must not reach it',
    },
    {
        line: 'one-half pound chocolate',
        model: { measure: 'one-half pound', foods: [{ name: 'chocolate', prep: null }] },
        crfUnitIsEmpty: false,
        measure: 'agree',
        disposition: 'agreed',
        why: 'a plain fraction the CRF reads correctly — the second half of the narrowness proof',
    },
    {
        line: 'one gill of milk',
        model: { measure: 'one gill', foods: [{ name: 'milk', prep: null }] },
        crfUnitIsEmpty: true,
        measure: 'crfUnitInName',
        disposition: 'llmWins',
        why: 'KTD-11’s original historical-unit shape must not be re-labelled by the new verdict',
    },
    {
        line: '2 tablespoons olive oil',
        model: { measure: '2 tablespoons', foods: [{ name: 'olive oil', prep: null }] },
        crfUnitIsEmpty: false,
        measure: 'agree',
        disposition: 'agreed',
        why: 'the ordinary modern line — anti-vacuity for the whole table',
    },
    {
        // ⛔ THE ANTI-OVER-REACH ROW, and the only one whose MODEL reading is deliberately wrong. Every
        // other row states what the source states; this one states a unit the source does not, because
        // what has to be exercised is a pair where BOTH engines named a unit and named different ones —
        // KTD-11's `unitDiffers`, 81 lines of it in the measured corpus. Without this row a mutant that
        // widened the new verdict to "the units differ at all" passes this whole tier.
        line: 'one-half pound chocolate',
        model: { measure: 'one-half cup', foods: [{ name: 'chocolate', prep: null }] },
        crfUnitIsEmpty: false,
        measure: 'unitDiffers',
        disposition: 'crfWins',
        why: 'anti-over-reach: two stated units that differ is dissent, and KTD-11 still governs it',
    },
    {
        // The MIRROR of the ruling: the CRF answered and the model fell silent. Left on `unitDiffers`,
        // where `crfWins` already hands the unit to the engine that spoke.
        line: '2 tablespoons olive oil',
        model: { measure: '2', foods: [{ name: 'olive oil', prep: null }] },
        crfUnitIsEmpty: false,
        measure: 'unitDiffers',
        disposition: 'crfWins',
        why: 'the mirror direction — a silent MODEL against a CRF that answered is still dissent',
    },
];

describeIfInstalled('the ABSENT-unit ruling against the real CRF engine', () => {
    it('classifies and disposes of every measured line exactly as the ruling says', async () => {
        const parses = await parseLinesWithCrf(CASES.map((entry) => entry.line));

        // ⛔ Anti-vacuity BEFORE the invariant. A run that returned nothing would make every `forEach`
        // assertion below trivially true, which is precisely how a suite comes to prove nothing at all.
        expect(parses).toHaveLength(CASES.length);

        const observed = CASES.map((entry, index) => {
            const crf = parses[index];

            if (crf === undefined) {
                throw new Error(`the CRF returned no row for "${entry.line}"`);
            }

            expect(crf.sentence, 'the sidecar echoed a different line back').toBe(entry.line);

            const agreement = compareParses(entry.model, crf);

            return {
                line: entry.line,
                why: entry.why,
                crfUnitIsEmpty: normalizeMeasure(crf.measure).unit === '',
                measure: agreement.measure,
                disposition: disposeAgreement(agreement.kind),
            };
        });

        expect(observed, 'the real engine no longer produces the readings this ruling was measured on').toStrictEqual(
            CASES.map((entry) => ({
                line: entry.line,
                why: entry.why,
                crfUnitIsEmpty: entry.crfUnitIsEmpty,
                measure: entry.measure,
                disposition: entry.disposition,
            })),
        );
    }, 300_000);

    it('⛔ holds the DISCRIMINATOR the whole ruling rests on: empty unit iff the CRF mis-read the composite', async () => {
        // Stated as its own assertion rather than folded into the table above, because it is the claim a
        // future engine upgrade is most likely to break — and breaking it would silently stop the new
        // verdict firing while every other test in this repository stayed green.
        const composites = [
            'one and a half quarts of boiling water',
            'one and a quarter cups of milk',
            'two and a half pounds of beef',
        ];
        const understood = ['one and one-half cups of flour', 'one-half pound chocolate', '2 tablespoons olive oil'];
        const parses = await parseLinesWithCrf([...composites, ...understood]);
        const units = parses.map((parse) => normalizeMeasure(parse.measure).unit);

        expect(units).toHaveLength(composites.length + understood.length);
        expect(units.slice(0, composites.length), 'a mis-read composite no longer comes back unit-less').toEqual(
            composites.map(() => ''),
        );
        expect(
            units.slice(composites.length).filter((unit) => unit === ''),
            'a line the CRF reads correctly came back with NO unit — the discriminator has collapsed',
        ).toEqual([]);
    }, 300_000);
});
