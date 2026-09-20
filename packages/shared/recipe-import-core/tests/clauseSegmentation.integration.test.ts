/**
 * Integration tier — the clause SEGMENTER over a committed slice of REAL 1919 cookbook prose.
 *
 * | Requirement | Test |
 * | ----------- | ---- |
 * | U22a — instruction residue is cut off the span handed to a parse engine | "bounds real spans" |
 * | U22a — a tail that names a food is never cut | "never cuts away a stated food" |
 * | R29 — a boundary inside a quantity phrase is not a boundary | "never cuts inside a quantity phrase" |
 * | HAZ-041 — a mis-parsed line never discards the original | "emits only text the book printed" |
 *
 * ## ⛔ WHY THIS FILE WAS REWRITTEN — a property test may not recompute its subject's own predicate
 *
 * The first version asserted, over every cut tail, that
 * `quantity !== absent && unit !== null && name !== ''` was false. That is `statesASecondFood`'s own
 * predicate, re-typed — so it was green **by construction** for any definition of the guard, correct or
 * not, including the one that deleted `two eggs` from `one cup of milk with two eggs`. It claimed in its
 * own docstring to be "the property that makes U22a safe rather than value-corrupting" while being
 * incapable of failing. That is the mutation-lens failure exactly: it would still have passed if the code
 * were broken, and the code WAS broken.
 *
 * The oracle here is independent of the implementation: a cut tail may not contain a **quantity phrase
 * followed by a noun that is not a vessel, a duration or a dimension** — expressed with `parse-ingredient`
 * and a literal word list written out below, never by calling back into the lexicon the guard consults.
 * If the guard and this list disagree, one of them is wrong and the suite says so.
 *
 * ## What this tier proves that the unit tier structurally cannot
 *
 * 1. The REAL `parse-ingredient` runs over text nobody wrote for a test. A unit test picks its tails;
 *    this one takes every tail the corpus produces.
 * 2. The rate is observable. KTD-11 rules that "a flag that fires on half of everything is how a real
 *    signal gets muted", and `instruction_text_dropped` is a new flag.
 * 3. Totality over a whole corpus. A segmenter that throws on one span in two thousand takes the import
 *    down, and only real text has that span in it.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { findQuantityPhrases, parseIngredientLine, segmentClause } from '../src/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CORPUS_MARKER = '--- CORPUS BEGINS ---';

/** The corpus slice with its provenance block stripped. Everything after the marker is verbatim source. */
function readCorpus(): string {
    const file = readFileSync(join(HERE, '__fixtures__', 'internationalJewishCookBook.txt'), 'utf8');
    const body = file.split(CORPUS_MARKER)[1];

    if (body === undefined) {
        throw new Error(`Corpus fixture is missing its "${CORPUS_MARKER}" marker.`);
    }

    return body.replace(/\r\n/g, '\n');
}

/** `cookbook-import`'s `CLAUSE_SPLIT`, restated once here because that module is downstream of this one. */
const CLAUSE_SPLIT = /[;.]|,\s*(?:and\s+)?|\s+and\s+(?:then\s+)?/g;

/**
 * Split the corpus into clauses the way `splitClauses` does — INCLUDING R29's guard.
 *
 * ⛔ The guard is not optional here, and leaving it out is what made the R29 property below vacuous in the
 * first version of this file: an unguarded split breaks `one and one-half` in half at the corpus level, so
 * no span reaching the segmenter ever contained the compound the property is about. The suite then proved
 * that the segmenter does not cut inside quantity phrases that were not there.
 */
function splitClauses(body: string): readonly string[] {
    const phrases = findQuantityPhrases(body);
    const clauses: string[] = [];
    let start = 0;

    for (const boundary of body.matchAll(CLAUSE_SPLIT)) {
        const at = boundary.index;

        if (phrases.some((phrase) => at >= phrase.start && at < phrase.end)) {
            continue;
        }

        clauses.push(body.slice(start, at));
        start = at + boundary[0].length;
    }

    clauses.push(body.slice(start));

    return clauses;
}

