/**
 * Unit tests for {@link findQuantityPhrases} — WHERE the quantity phrases are in a body of prose.
 *
 * | Requirement | Test |
 * | ----------- | ---- |
 * | R29 — a clause splitter must not cut an `and` the quantity grammar owns | the span suites |
 *
 * This exists so `cookbook-import` can ask "is this ` and ` part of a number?" without restating the
 * number lexicon, which has exactly one owner (`quantityWords.ts`). Every case therefore asserts the span
 * BOUNDARIES, not merely that something was found — a span one character short of the `and` would let the
 * splitter cut anyway while a "did we find it" test stayed green.
 */
import { describe, it, expect } from 'vitest';

import { findQuantityPhrases } from '../quantityPhrases.js';

/** The source text each span covers, which is what a caller actually reasons about. */
function phrasesIn(text: string): readonly string[] {
    return findQuantityPhrases(text).map((span) => text.slice(span.start, span.end));
}

describe('findQuantityPhrases', () => {
    it('covers a compound phrase INCLUDING the "and" the grammar owns', () => {
        expect(phrasesIn('one and one-half pounds of beef')).toEqual(['one and one-half']);
    });

    it('finds a phrase that does not start the text', () => {
        expect(phrasesIn('*Icing.*--One and one-half cups of sugar')).toEqual(['One and one-half']);
    });

    it('reports each phrase of a chained clause separately, so a split between them is allowed', () => {
        expect(phrasesIn('two teaspoons of baking-powder and three and one-half cups of flour')).toEqual([
            'two',
            'three and one-half',
        ]);
    });

    it('does not swallow an "and" that joins two ingredients rather than two parts of a number', () => {
        const text = 'one large beet and one-half pound of onion';
        const spans = findQuantityPhrases(text);
        const conjunction = text.indexOf(' and ');

        expect(spans.some((span) => conjunction >= span.start && conjunction < span.end)).toBe(false);
    });

    it('covers a numeral and a mixed numeral', () => {
        expect(phrasesIn('2 cups of flour and 1 1/2 cups of milk')).toEqual(['2', '1 1/2']);
        expect(phrasesIn('1½ cups of sugar')).toEqual(['1½']);
    });

    it('finds nothing in prose that states no quantity', () => {
        expect(phrasesIn('Season and serve hot with the sauce poured over.')).toEqual([]);
    });

    it('returns spans in order and never overlapping, so a caller can scan them linearly', () => {
        const spans = findQuantityPhrases('one cup of butter and two cups of sugar and three eggs');

        expect(spans.length).toBeGreaterThan(1);

        for (const [index, span] of spans.entries()) {
            expect(span.end).toBeGreaterThan(span.start);

            const previous = spans[index - 1];

            if (previous !== undefined) {
                expect(span.start).toBeGreaterThanOrEqual(previous.end);
            }
        }
    });

    describe('totality — no input throws, and a hostile one stays cheap', () => {
        it.each([[''], ['   '], ['\n\n'], ['and and and'], ['-'.repeat(500)], ['½'.repeat(500)]])(
            'never throws on %j',
            (text) => {
                expect(() => findQuantityPhrases(text)).not.toThrow();
            },
        );

        it('scans a long paragraph in linear time rather than quadratic', () => {
            const text = 'one cup of butter and two cups of sugar and three eggs. '.repeat(400);
            const started = performance.now();

            findQuantityPhrases(text);

            expect(performance.now() - started).toBeLessThan(1000);
        });
    });
});
