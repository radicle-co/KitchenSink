/**
 * The oracles for "times written in words": the hand-labelled corpus table, AE4a's line rows, and the frozen r0
 * readings. They fail against the digit-only reader exactly where a word time is expected.
 */
import { describe, expect, it } from 'vitest';

import { CORPUS_OFFERS, NEGATIVE_LINES, POSITIVE_LINE_OFFERS } from '../__fixtures__/corpusOffers.js';
import { DURATION_READINGS_R0 } from '../__fixtures__/durationReadingsR0.js';
import { GOLDEN_CORPUS_STEPS } from '../__fixtures__/stepLinesGolden.js';
import { offerSecondsOf, readDuration } from '../duration.js';

describe('the corpus offers table', () => {
    it('labels every corpus step once', () => {
        expect(CORPUS_OFFERS.map((row) => `${row.recipe} ${row.step}`)).toEqual(
            GOLDEN_CORPUS_STEPS.map((step) => `${step.recipe} ${step.step}`),
        );
    });

    it.each(GOLDEN_CORPUS_STEPS.map((step, index) => [`${step.recipe} ${step.step}`, step, index] as const))(
        '%s offers what the cook can read',
        (_name, step, index) => {
            const offers = step.lines.flatMap((line) => offerSecondsOf({ line }) ?? []);

            expect(offers).toEqual(CORPUS_OFFERS[index]?.offers);
        },
    );
});

describe('AE4a line rows', () => {
    it.each(POSITIVE_LINE_OFFERS.map((row) => [row.line, row.seconds] as const))('%s offers %s s', (line, seconds) => {
        expect(offerSecondsOf({ line })).toBe(seconds);
    });

    it.each(NEGATIVE_LINES.map((line) => [line] as const))('%s offers nothing', (line) => {
        expect(offerSecondsOf({ line })).toBeUndefined();
    });
});

describe('no loss against the r0 reader', () => {
    it.each(
        DURATION_READINGS_R0.filter((row) => row.reading.kind !== 'none').map(
            (row) => [row.line, row.reading] as const,
        ),
    )('keeps its reading: %s', (line, reading) => {
        const now = readDuration(line);

        expect(now.kind).toBe(reading.kind);

        if (reading.kind === 'one' && now.kind === 'one') {
            expect(now.seconds).toBe(reading.seconds);
        }
    });
});