/** One span, with the clause text in front of it — exactly the pair `ingredientInClause` hands the segmenter. */
interface PositionedSpan {
    readonly span: string;
    readonly precededBy: string;
}

/**
 * Each unit of text, from each quantity phrase in it to its end — `trimmed.slice(at)` in `suffixStarts`'
 * terms — paired with `trimmed.slice(0, at)`, the clause text the position ruling reads.
 *
 * ⛔ The prefix is taken from the SAME slice as the span, so the pair is what the real caller produces. A
 * suite that passed `''` here would test the segmenter in a position no caller ever uses, and the 2026-08-26
 * ruling would be exercised only by the cases a unit test happened to imagine.
 */
function spansIn(units: readonly string[]): readonly PositionedSpan[] {
    return units
        .map((unit) => unit.replace(/\s+/g, ' ').trim())
        .filter((unit) => unit.length >= 3)
        .flatMap((unit) =>
            findQuantityPhrases(unit).map((phrase) => ({
                span: unit.slice(phrase.start),
                precededBy: unit.slice(0, phrase.start),
            })),
        );
}

/**
 * Every span the segmenter must answer for, from TWO derivations of the same corpus.
 *
 * ⛔ The second derivation is not padding — it is the only one that exercises the safety guard at all.
 * `splitClauses` already breaks on ` and ` and `,`, so a clause-level span's tail almost never carries a
 * second food: measured on this slice, **zero** of the six clause-level cuts produce a tail containing a
 * quantity phrase, which would leave "never cuts away a stated food" looping over nothing and passing
 * vacuously — the same defect, by a different route, as the tautology this file was rewritten to remove.
 *
 * Splitting only on hard stops keeps `three eggs unbeaten, and stir vigorously for five minutes` whole. It
 * is also the CONTRACT case: `segmentClause` is a barrel export, and U22's `parsePipeline` will hand it
 * spans that nothing pre-split on ` and `.
 */
function everySpan(): readonly PositionedSpan[] {
    const corpus = readCorpus();

    return [...spansIn(splitClauses(corpus)), ...spansIn(corpus.split(/[;.]/))];
}

const POSITIONED = everySpan();
const SPANS = POSITIONED.map(({ span }) => span);
const SEGMENTS = POSITIONED.map(({ span, precededBy }) => ({ span, segment: segmentClause(span, precededBy) }));
const BOUNDED = SEGMENTS.flatMap(({ span, segment }) =>
    segment.kind === 'ingredient' && segment.trailingInstruction !== null
        ? [{ input: span, head: segment.span, tail: segment.trailingInstruction }]
        : [],
);

/**
 * The VESSEL half of {@link NOT_A_FOOD_NOUN}, written out separately because the position ruling is about
 * vessels only. A DURATION (`an hour`) is residue by a different rule entirely — it is never a measuring
 * vessel, so moving it behind a preposition changes nothing and asserting that it does would be wrong.
 */
const ORACLE_VESSELS: ReadonlySet<string> = new Set([
    'bowl',
    'bowls',
    'dish',
    'dishes',
    'jar',
    'jars',
    'kettle',
    'kettles',
    'mould',
    'moulds',
    'oven',
    'pan',
    'pans',
    'platter',
    'pot',
    'pots',
    'saucepan',
    'skillet',
    'spider',
    'stove',
    'tin',
    'tins',
]);

/** The prepositions the segmenter treats as governing, restated here so this file can DISAGREE with it. */
const GOVERNORS: ReadonlySet<string> = new Set([
    'in',
    'into',
    'with',
    'over',
    'for',
    'from',
    'through',
    'to',
    'on',
    'at',
]);

