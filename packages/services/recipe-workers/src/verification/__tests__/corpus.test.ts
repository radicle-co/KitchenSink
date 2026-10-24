/**
 * THE BAKE-OFF CORPUS FILE FORMAT — the boundary between an operator's file and a run that spends money.
 *
 * ⛔ WHY THIS IS PARSED RATHER THAN CAST. The runner used to read the corpus with `JSON.parse(row) as
 * CorpusLine`, which is not a check: a file with `sourceline` instead of `sourceLine` produces an object whose
 * every field is `undefined`, the prompt builder happily renders `undefined` into the user turn, and the run
 * bills ~9,700 calls judging the string "undefined". The cost of that discovery is the whole run. Parse, don't
 * validate — at the one boundary in this unit where the input is a file a human wrote by hand.
 */
import { describe, expect, it } from 'vitest';

import { isCorpusFormatError, parseCorpusJsonl } from '../corpus.js';

const LINE = {
    lineId: 'synthetic-1-cor-0001',
    sourceLine: '2 cups sprouted wheat bread, cubed',
    candidateFoodName: 'Bread, wheat, sprouted',
    quantityLow: 2,
    quantityHigh: null,
    unit: 'cup',
    parseIsCorrect: true,
    contrastClass: 'correct',
};

describe('parseCorpusJsonl', () => {
    it('reads a well-formed file and preserves order', () => {
        const text = [JSON.stringify(LINE), JSON.stringify({ ...LINE, lineId: 'synthetic-1-cor-0002' })].join('\n');

        const lines = parseCorpusJsonl(text);

        expect(lines).toHaveLength(2);
        expect(lines[0]?.lineId).toBe('synthetic-1-cor-0001');
        expect(lines[1]?.lineId).toBe('synthetic-1-cor-0002');
        expect(lines[0]?.contrastClass).toBe('correct');
    });

    it('tolerates blank lines and a trailing newline, which every JSONL writer emits', () => {
        expect(parseCorpusJsonl(`${JSON.stringify(LINE)}\n\n`)).toHaveLength(1);
    });

    it('accepts a corpus with no contrastClass — an operator-supplied file has no synthetic classes', () => {
        const { contrastClass: _dropped, ...withoutClass } = LINE;

        expect(parseCorpusJsonl(JSON.stringify(withoutClass))[0]?.contrastClass).toBeUndefined();
    });

    it('REFUSES a misspelled field rather than judging the string "undefined" ~9,700 times', () => {
        const { sourceLine: _dropped, ...misspelled } = LINE;
        const text = JSON.stringify({ ...misspelled, sourceline: '2 cups flour' });

        expect(() => parseCorpusJsonl(text)).toThrow(/line 1/u);
    });

    it('names the offending line number, because a 2,432-line file is not searchable by eye', () => {
        const text = [JSON.stringify(LINE), JSON.stringify(LINE), '{"lineId":"broken"}'].join('\n');

        try {
            parseCorpusJsonl(text);
            expect.unreachable('a malformed line must not parse');
        } catch (error) {
            expect(isCorpusFormatError(error)).toBe(true);
            expect((error as Error).message).toMatch(/line 3/u);
        }
    });

    it('refuses a line that is not JSON at all', () => {
        expect(() => parseCorpusJsonl('lineId,sourceLine,candidateFoodName')).toThrow(/line 1/u);
    });

    it('refuses an empty source line — an empty prompt is a billed call that proves nothing', () => {
        expect(() => parseCorpusJsonl(JSON.stringify({ ...LINE, sourceLine: '' }))).toThrow(/line 1/u);
    });

    it('refuses a contrastClass outside the closed set, so a typo cannot silently empty the residual slice', () => {
        expect(() => parseCorpusJsonl(JSON.stringify({ ...LINE, contrastClass: 'nearmiss' }))).toThrow(/line 1/u);
    });

    it('keeps a null quantity and unit, which is what a count-only line ("2 apples") parses to', () => {
        const counted = parseCorpusJsonl(
            JSON.stringify({ ...LINE, quantityLow: 2, quantityHigh: null, unit: null }),
        )[0];

        expect(counted?.unit).toBeNull();
        expect(counted?.quantityHigh).toBeNull();
    });
});
