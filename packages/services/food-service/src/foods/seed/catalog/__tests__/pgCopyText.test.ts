/**
 * PostgreSQL's COPY text format, one row per line (curated catalog plan KTD-1). Each case pins one rule of the format
 * as the PostgreSQL manual states it for `COPY ... FROM STDIN` in text format: a field separator is a tab, a row ends
 * with a newline, NULL is `\N`, and a backslash, newline, carriage return or tab inside a value is backslash-escaped.
 * The round trip through a real server is `tests/e2e/catalogSeedApply.e2e.test.ts`'s.
 */
import { describe, expect, it } from 'vitest';

import { copyTextLine } from '../pgCopyText.js';

describe('copyTextLine', () => {
    it('separates fields with a tab and ends the row with a newline', () => {
        expect(copyTextLine(['a', 'b', 'c'])).toBe('a\tb\tc\n');
    });

    it('writes NULL as \\N, and an empty string as nothing, so the two stay apart', () => {
        expect(copyTextLine([null, ''])).toBe('\\N\t\n');
    });

    it('escapes a backslash first, so an escape it writes is never escaped again', () => {
        expect(copyTextLine(['a\\b'])).toBe('a\\\\b\n');
        expect(copyTextLine(['\\N'])).toBe('\\\\N\n');
    });

    it('escapes a newline, a carriage return and a tab inside a value', () => {
        expect(copyTextLine(['line\none', 'cr\rlf', 'tab\there'])).toBe('line\\none\tcr\\rlf\ttab\\there\n');
    });

    it('keeps every other character as it is, quotes and unicode included', () => {
        expect(copyTextLine([`"quoted" 'single' 1/4 tsp, ½ cup — café`])).toBe(
            `"quoted" 'single' 1/4 tsp, ½ cup — café\n`,
        );
    });

    it('writes a boolean as t or f, and a whole number in decimal', () => {
        expect(copyTextLine([true, false, 0, 12, -3])).toBe('t\tf\t0\t12\t-3\n');
    });

    it('refuses a number that is not a whole number, which only a decimal string spells exactly', () => {
        expect(() => copyTextLine([1.5])).toThrow(RangeError);
        expect(() => copyTextLine([Number.NaN])).toThrow(RangeError);
    });
});