/**
 * ⛔ THE INDEPENDENT ORACLE — written out here, deliberately NOT imported from `notAFoodLexicon.ts`.
 *
 * Importing the guard's own vocabulary would restore the tautology this file was rewritten to remove: the
 * test would agree with the implementation by definition. A hand-written list can DISAGREE, which is the
 * only way a corpus test can catch a wrong classification. It is short because it only has to cover the
 * nouns this committed slice actually produces in a cut tail.
 */
const NOT_A_FOOD_NOUN: ReadonlySet<string> = new Set([
    'bowl',
    'bowls',
    'dish',
    'dishes',
    'hour',
    'hours',
    'inch',
    'inches',
    'jar',
    'jars',
    'kettle',
    'kettles',
    'minute',
    'minutes',
    'mould',
    'moulds',
    'oven',
    'pan',
    'pans',
    'platter',
    'pot',
    'pots',
    'saucepan',
    'skillet',
    'spider',
    'stove',
    'tin',
    'tins',
]);

/** The noun a phrase is about, for the oracle's own lookup. */
function finalNoun(text: string): string {
    return (text.trim().split(/\s+/).at(-1) ?? '').toLowerCase().replace(/[^\p{L}\p{N}-]/gu, '');
}

describe('segmentClause over real 1919 prose — anti-vacuity', () => {
    /**
     * ⛔ FIRST, BEFORE ANY PROPERTY. Every test below loops over a derived list, and a derived list that
     * silently comes back empty makes all of them pass while proving nothing. Each regime the file claims
     * to exercise is asserted PRESENT, including the compound-quantity regime whose absence made the R29
     * property vacuous before.
     */
    it('derives a real corpus covering every regime the properties below need', () => {
        expect(SPANS.length).toBeGreaterThan(50);
        expect(BOUNDED.length).toBeGreaterThan(5);
        expect(
            SEGMENTS.some(({ segment }) => segment.kind === 'ingredient' && segment.trailingInstruction === null),
        ).toBe(true);
        expect(SEGMENTS.some(({ segment }) => segment.kind === 'instruction')).toBe(true);

        // ⛔ The R29 regime. A COMPOUND quantity phrase — one containing its own internal `and`, e.g.
        // "one and one-half" — must actually reach the segmenter, or "never cuts inside a quantity
        // phrase" is a statement about spans that do not exist.
        const compounds = SPANS.filter((span) =>
            findQuantityPhrases(span).some((phrase) => /\sand\s/.test(span.slice(phrase.start, phrase.end))),
        );

        expect(compounds.length).toBeGreaterThan(0);

        // ⛔ The POSITION regime (owner ruling 2026-08-26). A span whose clause governs it with a
        // preposition must actually occur, or every case about what a governed vessel means is a statement
        // about spans this corpus does not contain — the same vacuity that made R29 green for nothing.
        const governed = POSITIONED.filter(({ precededBy }) =>
            GOVERNORS.has((precededBy.trim().split(/\s+/).at(-1) ?? '').toLowerCase()),
        );

        expect(governed.length).toBeGreaterThan(0);

        // ⛔ And the regime must actually BITE. A governed span that no vessel measures leaves the position
        // test a no-op over this corpus, so every case below would be a statement about the head-final
        // rule wearing the position rule's name. What is asserted is a span the position test refuses and
        // the head-final rule would NOT have — the only evidence that rule (b) does anything here at all.
        const refusedOnlyByPosition = governed.filter(
            ({ span, precededBy }) =>
                segmentClause(span, precededBy).kind === 'instruction' && segmentClause(span, '').kind === 'ingredient',
        );

        expect(refusedOnlyByPosition.length).toBeGreaterThan(0);
    });

    /**
     * ⚠️ Reported, not asserted to a tuned threshold — the plan's discipline for the comparison harness.
     * The bound is loose and one-sided: it fails only if the flag has become what KTD-11 warns about.
     */
    it('bounds a minority of spans, so the review flag stays a signal', () => {
        const rate = BOUNDED.length / SPANS.length;

        expect(rate).toBeGreaterThan(0);
        expect(rate).toBeLessThan(0.5);
    });
});

