import { describe, expect, it } from 'vitest';

import { trimEdges } from '../trimEdges.js';

const isComma = (character: string): boolean => character === ',';

describe('trimEdges', () => {
    it.each([
        ['', ''],
        [',,,', ''],
        [',a,b,', 'a,b'],
        ['a', 'a'],
        ['1/2', '1/2'],
        ['2-3,', '2-3'],
        ['1.5,,', '1.5'],
    ])('trims %j to %j', (text, expected) => {
        expect(trimEdges(text, isComma)).toBe(expected);
    });

    it('keeps a surrogate pair whole', () => {
        expect(trimEdges(',\u{1F9C2},', isComma)).toBe('\u{1F9C2}');
    });

    it('is linear on a long run of the edge character inside the text', () => {
        const text = `a${','.repeat(100_000)}a`;
        const started = performance.now();

        expect(trimEdges(text, isComma)).toBe(text);
        expect(performance.now() - started).toBeLessThan(250);
    });
});
