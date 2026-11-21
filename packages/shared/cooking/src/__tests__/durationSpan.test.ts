/**
 * Where in the line a one-duration reading found its time (S3a.U3 C1 item 5, AR4). The span is the offsets of the
 * matched time in the line the caller passed, in code units, so `lineLabelOf` can read the words in front of it. Each
 * case names the text the span must cover, and the offsets are checked against that text, never against a copy of the
 * reader's own arithmetic.
 */
import { describe, expect, it } from 'vitest';

import { readDuration } from '../duration.js';
import { readWordDuration } from '../durationWords.js';
import type { DurationReading } from '../durationReading.js';

/** The text of the line a `one` reading covers, or a thrown error when the reading is not one. */
function coveredText(line: string, reading: DurationReading): string {
    if (reading.kind !== 'one') {
        throw new Error(`"${line}" did not read as one duration`);
    }

    return line.slice(reading.span.start, reading.span.end);
}

describe('the span of a digit reading', () => {
    it.each([
        ['Roast 20 min', '20 min'],
        ['Bake for about 25 minutes', '25 minutes'],
        ['Simmer, covered, for 10 to 15 minutes', '10 to 15 minutes'],
        ['Preheat the oven. Roast 1 h 30', '1 h 30'],
        ['Rest 1 hour 5 minutes.', '1 hour 5 minutes'],
        ['20 minutes', '20 minutes'],
        ['Chill for 45 MIN', '45 MIN'],
        ['Bake 1½ hours until golden', '1½ hours'],
    ])('%s covers "%s"', (line, text) => {
        expect(coveredText(line, readDuration(line))).toBe(text);
    });

    it('is measured in the line given, with no trimming or case change', () => {
        const line = '   Roast   20  min   ';

        expect(coveredText(line, readDuration(line))).toBe('20  min');
    });
});

describe('the span of a word reading', () => {
    it.each([
        ['Cook for an hour and a half', 'an hour and a half'],
        ['Bake for twenty minutes', 'twenty minutes'],
        ['Rest ten to fifteen minutes before slicing', 'ten to fifteen minutes'],
        ['BAKE FOR TWENTY MINUTES', 'TWENTY MINUTES'],
        ['Simmer for one hour and ten minutes.', 'one hour and ten minutes'],
    ])('%s covers "%s"', (line, text) => {
        expect(coveredText(line, readWordDuration(line))).toBe(text);
        expect(coveredText(line, readDuration(line))).toBe(text);
    });

    it('is measured in the original line even where lower-casing would change its length', () => {
        const line = 'İ Bake for twenty minutes';

        expect(coveredText(line, readWordDuration(line))).toBe('twenty minutes');
    });
});
