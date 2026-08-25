/**
 * Integration tier for the ORACLE — the real extractor over the real book, and the real CRF engine.
 *
 * ## ⛔ WHAT ONLY THIS TIER CAN PROVE
 *
 * The unit tier proves the oracle is well-formed: every ruling cites a clause, every clause cites a source,
 * no regime is empty. It structurally CANNOT prove the thing that makes the census mean anything — that the
 * lines in it are the lines the pipeline actually produces. A fixture full of plausible 1919 prose typed by
 * hand would pass every unit assertion while describing a corpus that does not exist, which is precisely the
 * failure the plan warns about: _"Read the actual lines of any generated corpus before believing any rate
 * computed from it."_
 *
 * So this tier rebuilds the corpus from the book and asserts each seed resolves to the case's line
 * **byte-identical**, then runs the pinned CRF over those lines and REPORTS how often it disagrees with the
 * oracle.
 *
 * ## ⛔ THE RATE IS REPORTED, NEVER ASSERTED TO A THRESHOLD
 *
 * The plan is explicit, and the reason is worth keeping: _"A threshold turns a measurement into a tripwire
 * that future work will tune rather than fix."_ A CRF that got worse should show up as a bigger number in a
 * report a human reads, not as a red test somebody edits the bound of.
 *
 * ## ⚠️ WHAT IS MEASURED HERE IS HALF THE QUESTION
 *
 * Only the CRF leg runs. The LLM leg needs billed Bedrock and no ADR-0024 reservation guards a test, so the
 * engine-vs-engine disagreement this oracle was built to adjudicate is UNMEASURED — see the fixture's module
 * docstring and the comparison report's §10.
 *
 * Skipped (not failed) when `COOKBOOK_IMPORT_BOOK` is unset or the CRF is not installed — the same guard
 * `crfParse.integration.test.ts` uses, for the same reason.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { COOKBOOKS, assertPublicDomain } from '../src/cookbooks.js';
import { segmentCookbook, stripGutenbergBoilerplate } from '../src/gutenbergBook.adapter.js';
import { parseLinesWithCrf } from '../src/parseComparison/crfProcess.js';
import { buildParseCorpus, harvestSourceTexts } from '../src/parseComparison/parseCorpus.js';
import { normalizeName, normalizePrep } from '../src/parseComparison/parseNormalization.js';
import { toCandidateRecipe } from '../src/proseRecipe.js';
import {
    ORACLE_REGIMES,
    PARSE_ORACLE,
    isRuledOracleCase,
    oracleLineCoverage,
    oracleRegimeCensus,
} from './__fixtures__/parseOracle.js';

const BOOK_PATH = process.env['COOKBOOK_IMPORT_BOOK'];

function crfIsInstalled(): boolean {
    try {
        execFileSync('python3', ['-c', 'import ingredient_parser'], { stdio: 'ignore' });

        return true;
    } catch {
        return false;
    }
}

const canRun = BOOK_PATH !== undefined && BOOK_PATH !== '' && existsSync(BOOK_PATH) && crfIsInstalled();
const describeIfRunnable = canRun ? describe : describe.skip;

/** The corpus, rebuilt from the book exactly as the comparison runner builds it. */
function buildCorpus(): ReturnType<typeof buildParseCorpus> {
    const raw = readFileSync(BOOK_PATH ?? '', 'utf8');
    const book = COOKBOOKS['international-jewish'];

    assertPublicDomain(raw, book);

    const outcomes = segmentCookbook(stripGutenbergBoilerplate(raw)).map((block) => toCandidateRecipe(block, book));

    return buildParseCorpus(harvestSourceTexts(outcomes).clauses);
}

