/**
 * Integration tier — THE BAKE-OFF'S PRECONDITIONS, AGAINST THE REAL 1919 BOOK.
 *
 * | Requirement | Test |
 * | ----------- | ---- |
 * | The headline metric has something to measure | "vessels really do reach the engines" |
 * | The owner's exemplar still exists | "the mixing-bowl line" |
 * | The detector does not fire on the corpus's own foods | "no accepted ingredient line is a vessel" |
 * | Every arm sends the same corpus line, byte for byte | "the three arms differ only in the system prompt" |
 *
 * ## ⛔ WHAT THIS TIER PROVES THAT THE UNIT TIER STRUCTURALLY CANNOT
 *
 * The unit tier proves the classifier answers correctly for names I chose. It cannot prove the thing the
 * whole experiment rests on: **that the corpus the arms are run over still contains the failure they are
 * being compared on.** §13's vessel-position ruling changed what the extractor accepts, and if it had also
 * removed every vessel-bearing line, all three arms would score a flawless 0% on the headline and the run
 * would read as three ties. That would be a fact about the corpus reported as a fact about three prompts.
 *
 * ⚠️ It also pins the ONE thing that would make the arms incomparable without failing anything else: the
 * user turn. `buildVariantPrompt` derives it from `buildParsePrompt`, so the delimiter has a single
 * authority — but only a run over real lines shows that holds for text with quotes, parentheses and
 * hyphenated 1900s spellings rather than for the two phrases a unit test invents.
 *
 * ⛔ NO MODEL IS CALLED. ADR-0024's reservation guards the worker, not a test, and a test that spends money
 * is a test nobody runs. Everything here is the corpus, the lexicon and the prompt assembly.
 *
 * Skipped (not failed) when `COOKBOOK_IMPORT_BOOK` is unset — the same guard, for the same reason, as
 * `parseOracle.integration.test.ts`. The book is not in this repository and must not be (ADR-0023).
 */
import { existsSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { COOKBOOKS, assertPublicDomain } from '../src/cookbooks.js';
import { segmentCookbook, stripGutenbergBoilerplate } from '../src/gutenbergBook.adapter.js';
import { classifyFoodName } from '../src/parseComparison/nonFoodInFoods.js';
import { buildParseCorpus, harvestSourceTexts } from '../src/parseComparison/parseCorpus.js';
import { PARSE_VARIANT_IDS, buildVariantPrompt, resolveParseVariant } from '../src/parseComparison/promptVariant.js';
import { toCandidateRecipe } from '../src/proseRecipe.js';

const BOOK_PATH = process.env['COOKBOOK_IMPORT_BOOK'];
const canRun = BOOK_PATH !== undefined && BOOK_PATH !== '' && existsSync(BOOK_PATH);
const describeIfRunnable = canRun ? describe : describe.skip;

/** The corpus, rebuilt from the book exactly as the comparison runner builds it. */
function buildCorpus(): ReturnType<typeof buildParseCorpus> {
    const raw = readFileSync(BOOK_PATH ?? '', 'utf8');
    const book = COOKBOOKS['international-jewish'];

    assertPublicDomain(raw, book);

    const outcomes = segmentCookbook(stripGutenbergBoilerplate(raw)).map((block) => toCandidateRecipe(block, book));

    return buildParseCorpus(harvestSourceTexts(outcomes).clauses);
}

/**
 * The corpus, built ONCE and only when a test actually asks for it.
 *
 * ⛔ LAZY. `describe.skip` still EXECUTES its callback to collect the tests it is about to skip, so building
 * the corpus in the suite body reads the book even when the guard said not to — and the guard that exists
 * to skip this file then fails the whole `test:integration` run with `ENOENT: open ''`. That defect is
 * recorded in `parseOracle.integration.test.ts` and is not re-committed here.
 *
 * @returns The rebuilt corpus, memoized for the file.
 * @sideEffect Reads `COOKBOOK_IMPORT_BOOK` from the filesystem on first call.
 */
const corpusOnce = (() => {
    let built: ReturnType<typeof buildParseCorpus> | undefined;

    return (): ReturnType<typeof buildParseCorpus> => (built ??= buildCorpus());
})();

describeIfRunnable('the corpus the three arms are compared on', () => {
    it('is not empty and not degenerate', () => {
        // ⛔ Anti-vacuity at the source. Every assertion below is about a subset of this.
        const corpus = corpusOnce();

        expect(corpus.length).toBeGreaterThan(1_000);
        expect(corpus.filter((line) => line.origin === 'ingredient').length).toBeGreaterThan(100);
        expect(corpus.filter((line) => line.origin === 'dropped').length).toBeGreaterThan(100);
    });

    it('STILL CONTAINS the owner’s exemplar, so the failure being measured is reachable', () => {
        // ⚠️ §13's vessel-position ruling moved this line out of the accepted `ingredient` half — it is a
        // `dropped` clause now — but it is still SUBMITTED, because the runner sends both halves. Had the
        // ruling removed it from the corpus entirely, all three arms would score 0 on the headline for a
        // reason that has nothing to do with any prompt.
        const exemplar = corpusOnce().find((line) => line.text === 'In a large mixing bowl whip to a cream two eggs');

        expect(exemplar).toBeDefined();
        expect(exemplar?.origin).toBe('dropped');
    });

    it('carries enough vessel-bearing lines for the headline to have a range at all', () => {
        // ⛔ A metric whose numerator can only ever be ~0 is not a measurement. This asserts the OPPORTUNITY
        // exists — how often a model TAKES it is what the billed run measures.
        const vesselLines = corpusOnce().filter((line) => classifyFoodName(line.text) === 'vessel');

        expect(vesselLines.length).toBeGreaterThan(20);
    });

    it('does NOT let the detector fire on the accepted half’s own text wholesale', () => {
        // ⚠️ The direction that would ruin the metric silently. If a large share of real ingredient lines
        // already read as vessels, a model that echoed the line back would score badly for being right.
        const ingredientLines = corpusOnce().filter((line) => line.origin === 'ingredient');
        const flagged = ingredientLines.filter((line) => classifyFoodName(line.text) !== undefined);

        expect(flagged.length / ingredientLines.length).toBeLessThan(0.05);
    });
});

describeIfRunnable('every arm sends the same line', () => {
    it('differs ONLY in the system prompt, over every line the run submits', () => {
        const corpus = corpusOnce();
        const arms = PARSE_VARIANT_IDS.map(resolveParseVariant);
        const divergent = corpus.filter((line) => {
            const userMessages = new Set(arms.map((arm) => buildVariantPrompt(arm, line.text).userMessage));

            return userMessages.size !== 1;
        });

        // ⛔ One authority for the delimiter. A locally re-spelled tag in any arm would make that arm's whole
        // column incomparable while every unit test still passed.
        expect(divergent).toEqual([]);
    });

    it('accepts every real corpus line without tripping the input cap on the longest arm', () => {
        // ⚠️ v3's system prompt is the longest, so it is the arm the 2,000-character cap binds first. A line
        // that v1 accepts and v3 refuses would be a silent hole in one column of the comparison.
        const v3 = resolveParseVariant('v3');
        const refused = corpusOnce().filter((line) => {
            try {
                buildVariantPrompt(v3, line.text);

                return false;
            } catch {
                return true;
            }
        });

        expect(refused).toEqual([]);
    });
});
