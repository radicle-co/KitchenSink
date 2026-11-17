/**
 * THE FACTS SHEET WITH THE REAL DURATION READER (spec 027 FR-035, research R1).
 *
 * recipe-core builds the sheet and takes durations through a port, because this package depends on recipe-core and
 * the reverse import would be a cycle. This test wires the port to this package's real reader, through the package
 * barrel and recipe-core's public subpath, with nothing mocked, and shows what the sheet then carries.
 */
import { buildFactsSheet, type FactsSheetReaders } from '@kitchensink/recipe-core/step-writing/facts-sheet';
import { describe, expect, it } from 'vitest';

import { readDuration } from '@kitchensink/cooking-core';

/** The adapter a caller writes: the sheet hands over a time or a sentence, and the real reader reads it. */
const readers: FactsSheetReaders = {
    durations: (text) => {
        const reading = readDuration(text);

        return reading.kind === 'one'
            ? [{ minSeconds: reading.seconds, maxSeconds: reading.highSeconds ?? reading.seconds }]
            : [];
    },
};

const sheetOf = (steps: readonly string[], ingredients: readonly string[] = []) =>
    buildFactsSheet(
        {
            language: 'en',
            ingredientLines: ingredients.map((displayText) => ({ displayText })),
            steps: steps.map((instruction) => ({ instruction })),
        },
        readers,
    );

describe('buildFactsSheet with the real duration reader', () => {
    it('carries a duration per time, reads a temperature as a temperature and never as a cup', () => {
        const step = sheetOf(['Roast at 200 C for 25 minutes. Rest for 10 minutes.'], ['chicken']).steps[0];

        expect(step?.durations).toEqual([
            { minSeconds: 1_500, maxSeconds: 1_500 },
            { minSeconds: 600, maxSeconds: 600 },
        ]);
        expect(step?.temperatures).toEqual([{ value: 200, scale: 'C' }]);
        expect(step?.amounts).toEqual([]);
    });

    it('carries a compound time as one duration, and an amount beside it as an amount', () => {
        const sheet = sheetOf(['Simmer for 1 hour 30 minutes.', 'Stir in 2 tbsp butter.'], ['butter']);

        expect(sheet.steps.map((step) => step.durations)).toEqual([[{ minSeconds: 5_400, maxSeconds: 5_400 }], []]);
        expect(sheet.steps[0]?.amounts).toEqual([]);
        expect(sheet.steps[1]?.amounts).toEqual([{ quantity: 2, unit: 'tablespoon', ingredient: 'butter' }]);
    });

    // The reader returns one number for a range. The sheet asks it for each end, so the range keeps its high end.
    it('carries a range as one duration from its low end to its high end', () => {
        const step = sheetOf(['Bake for 20 to 25 minutes.']).steps[0];

        expect(step?.durations).toEqual([{ minSeconds: 1_200, maxSeconds: 1_500 }]);
        expect(step?.amounts).toEqual([]);
    });

    // The reader gives nothing for a sentence with two spans. The sheet hands it one time at a time.
    it('carries two times in one sentence as two durations', () => {
        const step = sheetOf(['Rest 5 minutes, then chill 10 minutes.']).steps[0];

        expect(step?.durations).toEqual([
            { minSeconds: 300, maxSeconds: 300 },
            { minSeconds: 600, maxSeconds: 600 },
        ]);
        expect(step?.amounts).toEqual([]);
    });

    it('carries days as durations, and ties no amount to the name after a time', () => {
        const step = sheetOf(['Chill for 2 to 3 days, then serve over ice.'], ['ice']).steps[0];

        expect(step?.durations).toEqual([{ minSeconds: 172_800, maxSeconds: 259_200 }]);
        expect(step?.amounts).toEqual([]);
    });

    it('reads a time written in words as the cooking timer does, so the two agree', () => {
        const sheet = sheetOf(
            ['Simmer ten minutes.', 'Simmer about ten to fifteen minutes.', 'Add 2 tbsp butter.'],
            ['butter'],
        );

        expect(sheet.steps[0]?.durations).toEqual([{ minSeconds: 600, maxSeconds: 600 }]);
        expect(sheet.steps[1]?.durations).toEqual([{ minSeconds: 600, maxSeconds: 900 }]);
        expect(sheet.steps[2]?.durations).toEqual([]);
        expect(readDuration('Simmer ten minutes.')).toEqual({ kind: 'one', seconds: 600 });
    });

    it('reads no duration where the timer offers none', () => {
        const step = sheetOf(['Simmer every five minutes.']).steps[0];

        expect(readDuration('Simmer every five minutes.')).toEqual({ kind: 'none' });
        expect(step?.durations).toEqual([]);
    });
});
