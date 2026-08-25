/**
 * Integration tier — the clause SEGMENTER over a committed slice of REAL 1919 cookbook prose.
 *
 * | Requirement | Test |
 * | ----------- | ---- |
 * | U22a — instruction residue is cut off the span handed to a parse engine | "bounds real spans" |
 * | U22a — a tail that states a food is never cut | "never cuts away a stated food" |
 * | R29 — a boundary inside a quantity phrase is not a boundary | "never cuts inside a quantity phrase" |
 * | HAZ-040 — nothing is fabricated | "emits only text the book printed" |
 *
 * ## What this tier proves that the unit tier structurally cannot
 *
 * 1. `statesASecondFood` — the guard the whole unit's safety rests on — is a claim about what the REAL
 *    `parse-ingredient` returns for real prose. A unit test picks the tails; this one takes every tail the
 *    corpus produces, so the guard is measured rather than illustrated.
 * 2. The rate is observable. KTD-11 rules that "a flag that fires on half of everything is how a real
 *    signal gets muted", and `instruction_text_dropped` is a new flag — the only way to know whether it is
 *    a signal or noise is to count it against text nobody wrote for a test.
 * 3. Totality over a whole corpus rather than over chosen strings. A segmenter that throws on one span in
 *    two thousand takes the import down, and only real text has that span in it.
 *
 * ⚠️ The spans are derived here the way `cookbook-import`'s scanner derives them — the suffix of a clause
 * beginning at a quantity phrase (`trimmed.slice(at)`, in `suffixStarts`' terms). That rule is restated in
 * ONE place below and nowhere else; this file deliberately does not reimplement the rest of the extractor,
 * which lives in another package and is tested there.
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

/**
 * Every span the extractor's scan would offer the segmenter.
 *
 * The corpus is broken into clauses on the same boundaries `splitClauses` uses, each clause is
 * whitespace-joined the way a wrapped source paragraph reaches a parser, and every quantity phrase in it
 * opens one span running to the clause's end — which is exactly the end U22a exists to bound.
 */
function everySpan(): readonly string[] {
    return readCorpus()
        .split(/[;.]|,\s*(?:and\s+)?|\s+and\s+(?:then\s+)?/)
        .map((clause) => clause.replace(/\s+/g, ' ').trim())
        .filter((clause) => clause.length >= 3)
        .flatMap((clause) => findQuantityPhrases(clause).map((phrase) => clause.slice(phrase.start)));
}

const SPANS = everySpan();
const SEGMENTS = SPANS.map((span) => ({ span, segment: segmentClause(span) }));
const BOUNDED = SEGMENTS.flatMap(({ span, segment }) =>
    segment.kind === 'ingredient' && segment.trailingInstruction !== null
        ? [{ input: span, head: segment.span, tail: segment.trailingInstruction }]
        : [],
);

describe('segmentClause over real 1919 prose — anti-vacuity', () => {
    /**
     * ⛔ FIRST, BEFORE ANY RATE. Every property below is a `for` loop over a derived list, and a derived
     * list that silently comes back empty makes all of them pass while proving nothing — the failure mode
     * every corpus-driven suite has. So the corpus is asserted to contain the regimes first.
     */
    it('derives a real corpus of spans, covering both outcomes', () => {
        expect(SPANS.length).toBeGreaterThan(50);
        expect(BOUNDED.length).toBeGreaterThan(5);
        expect(
            SEGMENTS.some(({ segment }) => segment.kind === 'ingredient' && segment.trailingInstruction === null),
        ).toBe(true);
    });

    /**
     * ⚠️ The rate is REPORTED, not asserted to a tuned threshold — the plan's own discipline for the
     * comparison harness ("disagreement rate is reported, not asserted to a threshold"). The bound here is
     * deliberately loose and one-sided: it only fails if the flag has become the thing KTD-11 warns about,
     * a flag that fires on nearly everything and therefore says nothing.
     */
    it('bounds a minority of spans, so the review flag stays a signal', () => {
        const rate = BOUNDED.length / SPANS.length;

        expect(rate).toBeGreaterThan(0);
        expect(rate).toBeLessThan(0.5);
    });
});

describe('segmentClause over real 1919 prose — what it may never do', () => {
    /**
     * ⛔ HAZ-040, applied to segmentation. This module may only ever REMOVE a suffix. If a span could come
     * back rewritten, reordered or re-spelled, the text persisted as `sourceLine` — the transcription U11's
     * gate verifies our parse against — would be a string we produced rather than one the book printed.
     */
    it('emits only text the book printed, as a prefix of what it was handed', () => {
        for (const { span, segment } of SEGMENTS) {
            if (segment.kind !== 'ingredient') {
                continue;
            }

            expect(span.trim().startsWith(segment.span), `${JSON.stringify(span)} -> ${segment.span}`).toBe(true);
        }
    });

    /** The tail is the other half of the same string: verbatim, at the end, and nothing invented between. */
    it('reports a tail that is verbatim the end of the span it was cut from', () => {
        for (const { input, head, tail } of BOUNDED) {
            expect(input.trim().endsWith(tail), `${JSON.stringify(input)} -> ${JSON.stringify(tail)}`).toBe(true);
            expect(head.length + tail.length).toBeLessThanOrEqual(input.trim().length);
            expect(tail).not.toBe('');
        }
    });

    /**
     * ⛔ THE GUARD, MEASURED. This is the property that makes U22a safe rather than value-corrupting, and
     * the unit tier can only illustrate it on tails somebody chose. Here every tail the corpus produced is
     * re-read with the REAL parser from every quantity phrase it contains: if any of them states a unit of
     * substance, a food was deleted from a recipe and this fails.
     */
    it('never cuts away a stated food', () => {
        for (const { input, tail } of BOUNDED) {
            for (const phrase of findQuantityPhrases(tail)) {
                const parsed = parseIngredientLine(tail.slice(phrase.start));

                expect(
                    parsed.quantity.kind !== 'absent' && parsed.unit !== null && parsed.name.trim() !== '',
                    `cut a food out of ${JSON.stringify(input)}: the tail ${JSON.stringify(tail)} states one`,
                ).toBe(false);
            }
        }
    });

    /**
     * ⛔ R29 over real text. `and` is in the cut lexicon AND is the middle of "one and one-half", which
     * this corpus contains. A head that ends mid-number is the third-of-the-stated-amount defect the clause
     * splitter already paid for once — so no head may end on a word that opens a quantity phrase it does
     * not finish.
     */
    it('never cuts inside a quantity phrase', () => {
        for (const { input, head } of BOUNDED) {
            const phrases = findQuantityPhrases(input.trim());

            for (const phrase of phrases) {
                const cutsInside = head.length > phrase.start && head.length < phrase.end;

                expect(cutsInside, `${JSON.stringify(input)} was cut at ${head.length}, inside a number`).toBe(false);
            }
        }
    });

    /** Totality. A segmenter that throws on one span in a corpus takes the whole import down with it. */
    it('answers for every span the corpus produces, without throwing', () => {
        for (const span of SPANS) {
            expect(() => segmentClause(span)).not.toThrow();
        }
    });
});