describe('segmentClause over real 1919 prose — what it may never do', () => {
    /**
     * ⛔ HAZ-041, applied to segmentation: a mis-parsed line must never discard the original. This module
     * may only ever REMOVE a suffix. If a span could come back rewritten, reordered or re-spelled, the
     * text persisted as `sourceLine` — the transcription U11's gate verifies our parse against — would be
     * a string we produced rather than one the book printed.
     */
    it('emits only text the book printed, as a prefix of what it was handed', () => {
        for (const { span, segment } of SEGMENTS) {
            if (segment.kind !== 'ingredient') {
                continue;
            }

            expect(span.trim().startsWith(segment.span), `${JSON.stringify(span)} -> ${segment.span}`).toBe(true);
        }
    });

    /** The tail is the other half of the same string: verbatim, at the end, nothing invented between. */
    it('reports a tail that is verbatim the end of the span it was cut from', () => {
        for (const { input, head, tail } of BOUNDED) {
            expect(input.trim().endsWith(tail), `${JSON.stringify(input)} -> ${JSON.stringify(tail)}`).toBe(true);
            expect(head.length + tail.length).toBeLessThanOrEqual(input.trim().length);
            expect(tail).not.toBe('');
        }
    });

    /**
     * ⛔ THE PROPERTY THAT MAKES U22a SAFE RATHER THAN VALUE-CORRUPTING, judged by {@link NOT_A_FOOD_NOUN}
     * rather than by the guard's own opinion. For every tail that was cut, every quantity phrase inside it
     * is re-read with the REAL parser: if what it measures is not a vessel, a duration or a dimension,
     * then a food with a stated amount was deleted from a recipe and this fails.
     */
    it('never cuts away a stated food, and actually judged at least one tail', () => {
        let judged = 0;

        for (const { input, tail } of BOUNDED) {
            for (const phrase of findQuantityPhrases(tail)) {
                const parsed = parseIngredientLine(tail.slice(phrase.start));

                if (parsed.quantity.kind === 'absent' || parsed.name.trim() === '') {
                    continue;
                }

                const noun = finalNoun(
                    parsed.name.split(/\s+(?:in|into|with|for|to|on|at|until|that|which)\s+/)[0] ?? '',
                );
                const unit = parsed.unit === null ? '' : parsed.unit.toLowerCase();

                judged += 1;

                expect(
                    NOT_A_FOOD_NOUN.has(noun) || NOT_A_FOOD_NOUN.has(unit),
                    `cut a food out of ${JSON.stringify(input)}: the tail ${JSON.stringify(tail)} states ` +
                        `${JSON.stringify(parsed.quantity)} of ${JSON.stringify(parsed.name)}`,
                ).toBe(true);
            }
        }

        // ⛔ THE ASSERTION THAT STOPS THIS PASSING ON NOTHING. A property test whose loop body never runs
        // is green and worthless, and this one measured ZERO executions before the corpus derivation was
        // widened. The count is asserted, not assumed.
        //
        // ⚠️ Honest limit: the committed slice exercises this THINLY — one tail. The unit tier carries the
        // adversarial cases (`with two eggs`, `in one cup of water`, `in a large frying-pan`); this tier's
        // job is to prove the property holds on text nobody wrote for a test, not to be the only place it
        // is tested.
        expect(judged).toBeGreaterThan(0);
    });

    /**
     * ⛔ R29 over real text, and the anti-vacuity block above proves the regime is present. `and` is in
     * the cut lexicon AND is the middle of "one and one-half". A head that ends mid-number is the
     * third-of-the-stated-amount defect the clause splitter already paid for once.
     */
    it('never cuts inside a quantity phrase', () => {
        for (const { input, head } of BOUNDED) {
            for (const phrase of findQuantityPhrases(input.trim())) {
                const cutsInside = head.length > phrase.start && head.length < phrase.end;

                expect(cutsInside, `${JSON.stringify(input)} was cut at ${head.length}, inside a number`).toBe(false);
            }
        }
    });

    /** Totality. A segmenter that throws on one span in a corpus takes the whole import down with it. */
    it('answers for every span the corpus produces, without throwing', () => {
        for (const { span, precededBy } of POSITIONED) {
            expect(() => segmentClause(span, precededBy)).not.toThrow();
        }
    });
});