describeIfRunnable('the oracle census against the real corpus', () => {
    const corpus = buildCorpus();
    const byId = new Map(corpus.map((line) => [line.id, line]));
    const ingredientLines = corpus.filter((line) => line.origin === 'ingredient');

    it('is denominated in a corpus that is not empty and not degenerate', () => {
        // ⛔ Anti-vacuity at the source. Every rate below divides by this; a corpus that came back empty
        // would make every comparison trivially agree and every count trivially zero.
        expect(
            ingredientLines.length,
            `the extractor produced ${ingredientLines.length} ingredient lines`,
        ).toBeGreaterThan(100);
    });

    it('resolves every seed to a line the extractor really produces', () => {
        const missing = PARSE_ORACLE.filter((entry) => !byId.has(entry.seed));

        expect(
            missing.map((entry) => entry.seed),
            'seeds naming no corpus line — the extractor changed and the census is owed a re-run',
        ).toEqual([]);
    });

    it('quotes each seeded line BYTE-IDENTICALLY, so no case is prose somebody typed', () => {
        const drifted = PARSE_ORACLE.filter((entry) => byId.get(entry.seed)?.text !== entry.line).map((entry) => ({
            seed: entry.seed,
            fixture: entry.line,
            corpus: byId.get(entry.seed)?.text,
        }));

        expect(drifted, 'cases whose quoted line is not the corpus line at that seed').toEqual([]);
    });

    it('draws every case from the INGREDIENT half, never the dropped half', () => {
        // The dropped half is mostly not ingredient lines at all ("See that you have a good fire"), and
        // `parseCorpus.ts` is explicit that a rate blended across both halves describes a population nobody
        // meant to ask about.
        const wrongHalf = PARSE_ORACLE.filter((entry) => byId.get(entry.seed)?.origin !== 'ingredient');

        expect(
            wrongHalf.map((entry) => entry.seed),
            'cases drawn from the dropped half',
        ).toEqual([]);
    });

    it('stands for no more corpus lines than the corpus holds', () => {
        // A cheap consistency check on `occurrences`: the census counts SITUATIONS, and one line can carry
        // several, so the sum may exceed the line count — but not by an order of magnitude, and it must
        // never exceed what a plausible multiple of the ingredient half could produce.
        const coverage = oracleLineCoverage(PARSE_ORACLE);

        expect(
            coverage,
            `census stands for ${coverage} occurrences over ${ingredientLines.length} lines`,
        ).toBeGreaterThan(0);
        expect(coverage).toBeLessThanOrEqual(ingredientLines.length * ORACLE_REGIMES.length);
    });

    it('⛔ finds a REAL corpus line for every regime it claims to cover', () => {
        // The unit tier asserts the FIXTURE covers every regime. This asserts the fixture's regime labels
        // are attached to lines that exist — a regime whose only case had drifted out of the corpus would
        // otherwise still count.
        const census = oracleRegimeCensus(PARSE_ORACLE.filter((entry) => byId.has(entry.seed)));
        const empty = ORACLE_REGIMES.filter((regime) => census[regime] === 0);

        expect(
            empty,
            `regimes with no SURVIVING corpus line: ${empty.join(', ') || '(none)'} — counted ${JSON.stringify(census)}`,
        ).toEqual([]);
    });
});

describeIfRunnable('the CRF against the oracle — measured, not asserted', () => {
    it('reports how often the real CRF disagrees with the rubric on identity and placement', async () => {
        const corpus = buildCorpus();
        const byId = new Map(corpus.map((line) => [line.id, line]));
        const ruled = PARSE_ORACLE.filter(isRuledOracleCase).filter((entry) => byId.has(entry.seed));

        expect(ruled.length, 'no ruled case survived into the corpus — nothing was compared').toBeGreaterThan(0);

        const parses = await parseLinesWithCrf(ruled.map((entry) => byId.get(entry.seed)?.text ?? ''));
        const disagreements: string[] = [];

        ruled.forEach((entry, index) => {
            const crf = parses[index];

            if (crf === undefined) {
                return;
            }

            // Folded through the module that owns WHAT COUNTS AS A DIFFERENCE, so this tier cannot invent a
            // second answer to that question.
            const crfNames = new Set(crf.names.map(normalizeName).filter((name) => name !== ''));
            const oracleNames = new Set(
                entry.verdict.reading.foods.map((food) => normalizeName(food.name)).filter((name) => name !== ''),
            );
            const crfPrep = normalizePrep(crf.preparation);
            const oraclePreps = entry.verdict.reading.foods
                .map((food) => normalizePrep(food.prep ?? ''))
                .filter((prep) => prep !== '');

            const namesAgree =
                crfNames.size === oracleNames.size && [...crfNames].every((name) => oracleNames.has(name));
            const prepAgrees =
                crfPrep === '' ? oraclePreps.length === 0 : oraclePreps.length === 1 && oraclePreps[0] === crfPrep;

            if (!namesAgree || !prepAgrees) {
                disagreements.push(entry.seed);
            }
        });

        const rate = (disagreements.length / ruled.length) * 100;

        // ⛔ REPORTED, not thresholded. The only assertion is that the measurement HAPPENED over a non-empty
        // population — a rate computed over zero comparisons is the failure mode this suite exists to make
        // impossible, not a perfect score.
        //
        // ⛔⛔ AND THE DENOMINATOR IS SELECTED, WHICH IS PRINTED BESIDE THE RATE ON PURPOSE. The census is
        // the set of situations where the rubric FIRES against the CRF's reading, so a rate near 100% is
        // what a correct oracle produces here and says nothing about the CRF's accuracy over the corpus. A
        // reader who quotes this figure as "the CRF is wrong 98% of the time" has quoted a tautology. The
        // unselected figure — how much of the whole ingredient half carries a rubric-decidable CRF defect —
        // is in the comparison report's §10, and is NOT computed here because it needs
        // `recipe-import-core`'s `modifierLexicon`, which that package deliberately keeps off its barrel.
        process.stdout.write(
            `\n[U23 oracle] CRF disagrees with the rubric on ${disagreements.length} of ${ruled.length} ` +
                `ruled cases (${rate.toFixed(2)}%), standing for ` +
                `${oracleLineCoverage(ruled)} corpus occurrences.\n` +
                `[U23 oracle] ⛔ SELECTED DENOMINATOR — these cases were CHOSEN because the rubric fires on ` +
                `them. This is not a CRF accuracy rate. See report 002 §10.\n` +
                `[U23 oracle] disagreeing seeds: ${disagreements.join(' ') || '(none)'}\n` +
                `[U23 oracle] ⚠️ CRF leg only. The LLM leg is UNMEASURED — see the fixture docstring.\n`,
        );

        expect(Number.isFinite(rate)).toBe(true);
    }, 300_000);
});
