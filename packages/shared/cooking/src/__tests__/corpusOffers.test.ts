/**
 * The oracles for "times written in words": the hand-labelled corpus table, the line rows, and the frozen digit-only
 * readings. They fail against the digit-only reader exactly where a word time is expected.
 */
import { describe, expect, it } from 'vitest';

import { CORPUS_OFFERS, NEGATIVE_LINES, POSITIVE_LINE_OFFERS } from '../__fixtures__/corpusOffers.js';
import { DIGIT_READINGS } from '../__fixtures__/digitReadings.js';
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

describe('line rows', () => {
    it.each(POSITIVE_LINE_OFFERS.map((row) => [row.line, row.seconds] as const))('%s offers %s s', (line, seconds) => {
        expect(offerSecondsOf({ line })).toBe(seconds);
    });

    it.each(NEGATIVE_LINES.map((line) => [line] as const))('%s offers nothing', (line) => {
        expect(offerSecondsOf({ line })).toBeUndefined();
    });
});

/**
 * Two lines the digit-only reader read wrongly: it dropped the hour of "an hour and 15 minutes" and the 30 minutes of
 * "1 h 30 then". They are left out of the exact comparison so that a fix may change them, and they are never pinned to
 * the wrong answer. Their right readings are contract rows below (issue #316).
 */
const READ_WRONGLY_BEFORE: ReadonlyMap<string, number> = new Map([
    ['Bake for an hour and 15 minutes.', 4_500],
    ['Roast for 1 h 30 then rest.', 5_400],
]);

describe('no loss against the digit-only reader', () => {
    it.each(
        DIGIT_READINGS.filter((row) => row.reading.kind !== 'none' && !READ_WRONGLY_BEFORE.has(row.line)).map(
            (row) => [row.line, row.reading] as const,
        ),
    )('keeps its reading: %s', (line, reading) => {
        const now = readDuration(line);

        expect(now.kind).toBe(reading.kind);

        if (reading.kind === 'one' && now.kind === 'one') {
            expect(now.seconds).toBe(reading.seconds);
        }
    });

    it('names only lines the digit-only file really holds', () => {
        const lines = new Set(DIGIT_READINGS.map((row) => row.line));

        for (const line of READ_WRONGLY_BEFORE.keys()) {
            expect(lines.has(line), line).toBe(true);
        }
    });

    // Fails today (the reader still drops the first part, #316). `it.fails` turns red the day it is fixed, which is the
    // cue to make these plain tests. It never pins the wrong answer.
    it.fails.each([...READ_WRONGLY_BEFORE])('reads the whole time, or none: %s', (line, seconds) => {
        const now = readDuration(line);

        expect(now.kind === 'none' || (now.kind === 'one' && now.seconds === seconds)).toBe(true);
    });
});