describe('segmentClause over real 1919 prose — ⛔ POSITION decides a vessel (owner ruling 2026-08-26)', () => {
    /**
     * ⛔ THE PROPERTY THE RULING ADDS, judged against this file's own {@link GOVERNORS} list rather than
     * the module's. A span may only be refused outright when the vessel is what the span is ABOUT
     * (head-final) or when a preposition GOVERNS the span. A span that is neither — a measure phrase headed
     * by a vessel, standing at the head of its clause — is a real measurement and must survive.
     *
     * This is the corpus-level form of MUTANT 1: revert the module to "any vessel means not an ingredient"
     * and every ungoverned `a bowl of …` in the book stops being a measure, which this loop catches.
     */
    it('never refuses an UNGOVERNED span whose head noun is a food, and judged at least one', () => {
        let judged = 0;

        for (const { span, precededBy } of POSITIONED) {
            const governor = (precededBy.trim().split(/\s+/).at(-1) ?? '').toLowerCase();
            const finalWord = finalNoun(span);

            if (GOVERNORS.has(governor) || NOT_A_FOOD_NOUN.has(finalWord) || finalWord === '') {
                continue;
            }

            judged += 1;

            expect(
                segmentClause(span, precededBy).kind,
                `refused ${JSON.stringify(span)}, which nothing governs and which is about ${finalWord}`,
            ).toBe('ingredient');
        }

        // ⛔ The loop must actually run. A property test whose body never executes is green and worthless.
        expect(judged).toBeGreaterThan(0);
    });

    /**
     * The counterpart, and the one that makes the pair non-vacuous: the SAME span, moved behind a
     * preposition, must be refused whenever its measure phrase is a vessel. Taken from the corpus rather
     * than invented — every span here is text the book printed.
     */
    it('refuses a corpus span whose measure phrase is a vessel once a preposition governs it', () => {
        // The oracle's OWN reading of "the phrase a preposition would govern": everything up to the first
        // partitive `of` or the first function word, derived here from literal lists rather than by asking
        // the module. `two cakes in layer pans` therefore offers `two cakes`, and its pans are a tail.
        const measurePhraseOf = (span: string): string =>
            span.split(/\s+(?:of|in|into|with|over|for|from|through|to|on|at|and|or|until|then|when)\s+|[,;:(]/)[0] ??
            '';

        // ⛔ A DELIMITER IS REQUIRED, and the oracle must say so too. Without a partitive `of` or a
        // function word there is nothing separating a measure from a food, so the position test declines —
        // `a quick oven twenty-five minutes` stays an ingredient, which is the `Sift one cup of flour three
        // times` protection doing its job. An oracle that ignored the delimiter would demand the very
        // word-anywhere-over-a-whole-span reading this module refuses.
        const vesselMeasured = SPANS.filter((span) => {
            const measure = measurePhraseOf(span);

            return (
                measure.length < span.trim().length &&
                measure
                    .split(/\s+/)
                    .some((word) => ORACLE_VESSELS.has(word.toLowerCase().replace(/[^\p{L}\p{N}-]/gu, '')))
            );
        });

        expect(vesselMeasured.length).toBeGreaterThan(0);

        for (const span of vesselMeasured) {
            expect(segmentClause(span, 'put it into ').kind, `kept ${JSON.stringify(span)} behind a preposition`).toBe(
                'instruction',
            );
        }
    });
});
